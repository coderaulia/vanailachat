import { useChat } from '../context/ChatContext';
import './ApprovalPrompt.css';

/** Shortened preview so a large write does not flood the prompt. */
const PREVIEW_LIMIT = 800;

function preview(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.length > PREVIEW_LIMIT ? `${value.slice(0, PREVIEW_LIMIT)}\n…` : value;
}

/**
 * Blocks a state-changing tool call until the user decides.
 *
 * The agent can write files and run commands; provides clear description
 * of the command or file diff before any disk changes take place.
 */
export function ApprovalPrompt() {
  const { pendingApproval, respondToApproval } = useChat();

  if (!pendingApproval) return null;

  const { tool, summary, details } = pendingApproval;
  const category = details.category || (
    tool.toLowerCase().includes('bash') || tool.toLowerCase().includes('command') ? 'command' :
    tool.toLowerCase().includes('edit') || tool.toLowerCase().includes('replace') ? 'file_edit' :
    tool.toLowerCase().includes('write') ? 'file_write' : 'tool'
  );

  const command = details.command || (typeof details.cmd === 'string' ? details.cmd : null);
  const filePath = details.path || (typeof details.file_path === 'string' ? details.file_path : null);
  const content = preview(details.content || (typeof details.text === 'string' ? details.text : null));
  const oldString = preview(details.old_string || (typeof details.oldString === 'string' ? details.oldString : null));
  const newString = preview(details.new_string || (typeof details.newString === 'string' ? details.newString : null));

  const categoryLabels: Record<string, { label: string; icon: string; badgeClass: string }> = {
    command: { label: 'Terminal Command', icon: '⚡', badgeClass: 'is-command' },
    file_write: { label: 'Create / Write File', icon: '📄', badgeClass: 'is-write' },
    file_edit: { label: 'Modify Code / File', icon: '📝', badgeClass: 'is-edit' },
    document: { label: 'Create Document', icon: '📑', badgeClass: 'is-write' },
    tool: { label: 'Tool Execution', icon: '🛠️', badgeClass: 'is-tool' },
  };

  const currentCat = categoryLabels[category] || categoryLabels.tool;

  return (
    <div className="approval-prompt" role="alertdialog" aria-label="Tool approval required">
      <div className="approval-prompt__header">
        <div className="approval-prompt__header-left">
          <span className={`approval-prompt__badge ${currentCat.badgeClass}`}>
            <span className="approval-prompt__badge-icon">{currentCat.icon}</span>
            {currentCat.label}
          </span>
          <span className="approval-prompt__tool-name">{tool}</span>
        </div>
        <span className="approval-prompt__summary">{summary}</span>
      </div>

      {command && (
        <div className="approval-prompt__command-box">
          <div className="approval-prompt__section-title">Command to run:</div>
          <pre className="approval-prompt__command"><code>$ {command}</code></pre>
        </div>
      )}

      {filePath && (
        <div className="approval-prompt__file-target">
          <span className="approval-prompt__file-icon">📁</span>
          <span className="approval-prompt__file-label">Target:</span>
          <code className="approval-prompt__file-path">{filePath}</code>
        </div>
      )}

      {(oldString || newString) && (
        <div className="approval-prompt__diff-container">
          <div className="approval-prompt__section-title">Code Changes:</div>
          <div className="approval-prompt__diff">
            {oldString && (
              <div className="approval-prompt__diff-part">
                <span className="approval-prompt__diff-tag is-removed">- Original</span>
                <pre className="approval-prompt__body is-removed">{oldString}</pre>
              </div>
            )}
            {newString && (
              <div className="approval-prompt__diff-part">
                <span className="approval-prompt__diff-tag is-added">+ Modified</span>
                <pre className="approval-prompt__body is-added">{newString}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      {!oldString && !newString && content && (
        <div className="approval-prompt__content-container">
          <div className="approval-prompt__section-title">File Content Preview:</div>
          <pre className="approval-prompt__body">{content}</pre>
        </div>
      )}

      <div className="approval-prompt__footer">
        <span className="approval-prompt__tip">
          Approve this action or turn on auto-approve for the session.
        </span>
        <div className="approval-prompt__actions">
          <button
            type="button"
            className="approval-prompt__btn is-decline"
            onClick={() => void respondToApproval(false)}
          >
            Decline
          </button>
          <button
            type="button"
            className="approval-prompt__btn is-allow-all"
            title="Approve this and auto-approve all subsequent tools in this session"
            onClick={() => void respondToApproval(true, true)}
          >
            ⚡ Allow All (Auto-Approve)
          </button>
          <button
            type="button"
            className="approval-prompt__btn is-primary"
            onClick={() => void respondToApproval(true)}
            autoFocus
          >
            Allow Once
          </button>
        </div>
      </div>
    </div>
  );
}
