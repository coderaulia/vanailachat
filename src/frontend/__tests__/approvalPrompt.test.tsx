// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import * as ChatContext from '../context/ChatContext';
import { ApprovalPrompt } from '../components/ApprovalPrompt';
import type { PendingApproval } from '../types/chat';

function show(approval: PendingApproval) {
  vi.spyOn(ChatContext, 'useChat').mockReturnValue({ pendingApproval: approval, respondToApproval: vi.fn() } as unknown as ReturnType<typeof ChatContext.useChat>);
  render(<ApprovalPrompt />);
}

describe('ApprovalPrompt', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows an overwrite as before and after', () => {
    show({
      id: 'a1', tool: 'write_file', summary: 'Write src/main.rs (9 bytes)',
      details: { category: 'file_write', path: 'src/main.rs', old_string: 'old text', content: 'new text', overwrites: true },
    });
    expect(screen.getByText('- Original').nextElementSibling?.textContent).toBe('old text');
    expect(screen.getByText('+ Modified').nextElementSibling?.textContent).toBe('new text');
  });

  it('shows a brand-new file as a plain content preview', () => {
    show({ id: 'a2', tool: 'write_file', summary: 'Write new.txt', details: { category: 'file_write', path: 'new.txt', content: 'hello' } });
    expect(screen.queryByText('- Original')).toBeNull();
    expect(screen.getByText('File Content Preview:')).toBeDefined();
  });
});
