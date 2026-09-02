import { useState, useMemo } from 'react';
import type { ApiProject } from '../types/chat';
import { DATE_FORMATTER } from '../lib/date';
import { useChat } from '../context/ChatContext';
import './ProjectsLanding.css';

export function ProjectsLanding() {
  const {
    projects,
    sortedHistories: chats,
    selectedProjectId,
    setViewMode,
    handleSelectProject,
    handleCreateProject,
    handleUpdateProject,
    handleDeleteProject,
    handleNewChat,
  } = useChat();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'pinned' | 'active'>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'name' | 'chats' | 'tokens'>('recent');

  // Modal / Form states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);

  // Rename state
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // Delete confirm state
  const [deletingProject, setDeletingProject] = useState<ApiProject | null>(null);

  // Active menu dropdown ID
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Calculate stats map per project
  const projectStatsMap = useMemo(() => {
    const stats = new Map<string, { chatCount: number; tokenCount: number; lastUpdated: number }>();

    for (const project of projects) {
      stats.set(project.id, { chatCount: 0, tokenCount: 0, lastUpdated: project.createdAt });
    }

    for (const [, chat] of chats) {
      if (chat.projectId && stats.has(chat.projectId)) {
        const current = stats.get(chat.projectId)!;
        current.chatCount += 1;
        current.tokenCount += chat.usage || 0;
        if (chat.updatedAt > current.lastUpdated) {
          current.lastUpdated = chat.updatedAt;
        }
      }
    }

    return stats;
  }, [projects, chats]);

  // Overall workspace stats
  const totalStats = useMemo(() => {
    let totalChats = 0;
    let totalTokens = 0;

    for (const [, s] of projectStatsMap) {
      totalChats += s.chatCount;
      totalTokens += s.tokenCount;
    }

    return {
      totalProjects: projects.length,
      totalChats,
      totalTokens,
    };
  }, [projects.length, projectStatsMap]);

  // Format token counts cleanly
  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  };

  // Filter and sort projects
  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const filtered = projects.filter((p) => {
      // Tab filter
      if (filterTab === 'pinned' && !p.pinned) return false;
      if (filterTab === 'active') {
        const stats = projectStatsMap.get(p.id);
        if (!stats || stats.chatCount === 0) return false;
      }

      // Search query
      if (!query) return true;
      const matchName = p.name.toLowerCase().includes(query);
      const matchDesc = p.description?.toLowerCase().includes(query) ?? false;
      return matchName || matchDesc;
    });

    // Sorting
    return filtered.sort((a, b) => {
      // Pinned always on top if in 'all' view
      if (filterTab === 'all') {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
      }

      const statsA = projectStatsMap.get(a.id);
      const statsB = projectStatsMap.get(b.id);

      if (sortBy === 'chats') {
        return (statsB?.chatCount ?? 0) - (statsA?.chatCount ?? 0);
      }
      if (sortBy === 'tokens') {
        return (statsB?.tokenCount ?? 0) - (statsA?.tokenCount ?? 0);
      }
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      }

      // Default: recent
      const lastA = statsA?.lastUpdated ?? a.createdAt;
      const lastB = statsB?.lastUpdated ?? b.createdAt;
      return lastB - lastA;
    });
  }, [projects, searchQuery, filterTab, sortBy, projectStatsMap]);

  // Handlers
  const handleOpenProject = (projectId: string) => {
    handleSelectProject(projectId);
    setViewMode('project');
  };

  const handleStartChatInProject = (projectId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    handleSelectProject(projectId);
    handleNewChat();
    setViewMode('chat');
  };

  const handleTogglePin = (projectId: string, currentPinned: boolean, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    handleUpdateProject(projectId, { pinned: !currentPinned });
  };

  const handleCommitCreate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newProjectName.trim() || isSubmittingCreate) return;

    setIsSubmittingCreate(true);
    try {
      const created = await handleCreateProject(newProjectName.trim(), newProjectDesc.trim());
      setIsCreateModalOpen(false);
      setNewProjectName('');
      setNewProjectDesc('');
      if (created) {
        handleSelectProject(created.id);
        setViewMode('project');
      }
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  const handleCommitRename = (projectId: string) => {
    const trimmed = editingName.trim();
    if (trimmed && trimmed !== projects.find((p) => p.id === projectId)?.name) {
      handleUpdateProject(projectId, { name: trimmed });
    }
    setEditingProjectId(null);
    setEditingName('');
  };

  const handleConfirmDelete = async () => {
    if (!deletingProject) return;
    await handleDeleteProject(deletingProject.id);
    setDeletingProject(null);
  };

  return (
    <div className="projects-landing" onClick={() => setActiveMenuId(null)}>
      {/* Header Banner */}
      <header className="projects-landing__header">
        <div className="projects-landing__top-bar">
          <button
            className="btn btn-secondary btn-back-to-chat"
            type="button"
            onClick={() => setViewMode('chat')}
            title="Return to chat"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span>Back to Chat</span>
          </button>

          <button
            className="btn btn-primary btn-create-top"
            type="button"
            onClick={() => {
              setIsCreateModalOpen(true);
              setNewProjectName('');
              setNewProjectDesc('');
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>New Workspace</span>
          </button>
        </div>

        <div className="projects-landing__hero">
          <div className="projects-landing__title-wrap">
            <div className="projects-landing__icon-badge" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2H2v10h10V2z" />
                <path d="M22 12h-10v10h10V12z" />
                <path d="M12 12H2v10h10V12z" />
                <path d="M22 2h-10v10h10V2z" />
              </svg>
            </div>
            <div>
              <h1 className="projects-landing__title">Workspaces & Projects</h1>
              <p className="projects-landing__subtitle">
                Organize conversations, tailored prompts, and project memory across independent spaces.
              </p>
            </div>
          </div>

          {/* Global Stats Banner */}
          <div className="projects-landing__stats-row">
            <div className="projects-stat-pill">
              <span className="projects-stat-pill__value">{totalStats.totalProjects}</span>
              <span className="projects-stat-pill__label">Workspaces</span>
            </div>
            <div className="projects-stat-pill">
              <span className="projects-stat-pill__value">{totalStats.totalChats}</span>
              <span className="projects-stat-pill__label">Conversations</span>
            </div>
            {totalStats.totalTokens > 0 && (
              <div className="projects-stat-pill">
                <span className="projects-stat-pill__value">{formatTokens(totalStats.totalTokens)}</span>
                <span className="projects-stat-pill__label">Tokens Used</span>
              </div>
            )}
          </div>
        </div>

        {/* Toolbar: Search, Filter Tabs, Sort */}
        <div className="projects-landing__toolbar">
          <div className="projects-landing__search-box">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              placeholder="Search workspaces by name or description…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="projects-landing__search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="projects-landing__search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>

          <div className="projects-landing__controls">
            {/* Filter Tabs */}
            <div className="projects-filter-tabs">
              <button
                type="button"
                className={`filter-tab ${filterTab === 'all' ? 'is-active' : ''}`}
                onClick={() => setFilterTab('all')}
              >
                All ({projects.length})
              </button>
              <button
                type="button"
                className={`filter-tab ${filterTab === 'pinned' ? 'is-active' : ''}`}
                onClick={() => setFilterTab('pinned')}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                Favorites
              </button>
              <button
                type="button"
                className={`filter-tab ${filterTab === 'active' ? 'is-active' : ''}`}
                onClick={() => setFilterTab('active')}
              >
                Active
              </button>
            </div>

            {/* Sort Dropdown */}
            <div className="projects-sort-select-wrap">
              <label htmlFor="projects-sort" className="sr-only">Sort by</label>
              <select
                id="projects-sort"
                className="projects-sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              >
                <option value="recent">Recently Active</option>
                <option value="name">Alphabetical</option>
                <option value="chats">Most Chats</option>
                <option value="tokens">Most Tokens</option>
              </select>
            </div>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="projects-landing__content">
        <div className="projects-grid">
          {/* Quick Create Card */}
          <div
            className="project-card project-card--create"
            onClick={() => {
              setIsCreateModalOpen(true);
              setNewProjectName('');
              setNewProjectDesc('');
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setIsCreateModalOpen(true);
              }
            }}
          >
            <div className="project-card--create__inner">
              <div className="create-card-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </div>
              <h3 className="create-card-title">Create Workspace</h3>
              <p className="create-card-desc">Start a fresh workspace for your coding or research projects.</p>
            </div>
          </div>

          {/* Project Cards */}
          {filteredProjects.map((project) => {
            const stats = projectStatsMap.get(project.id) || { chatCount: 0, tokenCount: 0, lastUpdated: project.createdAt };
            const isSelected = project.id === selectedProjectId;
            const hasMemory = Boolean(project.memory?.trim());
            const hasInstructions = Boolean(project.instructions?.trim());
            const isMenuOpen = activeMenuId === project.id;
            const isEditing = editingProjectId === project.id;

            return (
              <div
                key={project.id}
                className={`project-card ${isSelected ? 'project-card--selected' : ''} ${project.pinned ? 'project-card--pinned' : ''}`}
                onClick={() => handleOpenProject(project.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleOpenProject(project.id);
                  }
                }}
              >
                {/* Top Row: Avatar, Title, Star & Menu */}
                <div className="project-card__top">
                  <div className="project-card__avatar" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>

                  <div className="project-card__title-area">
                    {isEditing ? (
                      <input
                        className="project-card__rename-input"
                        value={editingName}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => handleCommitRename(project.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCommitRename(project.id);
                          if (e.key === 'Escape') setEditingProjectId(null);
                        }}
                      />
                    ) : (
                      <h3
                        className="project-card__name"
                        title={project.name}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingProjectId(project.id);
                          setEditingName(project.name);
                        }}
                      >
                        {project.name}
                      </h3>
                    )}
                  </div>

                  <div className="project-card__top-actions" onClick={(e) => e.stopPropagation()}>
                    {/* Star Favorite */}
                    <button
                      className={`icon-btn btn-star ${project.pinned ? 'is-starred' : ''}`}
                      type="button"
                      aria-label={project.pinned ? 'Remove favorite' : 'Add to favorites'}
                      title={project.pinned ? 'Remove favorite' : 'Add to favorites'}
                      onClick={(e) => handleTogglePin(project.id, Boolean(project.pinned), e)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill={project.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </button>

                    {/* Context Menu Toggle */}
                    <div className="project-card__menu-wrap">
                      <button
                        className="icon-btn btn-card-menu"
                        type="button"
                        aria-label="Workspace options"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenuId(isMenuOpen ? null : project.id);
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="5" r="1.5" fill="currentColor" />
                          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                          <circle cx="12" cy="19" r="1.5" fill="currentColor" />
                        </svg>
                      </button>

                      {isMenuOpen && (
                        <div className="project-card__dropdown-menu">
                          <button
                            type="button"
                            className="dropdown-item"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingProjectId(project.id);
                              setEditingName(project.name);
                              setActiveMenuId(null);
                            }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                            </svg>
                            Rename
                          </button>
                          <button
                            type="button"
                            className="dropdown-item"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartChatInProject(project.id);
                              setActiveMenuId(null);
                            }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                            New Chat
                          </button>
                          <div className="dropdown-divider" />
                          <button
                            type="button"
                            className="dropdown-item dropdown-item--danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingProject(project);
                              setActiveMenuId(null);
                            }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Description */}
                {project.description ? (
                  <p className="project-card__desc">
                    {project.description}
                  </p>
                ) : null}

                {/* Capability Badges */}
                <div className="project-card__badges">
                  {hasMemory && (
                    <span className="card-badge card-badge--memory" title="Has workspace memory configured">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2a4 4 0 0 0-4 4c0 .7.2 1.4.5 2H8a4 4 0 0 0-4 4 4 4 0 0 0 2 3.5V18a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4v-2.5a4 4 0 0 0 2-3.5 4 4 0 0 0-4-4h-.5c.3-.6.5-1.3.5-2a4 4 0 0 0-4-4z" />
                      </svg>
                      Memory
                    </span>
                  )}
                  {hasInstructions && (
                    <span className="card-badge card-badge--instructions" title="Has custom system prompt instructions">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      Instructions
                    </span>
                  )}
                  {project.projectRoot && (
                    <span className="card-badge card-badge--root" title={`Bound to path: ${project.projectRoot}`}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                      Folder
                    </span>
                  )}
                </div>

                {/* Footer Metrics & Actions */}
                <div className="project-card__footer">
                  <div className="project-card__metrics">
                    <span className="metric-item" title="Total conversations in this workspace">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      {stats.chatCount}
                    </span>
                    {stats.tokenCount > 0 && (
                      <span className="metric-item" title="Total tokens consumed">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        {formatTokens(stats.tokenCount)}
                      </span>
                    )}
                    <span className="metric-date" title={`Created ${DATE_FORMATTER.format(project.createdAt)}`}>
                      {DATE_FORMATTER.format(project.createdAt)}
                    </span>
                  </div>

                  <div className="project-card__cta" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm btn-open-workspace"
                      onClick={() => handleOpenProject(project.id)}
                      title="Open workspace"
                    >
                      <span>Open</span>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Empty State */}
        {filteredProjects.length === 0 && (
          <div className="projects-empty-state">
            <div className="empty-state-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 2H2v10h10V2z" />
                <path d="M22 12h-10v10h10V12z" />
                <path d="M12 12H2v10h10V12z" />
                <path d="M22 2h-10v10h10V2z" />
              </svg>
            </div>
            {searchQuery ? (
              <>
                <h3>No workspaces found</h3>
                <p>No projects match your search for "<strong>{searchQuery}</strong>".</p>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setSearchQuery('')}
                >
                  Clear Search Filter
                </button>
              </>
            ) : filterTab === 'pinned' ? (
              <>
                <h3>No favorite workspaces</h3>
                <p>You haven't starred any workspaces yet. Click the star icon on any card to add it to favorites.</p>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setFilterTab('all')}
                >
                  View All Workspaces
                </button>
              </>
            ) : (
              <>
                <h3>No workspaces yet</h3>
                <p>Create your first workspace to organize project chats, context memory, and prompts.</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setIsCreateModalOpen(true);
                    setNewProjectName('');
                    setNewProjectDesc('');
                  }}
                >
                  + Create Workspace
                </button>
              </>
            )}
          </div>
        )}
      </main>

      {/* Create Project Modal */}
      {isCreateModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsCreateModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Create New Workspace</h2>
              <button
                type="button"
                className="icon-btn btn-modal-close"
                onClick={() => setIsCreateModalOpen(false)}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleCommitCreate} className="modal-form">
              <div className="form-group">
                <label htmlFor="modal-project-name" className="form-label">Workspace Name *</label>
                <input
                  id="modal-project-name"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Mobile App Redesign, Python Backend, Thesis"
                  autoFocus
                  required
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="modal-project-desc" className="form-label">Description (Optional)</label>
                <textarea
                  id="modal-project-desc"
                  className="form-textarea"
                  placeholder="Briefly describe what this workspace is focused on…"
                  rows={3}
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-modal-cancel"
                  onClick={() => setIsCreateModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-modal-submit"
                  disabled={!newProjectName.trim() || isSubmittingCreate}
                >
                  {isSubmittingCreate ? 'Creating…' : 'Create Workspace'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deletingProject && (
        <div className="modal-backdrop" onClick={() => setDeletingProject(null)}>
          <div className="modal-dialog modal-dialog--danger" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Delete Workspace</h2>
              <button
                type="button"
                className="icon-btn btn-modal-close"
                onClick={() => setDeletingProject(null)}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <p>
                Are you sure you want to delete workspace <strong>"{deletingProject.name}"</strong>?
              </p>
              <p className="modal-body-sub">
                This will delete the workspace and all of its associated conversations. This action cannot be undone.
              </p>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary btn-modal-cancel"
                onClick={() => setDeletingProject(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-modal-delete"
                onClick={handleConfirmDelete}
              >
                Delete Workspace
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
