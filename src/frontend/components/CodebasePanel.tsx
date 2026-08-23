import React, { useState } from 'react';
import type { ToolActivity, PendingApproval } from '../types/chat';
import './CodebasePanel.css';

interface CodebasePanelProps {
  isOpen: boolean;
  onClose: () => void;
  activities: ToolActivity[];
  pendingApproval: PendingApproval | null;
  onRespondApproval: (approved: boolean, autoApprove?: boolean) => void;
  workspacePath?: string;
}

export const CodebasePanel: React.FC<CodebasePanelProps> = ({
  isOpen,
  onClose,
  activities,
  pendingApproval,
  onRespondApproval,
  workspacePath: _workspacePath,
}) => {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  if (!isOpen) return null;

  // Extract unique modified files from activities
  const modifiedFilesMap = new Map<string, { file: string; category: string; status: string; detail?: string; activity: ToolActivity }>();
  for (const act of activities) {
    if (act.file) {
      modifiedFilesMap.set(act.file, {
        file: act.file,
        category: act.category || 'tool',
        status: act.status,
        detail: act.detail,
        activity: act,
      });
    }
  }
  const modifiedFiles = Array.from(modifiedFilesMap.values());

  const selectedActivity = selectedFile
    ? activities.find((a) => a.file === selectedFile)
    : null;

  return (
    <aside className="codebase-panel" aria-label="Codebase Activity and Changes">
      {/* Header */}
      <div className="codebase-panel__header">
        <div className="codebase-panel__title-group">
          <h3 className="codebase-panel__title">
            <span>⚡</span> Codebase Activity
          </h3>
        </div>
        <button
          type="button"
          className="codebase-panel__close-btn"
          onClick={onClose}
          title="Close panel"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div className="codebase-panel__content">
        {/* Pending Approval Section */}
        {pendingApproval && (
          <div className="codebase-section" style={{ background: 'rgba(210, 153, 34, 0.08)', padding: '12px', borderRadius: '12px', border: '1px solid rgba(210, 153, 34, 0.3)' }}>
            <div className="codebase-section__header">
              <span className="codebase-section__title" style={{ color: '#d29922' }}>
                ⚠️ Approval Required
              </span>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-primary)', marginTop: '4px' }}>
              <strong>{pendingApproval.tool}</strong>: {pendingApproval.summary}
            </div>
            {pendingApproval.details?.command && (
              <pre className="tool-feed-item__command" style={{ marginTop: '6px' }}>
                $ {String(pendingApproval.details.command)}
              </pre>
            )}
            {pendingApproval.details?.path && (
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Target: <code>{String(pendingApproval.details.path)}</code>
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ flex: 1, padding: '6px', fontSize: '11px' }}
                onClick={() => onRespondApproval(false)}
              >
                Decline
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 1, padding: '6px', fontSize: '11px' }}
                onClick={() => onRespondApproval(true, false)}
              >
                Allow Once
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 1.2, padding: '6px', fontSize: '11px', background: '#d29922', color: '#000' }}
                onClick={() => onRespondApproval(true, true)}
                title="Allow this tool and auto-approve all remaining operations"
              >
                ⚡ Allow All
              </button>
            </div>
          </div>
        )}

        {/* Touched & Modified Files */}
        <div className="codebase-section">
          <div className="codebase-section__header">
            <span className="codebase-section__title">Modified & Touched Files</span>
            <span className="codebase-section__badge">{modifiedFiles.length}</span>
          </div>

          {modifiedFiles.length === 0 ? (
            <div className="codebase-panel__empty">
              No files modified or read in this session yet.
            </div>
          ) : (
            <div className="modified-files-list">
              {modifiedFiles.map(({ file, category }) => (
                <div
                  key={file}
                  className={`modified-file-item ${selectedFile === file ? 'active' : ''}`}
                  onClick={() => setSelectedFile(selectedFile === file ? null : file)}
                >
                  <div className="modified-file-item__left">
                    <span className="modified-file-item__icon">
                      {category === 'file_write' ? '📄' : category === 'file_edit' ? '📝' : '🔍'}
                    </span>
                    <span className="modified-file-item__name" title={file}>
                      {file}
                    </span>
                  </div>
                  <span
                    className={`modified-file-item__tag ${
                      category === 'file_write'
                        ? 'modified-file-item__tag--created'
                        : category === 'file_edit'
                          ? 'modified-file-item__tag--edited'
                          : 'modified-file-item__tag--read'
                    }`}
                  >
                    {category === 'file_write' ? 'Created' : category === 'file_edit' ? 'Modified' : 'Read'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Diff Inspector (if file selected) */}
        {selectedFile && selectedActivity && (
          <div className="diff-inspector">
            <div className="diff-inspector__header">
              <span className="diff-inspector__title">📄 {selectedFile}</span>
              <button
                type="button"
                style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer' }}
                onClick={() => setSelectedFile(null)}
              >
                ✕
              </button>
            </div>
            <div className="diff-inspector__body">
              {selectedActivity.detail && (
                <div style={{ fontSize: '11px', color: '#8b949e' }}>
                  {selectedActivity.detail}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Live Execution Stream */}
        <div className="codebase-section">
          <div className="codebase-section__header">
            <span className="codebase-section__title">Command & Tool Execution</span>
            <span className="codebase-section__badge">{activities.length}</span>
          </div>

          {activities.length === 0 ? (
            <div className="codebase-panel__empty">
              Tool and terminal commands will appear here in real-time.
            </div>
          ) : (
            <div className="tool-feed-list">
              {activities.slice().reverse().map((act) => (
                <div key={act.id} className="tool-feed-item">
                  <span className="tool-feed-item__icon">
                    {act.category === 'command' ? '⚡' : act.category === 'file_edit' ? '📝' : '🔧'}
                  </span>
                  <div className="tool-feed-item__body">
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      {act.tool}
                    </div>
                    {act.command && (
                      <div className="tool-feed-item__command">$ {act.command}</div>
                    )}
                    {act.file && (
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        {act.file}
                      </div>
                    )}
                    {act.detail && !act.command && (
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        {act.detail}
                      </div>
                    )}
                  </div>
                  <span
                    className={`tool-feed-item__status ${
                      act.status === 'done'
                        ? 'tool-feed-item__status--done'
                        : act.status === 'start'
                          ? 'tool-feed-item__status--running'
                          : 'tool-feed-item__status--error'
                    }`}
                  >
                    {act.status === 'done' ? 'Done' : act.status === 'start' ? 'Running…' : 'Failed'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
