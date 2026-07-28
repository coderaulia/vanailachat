import { useRef } from 'react';
import type { FormEvent, MutableRefObject, Dispatch, SetStateAction } from 'react';
import type { Attachment, ApiChat, ContextWindow, Message, ApiProject, Chat, PendingApproval } from '../types/chat';
import type { ModelRole } from '../config/modelRoles';
import { MAX_CONVERSATION_HISTORY } from '../config/constants';
import { parseUsage, parseStreamLine } from '../utils/chatUtils';

export interface SendMessageDeps {
  // Model / project
  selectedModel: string;
  selectedRole: ModelRole;
  selectedProjectId: string | null;
  projects: ApiProject[];
  chatHistories: Record<string, Chat>;
  personaId?: string;
  // Input
  prompt: string;
  setPrompt: (v: string) => void;
  attachedFiles: Attachment[];
  setAttachedFiles: (files: Attachment[] | ((p: Attachment[]) => Attachment[])) => void;
  // Conversation state
  conversation: Message[];
  setConversation: Dispatch<SetStateAction<Message[]>>;
  systemPrompt: string;
  projectRoot: string;
  isSearchEnabled: boolean;
  // Shared session state
  currentChatId: string | null;
  setCurrentChatId: (id: string | null) => void;
  currentChatIdRef: MutableRefObject<string | null>;
  abortRef: MutableRefObject<AbortController | null>;
  activeRequestIdRef: MutableRefObject<string | null>;
  setSendingChatIds: Dispatch<SetStateAction<Record<string, boolean>>>;
  setContextWindow: Dispatch<SetStateAction<ContextWindow>>;
  setStatusText: (text: string) => void;
  setPendingApproval: Dispatch<SetStateAction<PendingApproval | null>>;
  updateHistories: (updater: (prev: Record<string, Chat>) => Record<string, Chat>) => void;
  // Persistence
  saveMessage: (chatId: string, message: Message, options?: { promptTokens?: number; completionTokens?: number }) => Promise<void>;
  upsertChat: (chat: ApiChat) => Promise<void>;
  patchChat: (id: string, updates: Partial<ApiChat>) => Promise<ApiChat>;
}

// ── background AI title generation (Fix #9) ───────────────────────────────────

async function generateChatTitle(
  chatId: string,
  userContent: string,
  model: string,
  patchChat: (id: string, updates: Partial<ApiChat>) => Promise<ApiChat>,
  updateHistories: SendMessageDeps['updateHistories'],
): Promise<void> {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: `Generate a concise 3-6 word title for this conversation. Reply with ONLY the title — no quotes, no punctuation, no explanation:\n\n${userContent.slice(0, 300)}`,
        }],
        stream: false,
        skipMemory: true,
      }),
    });
    if (!response.ok) return;

    const data = await response.json() as Record<string, unknown>;
    // Handle Ollama and OpenAI response shapes
    const ollamaContent = (data as { message?: { content?: string } }).message?.content;
    const openaiContent = (data as { choices?: Array<{ message?: { content?: string } }> })
      .choices?.[0]?.message?.content;
    const title = (ollamaContent ?? openaiContent ?? '').trim().replace(/^["']|["']$/g, '');
    if (!title || title.length > 80) return;

    await patchChat(chatId, { title, updatedAt: Date.now() });
    updateHistories(prev => {
      const chat = prev[chatId];
      if (!chat) return prev;
      return { ...prev, [chatId]: { ...chat, title } };
    });
  } catch {
    // Non-critical — silently ignore
  }
}

// ── hook ──────────────────────────────────────────────────────────────────────

