import { useChat } from '../context/ChatContext';
import './ApprovalPrompt.css';

/** Shortened preview so a large write does not flood the prompt. */
const PREVIEW_LIMIT = 600;

function preview(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.length > PREVIEW_LIMIT ? `${value.slice(0, PREVIEW_LIMIT)}\n…` : value;
}

/**
 * Blocks a state-changing tool call until the user decides.
 *
 * The agent can write files and run commands; without this the first the user
 * hears of a change is after it has already happened on disk.
 */
export function ApprovalPrompt() {
  const { pendingApproval, respondToApproval } = useChat();

  if (!pendingApproval) return null;

  const { tool, summary, details } = pendingApproval;
  const content = preview(details.content);
  const oldString = preview(details.old_string);
  const newString = preview(details.new_string);

  return (
    <div className="approval-prompt" role="alertdialog" aria-label="Tool approval required">
      <div className="approval-prompt__header">
        <span className="approval-prompt__badge">{tool}</span>
        <span className="approval-prompt__summary">{summary}</span>
      </div>

      {content && (
        <pre className="approval-prompt__body">{content}</pre>
      )}

      {oldString && (
        <div className="approval-prompt__diff">
          <pre className="approval-prompt__body is-removed">{oldString}</pre>
          <pre className="approval-prompt__body is-added">{newString}</pre>
        </div>
      )}

      <div className="approval-prompt__actions">
        <button
          type="button"
          className="approval-prompt__btn"
          onClick={() => void respondToApproval(false)}
        >
          Decline
        </button>
        <button
          type="button"
          className="approval-prompt__btn is-primary"
          onClick={() => void respondToApproval(true)}
          autoFocus
        >
          Allow
        </button>
      </div>
    </div>
  );
}
