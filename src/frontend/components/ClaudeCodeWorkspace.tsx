import { useEffect, useRef, useState } from 'react';
import { useChat } from '../context/ChatContext';
import './ClaudeCodeWorkspace.css';

interface HarnessStatus { id: string; label: string; available: boolean; reason?: string; }
interface Approval { id: string; tool: string; summary: string; details: Record<string, unknown>; }

export function ClaudeCodeWorkspace({ onClose }: { onClose: () => void }) {
  const { currentChatId, selectedProjectId, projects, projectRoot } = useChat();
  const [harness, setHarness] = useState<HarnessStatus | null>(null);
  const [workspacePath, setWorkspacePath] = useState(projectRoot);
  const [prompt, setPrompt] = useState('');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);
  const chatIdRef = useRef(currentChatId ?? '');

  useEffect(() => {
    void fetch('/api/coding/harnesses')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Unable to check Claude Code')))
      .then((body: { harnesses?: HarnessStatus[] }) => setHarness(body.harnesses?.find((item) => item.id === 'claude-code') ?? null))
      .catch((error: Error) => setHarness({ id: 'claude-code', label: 'Claude Code', available: false, reason: error.message }));
  }, []);

  const ensureSession = async () => {
    const chatId = chatIdRef.current || `claude_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const projectId = selectedProjectId ?? projects[0]?.id;
    if (!projectId) throw new Error('Select a project before opening Claude Code');
    if (!workspacePath.trim()) throw new Error('Choose a workspace directory first');

    if (!chatIdRef.current) {
      const chatResponse = await fetch('/api/chats', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: chatId, projectId, title: 'Claude Code workspace', role: 'coding', projectRoot: workspacePath }),
      });
      if (!chatResponse.ok) throw new Error(await chatResponse.text());
      chatIdRef.current = chatId;
    }
    const sessionResponse = await fetch('/api/coding/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, harness: 'claude-code', workspacePath }),
    });
    if (!sessionResponse.ok) throw new Error(await sessionResponse.text());
    return chatId;
  };

  const respondToApproval = async (approved: boolean) => {
    if (!approval) return;
    await fetch('/api/chat/approve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: approval.id, approved }),
    });
    setApproval(null);
  };

  const run = async (mode: 'plan' | 'implement') => {
    if (!prompt.trim() || running) return;
    setRunning(true);
    setOutput('');
    try {
      const chatId = await ensureSession();
      const response = await fetch('/api/coding/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, prompt, mode }),
      });
      if (!response.ok || !response.body) throw new Error(await response.text());
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { coding_event?: { type?: string; text?: string; name?: string }; approval_request?: Approval; error?: string };
          if (event.approval_request) setApproval(event.approval_request);
          if (event.coding_event?.type === 'text' && event.coding_event.text) setOutput((previous) => previous + event.coding_event!.text);
          if (event.coding_event?.type === 'tool') setOutput((previous) => `${previous}\n\n[Claude Code: ${event.coding_event?.name}]\n`);
          if (event.error) setOutput((previous) => `${previous}\n\nError: ${event.error}`);
        }
      }
    } catch (error) {
      setOutput(error instanceof Error ? `Error: ${error.message}` : 'Error: Claude Code could not start');
    } finally {
      setRunning(false);
    }
  };

  return <div className="claude-workspace-backdrop" role="dialog" aria-modal="true" aria-label="Claude Code workspace">
    <section className="claude-workspace">
      <header><div><h2>Claude Code</h2><p>{harness?.available ? 'Local coding workspace' : harness?.reason ?? 'Checking availability…'}</p></div><button type="button" onClick={onClose} aria-label="Close">×</button></header>
      <label>Workspace directory<input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder="Absolute path to your project" /></label>
      <label>Task<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the change, bug, or review you need" rows={4} /></label>
      <div className="claude-workspace__actions"><button type="button" onClick={() => void run('plan')} disabled={!harness?.available || running}>Plan</button><button type="button" onClick={() => void run('implement')} disabled={!harness?.available || running}>Implement</button></div>
      <pre className="claude-workspace__output">{output || 'Claude Code output will appear here.'}</pre>
      {approval && <div className="claude-workspace__approval"><strong>Approval needed</strong><p>{approval.summary}</p><button type="button" onClick={() => void respondToApproval(false)}>Deny</button><button type="button" onClick={() => void respondToApproval(true)}>Allow</button></div>}
    </section>
  </div>;
}
