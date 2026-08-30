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
  const abortControllersMapRef = useRef<Map<string, AbortController>>(new Map());

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

    const activeChatId = currentChatId;
    const startedAt = Date.now();
    const chatId = activeChatId || `chat_${startedAt}_${Math.random().toString(36).slice(2, 11)}`;

    // Abort previous in-flight request FOR THIS SPECIFIC CHAT only
    const existingController = abortControllersMapRef.current.get(chatId);
    if (existingController) {
      existingController.abort();
      abortControllersMapRef.current.delete(chatId);
    }

    const abortController = new AbortController();
    abortControllersMapRef.current.set(chatId, abortController);
    if (abortRef) abortRef.current = abortController;

    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    activeRequestIdRef.current = requestId;

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
      toolActivities: [],
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
    const currentToolActivities: Array<import('../types/chat').ToolActivity> = [];
    let finalUsage = existingChat?.usage || 0;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    let assistantContentForSave = '';
    let rafId: ReturnType<typeof requestAnimationFrame> | null = null;

    // The coding role drives a coding harness, which owns the filesystem and runs
    // in a workspace rather than off the conversation history. It streams the
    // same NDJSON envelope, so everything downstream is shared.
    const activeProj = selectedProjectId ? projects.find((p) => p.id === selectedProjectId) : null;
    const workspacePath = (existingChat?.projectRoot ?? (projectRoot.trim() || activeProj?.projectRoot || '')).trim();
    const useCodingHarness = selectedRole === 'coding' && workspacePath.length > 0;
    let resolvedProjectId = activeProjectId;
    let chosenHarness = 'pi-harness';

    try {
      if (useCodingHarness) {
        // Auto-create / match Project for this workspace directory
        const matchingProj = projects.find((p) => (p.projectRoot || '').trim() === workspacePath);
        if (matchingProj) {
          resolvedProjectId = matchingProj.id;
        } else if (!activeProjectId || activeProjectId === 'default') {
          const folderName = workspacePath.split(/[\\/]/).filter(Boolean).pop() || 'Workspace';
          try {
            const pRes = await fetch('/api/projects', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: folderName, projectRoot: workspacePath }),
            });
            if (pRes.ok) {
              const pData = (await pRes.json()) as { project?: ApiProject };
              if (pData.project) {
                resolvedProjectId = pData.project.id;
              }
            }
          } catch (e) {
            console.warn('[WORKSPACE PROJECT] Failed to auto-create project:', e);
          }
        }

        // The session records which directory the harness may touch. It has to
        // exist before /run, and the chat row has to exist before the session
        // because coding_sessions.chat_id is a foreign key.
        await upsertChat({
          id: chatId,
          projectId: resolvedProjectId,
          title,
          model: resolvedModel,
          projectRoot: workspacePath,
          role: 'coding',
        } as Parameters<typeof upsertChat>[0]);

        try {
          const harnessRes = await fetch('/api/settings/coding_harness');
          if (harnessRes.ok) {
            const hData = (await harnessRes.json()) as { value?: string };
            if (hData.value && (hData.value === 'deepseek-harness' || hData.value === 'pi-harness')) {
              chosenHarness = hData.value;
            }
          }
        } catch {
          // fallback to default 'pi-harness'
        }

        const sessionResponse = await fetch('/api/coding/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId, harness: chosenHarness, workspacePath }),
        });
        if (!sessionResponse.ok) {
          const detail = await sessionResponse.json().catch(() => null) as { error?: string } | null;
          throw new Error(detail?.error ?? 'Could not open the coding workspace');
        }
      }

      const recentConversation = conversation.slice(-MAX_CONVERSATION_HISTORY);
      const response = useCodingHarness
        ? await fetch('/api/coding/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: abortController.signal,
            body: JSON.stringify({ chatId, prompt: finalPrompt, mode: 'implement', model: resolvedModel }),
          })
        : await fetch('/api/chat', {
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

      const syncUIAndHistory = () => {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          const activitiesCopy = [...currentToolActivities];

          // 1. Update live conversation if this is the active chat
          if (currentChatIdRef.current === chatId) {
            setConversation(prev => {
              if (prev.length === 0) return prev;
              const updated = [...prev];
              const last = updated.length - 1;
              if (updated[last]?.role === 'assistant') {
                updated[last] = {
                  ...updated[last],
                  content: fullContent,
                  toolActivities: activitiesCopy,
                };
              }
              return updated;
            });
          }

          // 2. Sync to chatHistories so background chats stay completely updated
          updateHistories(prev => {
            const chat = prev[chatId];
            if (!chat) return prev;
            const updatedConv = [...chat.conversation];
            const last = updatedConv.length - 1;
            if (updatedConv[last]?.role === 'assistant') {
              updatedConv[last] = {
                ...updatedConv[last],
                content: fullContent,
                toolActivities: activitiesCopy,
              };
            }
            return {
              ...prev,
              [chatId]: {
                ...chat,
                conversation: updatedConv,
                updatedAt: Date.now(),
              },
            };
          });
        });
      };

      const applyEvent = (data: ReturnType<typeof parseStreamLine>) => {
        if (!data) return;

        // A tool call is parked server-side until the user decides.
        const approval = (data as unknown as { approval_request?: PendingApproval }).approval_request;
        if (approval) {
          setPendingApproval({ ...approval, chatId });
          setStatusText(`Waiting for approval: ${approval.summary}`);
          return;
        }

        const resolved = (data as unknown as { approval_resolved?: { id: string } }).approval_resolved;
        if (resolved) {
          setPendingApproval(prev => (prev?.id === resolved.id ? null : prev));
          setStatusText('Thinking…');
          return;
        }

        // Coding harnesses speak their own envelope: prose arrives as text events and
        // each tool use is announced separately, so the transcript shows what
        // it did rather than going silent between edits.
        const coding = (data as unknown as {
          coding_event?: {
            type?: string;
            text?: string;
            id?: string;
            name?: string;
            status?: 'start' | 'done' | 'error';
            category?: 'command' | 'file_write' | 'file_edit' | 'file_read' | 'tool';
            file?: string;
            command?: string;
            detail?: string;
            input?: Record<string, unknown>;
          };
        }).coding_event;
        if (coding) {
          if (coding.type === 'text' && coding.text) {
            fullContent += coding.text;
            assistantContentForSave = fullContent;
          } else if (coding.type === 'tool' && coding.name) {
            const actId = coding.id || `coding_tool_${currentToolActivities.length}`;
            const existingIdx = currentToolActivities.findIndex(a => a.id === actId);
            const activity: import('../types/chat').ToolActivity = {
              id: actId,
              tool: coding.name,
              name: coding.name,
              category: coding.category || 'tool',
              status: coding.status || 'done',
              file: coding.file,
              command: coding.command,
              detail: coding.detail || coding.name,
              timestamp: Date.now(),
            };
            if (existingIdx >= 0) {
              currentToolActivities[existingIdx] = { ...currentToolActivities[existingIdx], ...activity };
            } else {
              currentToolActivities.push(activity);
            }

          } else if (coding.type === 'usage' && (coding as unknown as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage) {
            const u = (coding as unknown as { usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage;
            if (typeof u.prompt_tokens === 'number') promptTokens = u.prompt_tokens;
            if (typeof u.completion_tokens === 'number') completionTokens = u.completion_tokens;
            finalUsage = u.total_tokens ?? ((promptTokens ?? 0) + (completionTokens ?? 0));
            if (currentChatIdRef.current === chatId && finalUsage > 0) {
              setContextWindow(prev => ({ ...prev, current: finalUsage }));
            }
          }

          syncUIAndHistory();
          return;
        }

        // The harness reports failures inline rather than as an HTTP status,
        // because the stream has already started by then.
        const codingError = (data as unknown as { error?: string }).error;
        if (codingError) {
          const harnessLabel = chosenHarness === 'deepseek-harness' ? 'DeepSeek Harness' : 'Pi Harness';
          fullContent += `${fullContent ? '\n\n' : ''}> [!WARNING]\n> **${harnessLabel} Notice**\n> ${codingError}`;
          assistantContentForSave = fullContent;
          setStatusText(`${harnessLabel}: ${codingError}`);
          syncUIAndHistory();
          return;
        }

        // Tool event — update status and record toolActivity
        if ((data as unknown as { tool_event?: boolean }).tool_event) {
          const td = data as unknown as {
            tool?: string;
            id?: string;
            status?: 'start' | 'done' | 'error';
            category?: 'command' | 'file_write' | 'file_edit' | 'file_read' | 'document' | 'tool';
            file?: string;
            command?: string;
            detail?: string;
          };
          const toolName = td.tool || 'tool';
          const actId = td.id || `tool_${currentToolActivities.length}`;
          const existingIdx = currentToolActivities.findIndex(a => a.id === actId);
          const activity: import('../types/chat').ToolActivity = {
            id: actId,
            tool: toolName,
            name: toolName,
            category: td.category || 'tool',
            status: td.status || 'done',
            file: td.file,
            command: td.command,
            detail: td.detail,
            timestamp: Date.now(),
          };
          if (existingIdx >= 0) {
            currentToolActivities[existingIdx] = { ...currentToolActivities[existingIdx], ...activity };
          } else {
            currentToolActivities.push(activity);
          }

          const msgs: Record<string, string> = {
            create_document: 'Creating document...',
            read_file: 'Reading file…',
            search_files: 'Searching project files…',
            search_web: 'Searching the web…',
            list_directory: 'Analyzing directory…',
            run_command: 'Executing command…',
            load_skill: 'Loading skill…',
            write_file: 'Writing file…',
            edit_file: 'Editing file…',
          };
          const statusDesc = td.file ? `${msgs[toolName] ?? toolName} (${td.file})` : td.command ? `${msgs[toolName] ?? toolName}: ${td.command}` : msgs[toolName] ?? 'Thinking…';
          setStatusText(statusDesc);
          syncUIAndHistory();
          return;
        }

        let generatedFileAdded = false;
        if (data.generated_file) {
          const file = data.generated_file;
          const link = `[Download ${file.name}](${file.url})`;
          if (!fullContent.includes(file.url)) {
            fullContent += `${fullContent ? '\n\n' : ''}${link}`;
            assistantContentForSave = fullContent;
            generatedFileAdded = true;
          }
          setStatusText(`Created ${file.name}`);
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

        if (!contentChunk && !data.done && !generatedFileAdded) return;
        syncUIAndHistory();
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

      if (finalUsage === 0) {
        const est = Math.max(1, Math.ceil(((messageContent?.length ?? 0) + fullContent.length) / 4));
        finalUsage = est;
        if (currentChatIdRef.current === chatId) {
          setContextWindow(prev => ({ ...prev, current: finalUsage }));
        }
      }

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
        timestamp: finishedAt,
        promptTokens: promptTokens ?? null,
        completionTokens: completionTokens ?? null,
        toolActivities: currentToolActivities.length > 0 ? [...currentToolActivities] : undefined,
      };

      const updateFinal = (conv: Message[]) => {
        if (!conv.length) return conv;
        const updated = [...conv];
        const last = updated.length - 1;
        if (updated[last]?.role === 'assistant') {
          updated[last] = {
            ...updated[last],
            content: assistantContentForSave,
            timestamp: finishedAt,
            promptTokens: assistantToPersist.promptTokens,
            completionTokens: assistantToPersist.completionTokens,
            toolActivities: currentToolActivities.length > 0 ? [...currentToolActivities] : undefined,
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

      abortControllersMapRef.current.delete(chatId);
      setSendingChatIds(prev => {
        if (!prev[chatId]) return prev;
        const next = { ...prev };
        delete next[chatId];
        return next;
      });

      if (isActiveRequest) {
        activeRequestIdRef.current = null;
        if (abortRef) abortRef.current = null;
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
