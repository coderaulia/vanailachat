import type { FormEvent, MutableRefObject, Dispatch, SetStateAction } from 'react';
import type { ApiChat, Message, ApiProject, Chat } from '../types/chat';

export interface ResearchDeps {
  selectedModel: string;
  selectedProjectId: string | null;
  projects: ApiProject[];
  prompt: string;
  setPrompt: (v: string) => void;
  setConversation: Dispatch<SetStateAction<Message[]>>;
  currentChatIdRef: MutableRefObject<string | null>;
  abortRef: MutableRefObject<AbortController | null>;
  activeRequestIdRef: MutableRefObject<string | null>;
  setSendingChatIds: Dispatch<SetStateAction<Record<string, boolean>>>;
  setStatusText: (text: string) => void;
  setCurrentChatId: (id: string | null) => void;
  updateHistories: (updater: (prev: Record<string, Chat>) => Record<string, Chat>) => void;
  saveMessage: (chatId: string, message: Message, options?: { promptTokens?: number; completionTokens?: number }) => Promise<void>;
  upsertChat: (chat: ApiChat) => Promise<void>;
}

export function useResearch(deps: ResearchDeps) {
  const handleResearch = async (event?: FormEvent) => {
    if (event) event.preventDefault();
    if (!deps.prompt.trim()) return;

    const {
      prompt, setPrompt, selectedModel, selectedProjectId, projects,
      setConversation, currentChatIdRef,
      abortRef, activeRequestIdRef, setSendingChatIds, setStatusText,
      setCurrentChatId, updateHistories, saveMessage, upsertChat,
    } = deps;

    const resolvedModel = selectedModel;
    const originalPrompt = prompt;

    if (!resolvedModel) {
      setStatusText('No model selected. Please select a model first.');
      return;
    }

    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      activeRequestIdRef.current = null;
      setSendingChatIds({});
    }

    const abortController = new AbortController();
    abortRef.current = abortController;
    const requestId = `research_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    activeRequestIdRef.current = requestId;

    const startedAt = Date.now();
    const chatId = `research_${startedAt}`;

    const userMessage: Message = {
      id: `${startedAt}_user`,
      role: 'user',
      content: `🔍 Research: ${originalPrompt}`,
      timestamp: startedAt,
    };
    const assistantMessage: Message = {
      id: `${startedAt}_assistant`,
      role: 'assistant',
      content: '',
      timestamp: startedAt + 1,
    };

    setConversation(prev => [...prev, userMessage, assistantMessage]);
    setPrompt('');
    setCurrentChatId(chatId);
    currentChatIdRef.current = chatId;
    setSendingChatIds(prev => ({ ...prev, [chatId]: true }));
    setStatusText('Starting research…');

    let researchContent = '';
    const stageMessages: string[] = [];

    try {
      const response = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          query: originalPrompt,
          model: resolvedModel,
          maxSources: 5,
          depth: 'standard',
        }),
      });

      if (!response.ok) throw new Error(await response.text());
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const ev = JSON.parse(trimmed) as Record<string, unknown>;
            if (ev.stage === 'chunk' && ev.content) {
              researchContent += ev.content as string;
              setConversation(prev => {
                if (prev.length < 2) return prev;
                const updated = [...prev];
                updated[updated.length - 1] = { ...updated[updated.length - 1], content: researchContent };
                return updated;
              });
            } else if (ev.stage === 'searching') {
              stageMessages.push(`🔎 ${ev.message}`);
              setStatusText(ev.message as string);
            } else if (ev.stage === 'reading') {
              stageMessages.push(`📄 ${ev.message}`);
              setStatusText(ev.message as string);
            } else if (ev.stage === 'synthesizing') {
              setStatusText('Synthesizing report…');
            } else if (ev.stage === 'streaming') {
              setStatusText('Generating report…');
            } else if (ev.stage === 'error') {
              researchContent += `\n\n> [!CAUTION]\n> ${ev.message}\n\n`;
              setStatusText('Research error');
            } else if (ev.stage === 'done') {
              const stageSummary = stageMessages.map(m => `> ${m}`).join('\n');
              const fullContent = stageSummary
                ? `${stageSummary}\n\n---\n\n${researchContent}`
                : researchContent;
              researchContent = fullContent;
              setConversation(prev => {
                if (prev.length < 2) return prev;
                const updated = [...prev];
                updated[updated.length - 1] = { ...updated[updated.length - 1], content: fullContent };
                return updated;
              });
              setStatusText('Research complete');
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch (error) {
      const isAbort =
        (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError';
      if (!isAbort) {
        const message = error instanceof Error ? error.message : 'Research failed';
        researchContent += `\n\n> [!CAUTION]\n> ${message}\n\n`;
        setStatusText('Research failed');
      }
      if (researchContent) {
        setConversation(prev => {
          if (prev.length < 2) return prev;
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], content: researchContent };
          return updated;
        });
      }
    } finally {
      setSendingChatIds(prev => {
        if (!prev[chatId]) return prev;
        const next = { ...prev };
        delete next[chatId];
        return next;
      });
      abortRef.current = null;
      activeRequestIdRef.current = null;

      // Persist research chat so it survives reload
      try {
        const activeProjectId = selectedProjectId || projects[0]?.id || 'default';
        const finishedAt = Date.now();
        await upsertChat({
          id: chatId,
          projectId: activeProjectId,
          title: `Research: ${originalPrompt.slice(0, 45)}`,
          model: resolvedModel,
          createdAt: startedAt,
          updatedAt: finishedAt,
        });
        await saveMessage(chatId, userMessage);
        if (researchContent.trim()) {
          await saveMessage(chatId, { ...assistantMessage, content: researchContent });
        }
      } catch (persistErr) {
        console.error('[Research] Failed to persist:', persistErr);
      }
    }
  };

  return { handleResearch };
}