export function useSendMessage(deps: SendMessageDeps) {
  const lastSentPromptRef = useRef<string>('');

  /**
   * Options let regenerate/edit reuse the whole send path.
   *
   * `promptOverride` supplies text that is not in the composer, and
   * `baseConversation` replaces the history the new turn is appended to, so a
   * retry can drop the answer (and optionally the question) being replaced
   * instead of stacking a duplicate pair onto the thread.
   */
  const handleSend = async (
    event?: FormEvent,
    options?: { promptOverride?: string; baseConversation?: Message[] },
  ) => {
    if (event) event.preventDefault();

    const {
      prompt, setPrompt, attachedFiles, setAttachedFiles,
      selectedModel, selectedRole, selectedProjectId, projects, chatHistories,
      setConversation, systemPrompt, projectRoot, isSearchEnabled,
      currentChatId, setCurrentChatId, currentChatIdRef,
      abortRef, activeRequestIdRef, setSendingChatIds, setContextWindow,
      setStatusText, updateHistories, saveMessage, upsertChat, patchChat,
      setPendingApproval, personaId,
    } = deps;

    const effectivePrompt = options?.promptOverride ?? prompt;
    const conversation = options?.baseConversation ?? deps.conversation;

    if (!effectivePrompt.trim() && attachedFiles.length === 0) return;

    const resolvedModel =
      selectedModel || (currentChatId ? chatHistories[currentChatId]?.model : null) || null;
    if (!resolvedModel) {
      setStatusText('No model selected. Please wait for models to load or pick one.');
      return;
    }
    lastSentPromptRef.current = effectivePrompt;

    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      activeRequestIdRef.current = null;
      setSendingChatIds({});
    }

    const abortController = new AbortController();
    abortRef.current = abortController;
    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    activeRequestIdRef.current = requestId;

    const activeChatId = currentChatId;

    // Build message content
    const textPart: { type: 'text'; text: string } = { type: 'text', text: effectivePrompt };
    const messageContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [textPart];
    attachedFiles
      .filter(f => f.type === 'image')
      .forEach(f => messageContent.push({ type: 'image_url', image_url: { url: f.content } }));

    const fileContext = attachedFiles
      .filter(f => f.type === 'text')
      .map(f => `[File: ${f.name}]\n\`\`\`\n${f.content}\n\`\`\``)
      .join('\n\n');
    const finalPrompt = fileContext ? `${fileContext}\n\n${effectivePrompt}` : effectivePrompt;
    if (fileContext) textPart.text = finalPrompt;

    const startedAt = Date.now();
    const chatId = activeChatId || `chat_${startedAt}_${Math.random().toString(36).slice(2, 11)}`;
    const existingChat = chatHistories[chatId];
    const activeProjectId = existingChat?.projectId || selectedProjectId || projects[0]?.id || 'default';
    const createdAt = existingChat?.createdAt || startedAt;

    const userMessage: Message = {
      id: `${startedAt}_user_${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      content: finalPrompt,
      timestamp: startedAt,
    };
    const assistantMessage: Message = {
      id: `${startedAt}_assistant_${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant',
      content: '',
      timestamp: startedAt + 1,
    };

    const optimisticConversation = [...conversation, userMessage, assistantMessage];
    setConversation(optimisticConversation);
    setPrompt('');
    setAttachedFiles([]);

    if (!activeChatId) {
      setCurrentChatId(chatId);
      currentChatIdRef.current = chatId;
    }

    setSendingChatIds(prev => ({ ...prev, [chatId]: true }));
    setStatusText('Thinking…');

    const title =
      existingChat?.title && existingChat.title.trim() && existingChat.title !== 'Untitled chat'
        ? existingChat.title
        : userMessage.content.slice(0, 50) || 'Untitled chat';

    updateHistories(prev => ({
      ...prev,
      [chatId]: {
        id: chatId,
        projectId: activeProjectId,
        title,
        conversation: optimisticConversation,
        createdAt,
        updatedAt: startedAt,
        pinned: existingChat?.pinned ?? false,
        role: existingChat?.role ?? selectedRole,
        model: resolvedModel,
        projectRoot: existingChat?.projectRoot ?? (projectRoot.trim() || null),
        systemPrompt: existingChat?.systemPrompt ?? systemPrompt,
        usage: existingChat?.usage || 0,
      },
    }));

    let requestFailed = false;
    let requestAborted = false;
    let fullContent = '';
    let finalUsage = existingChat?.usage || 0;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    let assistantContentForSave = '';
    let rafId: ReturnType<typeof requestAnimationFrame> | null = null;

    try {
      const recentConversation = conversation.slice(-MAX_CONVERSATION_HISTORY);
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          model: resolvedModel,
          chatId,
          // Lets the server persist the reply itself if this tab dies mid-stream.
          // Same id as the client's own save, which upserts onto the same row.
          assistantMessageId: assistantMessage.id,
          projectId: activeProjectId,
          // A new chat is persisted only after the stream finishes. Send the
          // selected root now so coding tools use it on the very first turn.
          projectRoot: existingChat?.projectRoot ?? (projectRoot.trim() || null),
          messages: [
            ...recentConversation.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: messageContent },
          ],
          stream: true,
          search: isSearchEnabled,
          persona: personaId || 'general',
        }),
      });

      if (!response.ok) throw new Error(await response.text());
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let streamBuffer = '';

      const applyEvent = (data: ReturnType<typeof parseStreamLine>) => {
        if (!data) return;

        // A tool call is parked server-side until the user decides.
        const approval = (data as unknown as { approval_request?: PendingApproval }).approval_request;
        if (approval) {
          setPendingApproval(approval);
          setStatusText(`Waiting for approval: ${approval.summary}`);
          return;
        }

        const resolved = (data as unknown as { approval_resolved?: { id: string } }).approval_resolved;
        if (resolved) {
          setPendingApproval(prev => (prev?.id === resolved.id ? null : prev));
          setStatusText('Thinking…');
          return;
        }
        // Tool event — update status only
        if ((data as unknown as { tool_event?: boolean }).tool_event) {
          const td = data as unknown as { tool?: string };
          const msgs: Record<string, string> = {
            read_file: 'Reading file…',
            search_web: 'Searching the web…',
            list_directory: 'Analyzing directory…',
            run_command: 'Executing command…',
            load_skill: 'Loading skill…',
            write_file: 'Writing file…',
            edit_file: 'Editing file…',
          };
          setStatusText(td.tool ? (msgs[td.tool] ?? 'Thinking…') : 'Thinking…');
          return;
        }

        const contentChunk = data.message?.content || '';
        if (contentChunk) { fullContent += contentChunk; assistantContentForSave = fullContent; }

        if (data.usage) {
          finalUsage = parseUsage(data.usage);
          if (typeof data.usage.prompt_tokens === 'number') promptTokens = data.usage.prompt_tokens;
          if (typeof data.usage.completion_tokens === 'number') completionTokens = data.usage.completion_tokens;
        }
        if (typeof data.prompt_eval_count === 'number' && typeof data.eval_count === 'number') {
          promptTokens = data.prompt_eval_count;
          completionTokens = data.eval_count;
          finalUsage = data.prompt_eval_count + data.eval_count;
        }
        if (currentChatIdRef.current === chatId && finalUsage > 0) {
          setContextWindow(prev => ({ ...prev, current: finalUsage }));
        }

        if (!contentChunk && !data.done) return;
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (currentChatIdRef.current === chatId) {
            setConversation(prev => {
              if (prev.length === 0) return prev;
              const updated = [...prev];
              const last = updated.length - 1;
              if (updated[last]?.role === 'assistant')
                updated[last] = { ...updated[last], content: fullContent };
              return updated;
            });
          }
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamBuffer += decoder.decode(value, { stream: true });
        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop() ?? '';
        for (const line of lines) applyEvent(parseStreamLine(line));
      }
      streamBuffer += decoder.decode();
      if (streamBuffer.trim()) applyEvent(parseStreamLine(streamBuffer));
      assistantContentForSave = fullContent;

    } catch (error) {
      const isAbort = (error instanceof DOMException || error instanceof Error) &&
                      error.name === 'AbortError';
      if (isAbort) {
        requestAborted = true;
        if (!assistantContentForSave) {
          const trimEmpty = (conv: Message[]) => {
            const updated = [...conv];
            const last = updated.length - 1;
            if (updated[last]?.role === 'assistant' && !updated[last].content) updated.pop();
            return updated;
          };
          updateHistories(prev => {
            const chat = prev[chatId];
            if (!chat) return prev;
            return { ...prev, [chatId]: { ...chat, conversation: trimEmpty(chat.conversation), updatedAt: Date.now() } };
          });
          if (currentChatIdRef.current === chatId) setConversation(trimEmpty);
        }
      } else {
        requestFailed = true;
        let message = error instanceof Error ? error.message : 'Unknown error';
        if (message.includes('requires') && message.includes('available') &&
            (message.includes('GiB') || message.includes('MiB'))) {
          message = `Insufficient Memory: ${message}. Try a smaller model or further quantization.`;
        }
        const errorText = `Error: ${message}`;
        if (!assistantContentForSave) assistantContentForSave = errorText;
        if (currentChatIdRef.current === chatId) setStatusText(errorText);

        const setError = (conv: Message[]) => {
          const updated = [...conv];
          const last = updated.length - 1;
          if (updated[last]?.role === 'assistant' && !updated[last].content)
            updated[last] = { ...updated[last], content: errorText };
          return updated;
        };
        updateHistories(prev => {
          const chat = prev[chatId];
          if (!chat) return prev;
          return { ...prev, [chatId]: { ...chat, conversation: setError(chat.conversation), updatedAt: Date.now() } };
        });
        if (currentChatIdRef.current === chatId) setConversation(prev => prev.length ? setError(prev) : prev);
      }
    } finally {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }

      const isActiveRequest = activeRequestIdRef.current === requestId;
      const finishedAt = Date.now();
      const assistantToPersist: Message = {
        id: assistantMessage.id,
        role: 'assistant',
        content: assistantContentForSave,
        timestamp: assistantMessage.timestamp,
        promptTokens: promptTokens ?? null,
        completionTokens: completionTokens ?? null,
      };

      const updateFinal = (conv: Message[]) => {
        if (!conv.length) return conv;
        const updated = [...conv];
        const last = updated.length - 1;
        if (updated[last]?.role === 'assistant') {
          updated[last] = {
            ...updated[last],
            content: assistantContentForSave,
            promptTokens: assistantToPersist.promptTokens,
            completionTokens: assistantToPersist.completionTokens,
          };
        }
        return updated;
      };
      updateHistories(prev => {
        const chat = prev[chatId];
        if (!chat) return prev;
        return { ...prev, [chatId]: { ...chat, conversation: updateFinal(chat.conversation), updatedAt: finishedAt, usage: finalUsage || chat.usage } };
      });
      if (currentChatIdRef.current === chatId) setConversation(prev => updateFinal(prev));

      try {
        await upsertChat({
          id: chatId, projectId: activeProjectId, title,
          pinned: existingChat?.pinned ?? false,
          role: existingChat?.role ?? selectedRole,
          model: resolvedModel,
          projectRoot: existingChat?.projectRoot ?? (projectRoot.trim() || null),
          systemPrompt: existingChat?.systemPrompt ?? systemPrompt,
          createdAt, updatedAt: finishedAt,
        });
        await saveMessage(chatId, userMessage);
        if (assistantToPersist.content.trim().length > 0 || !requestAborted) {
          await saveMessage(chatId, assistantToPersist, { promptTokens, completionTokens });
        }

        // Background AI title for brand-new chats (Fix #9)
        if (!activeChatId && !requestFailed && !requestAborted && assistantContentForSave.trim()) {
          void generateChatTitle(chatId, userMessage.content, resolvedModel, patchChat, updateHistories);
        }
      } catch (err) {
        console.error(err);
        setStatusText('Failed to persist messages');
      }

      if (isActiveRequest) {
        activeRequestIdRef.current = null;
        abortRef.current = null;
        setSendingChatIds(prev => {
          if (!prev[chatId]) return prev;
          const next = { ...prev };
          delete next[chatId];
          return next;
        });
        if (currentChatIdRef.current === chatId && !requestFailed) setStatusText('Ready');
      }
    }
  };

  /**
   * Re-ask the question that produced a given assistant message.
   *
   * The old answer and everything after it are dropped, so the retry replaces
   * the reply rather than appending a second copy of the exchange.
   */
  const handleRegenerate = async (assistantMessageId: string) => {
    const conversation = deps.conversation;
    const assistantIndex = conversation.findIndex(m => m.id === assistantMessageId);
    if (assistantIndex < 1) return;

    const userIndex = conversation.slice(0, assistantIndex).map(m => m.role).lastIndexOf('user');
    if (userIndex === -1) return;

    const userMessage = conversation[userIndex];
    if (!userMessage.content.trim()) return;

    await handleSend(undefined, {
      promptOverride: userMessage.content,
      baseConversation: conversation.slice(0, userIndex),
    });
  };

  /** Replace a user message with edited text and re-run from that point. */
  const handleEditAndResend = async (userMessageId: string, newContent: string) => {
    if (!newContent.trim()) return;

    const conversation = deps.conversation;
    const userIndex = conversation.findIndex(m => m.id === userMessageId);
    if (userIndex === -1) return;

    await handleSend(undefined, {
      promptOverride: newContent,
      baseConversation: conversation.slice(0, userIndex),
    });
  };

  return { handleSend, handleRegenerate, handleEditAndResend, lastSentPromptRef };
}
