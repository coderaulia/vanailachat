import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ChatHeader } from './components/ChatHeader';
import { ChatLog } from './components/ChatLog';
import { Composer } from './components/Composer';
import { ApprovalPrompt } from './components/ApprovalPrompt';
import './App.css';
import { Sidebar } from './components/Sidebar';
import { useMarkdownRenderer } from './hooks/useMarkdownRenderer';
import { ChatProvider, useChat } from './context/ChatContext';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { OnboardingWizard, useOnboarding } from './components/OnboardingWizard';
import { setPricingOverrides } from './config/modelPricing';

// Rendered only on demand, so they are kept out of the initial bundle.
// OnboardingWizard stays eager: useOnboarding runs on every load.
const SettingsModal = lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal })),
);
const ProjectDetail = lazy(() =>
  import('./components/ProjectDetail').then((m) => ({ default: m.ProjectDetail })),
);

const AppShell = () => {
  const renderMarkdown = useMarkdownRenderer();
  const thinkingStart = useRef<number | null>(null);
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [showTokens, setShowTokens] = useState(false);
  const { show: showOnboarding, markDone } = useOnboarding();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Per-model rates the built-in table cannot know — a gateway serves its own
  // model names at its own prices. Stored as JSON in the model_pricing setting.
  useEffect(() => {
    fetch('/api/settings/model_pricing')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const raw = (data as { value?: string } | null)?.value;
        if (raw) setPricingOverrides(JSON.parse(raw));
      })
      .catch(() => {
        // No overrides configured — built-in rates still apply.
      });
  }, []);

  const {
    currentChatId,
    isCurrentChatSending,
    isSidebarOpen,
    projects,
    selectedProjectId,
    viewMode,
    handleNewChat,
    toggleSidebar,
    setIsSearchEnabled,
    handleAbort,
    setViewMode,
  } = useChat();

  const shortcutsMap = useMemo(() => ({
    'ctrl+n': () => { handleNewChat(); setViewMode('chat'); },
    'ctrl+/': () => toggleSidebar(),
    'alt+s': () => setIsSearchEnabled((prev: boolean) => !prev),
    'escape': () => {
      if (isSettingsOpen) {
        setIsSettingsOpen(false);
      } else if (isCurrentChatSending) {
        handleAbort();
      }
    },
  }), [handleNewChat, toggleSidebar, setIsSearchEnabled, isSettingsOpen, isCurrentChatSending, handleAbort, setViewMode]);

  useKeyboardShortcuts(shortcutsMap);

  useEffect(() => {
    if (isCurrentChatSending) {
      if (thinkingStart.current === null) {
        thinkingStart.current = Date.now();
      }

      setThinkingSeconds(Math.floor((Date.now() - thinkingStart.current) / 1000));

      const intervalId = window.setInterval(() => {
        if (thinkingStart.current === null) {
          return;
        }
        setThinkingSeconds(Math.floor((Date.now() - thinkingStart.current) / 1000));
      }, 1000);

      return () => {
        window.clearInterval(intervalId);
      };
    }

    thinkingStart.current = null;
    setThinkingSeconds(0);
    return undefined;
  }, [isCurrentChatSending]);

  return (
    <div className={`app-shell ${isSidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      {showOnboarding && <OnboardingWizard onDone={markDone} />}
      {isSettingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal onClose={() => setIsSettingsOpen(false)} />
        </Suspense>
      )}
      <Sidebar onOpenSettings={() => setIsSettingsOpen(true)} />

      <main className="main-content">
        {(viewMode === 'chat' || currentChatId) ? (
          <>
            <ChatHeader
              showTokens={showTokens}
              thinkingSeconds={thinkingSeconds}
              onToggleShowTokens={() => setShowTokens((previous) => !previous)}
            />

            <ChatLog
              showTokens={showTokens}
              renderMarkdown={renderMarkdown}
            />

            <ApprovalPrompt />
            <Composer thinkingSeconds={thinkingSeconds} />
          </>
        ) : (
          (() => {
            const currentProject = projects.find(p => p.id === selectedProjectId);
            if (currentProject) {
              return (
                <Suspense fallback={null}>
                  <ProjectDetail />
                </Suspense>
              );
            }
            return (
              <div className="welcome-screen">
                <div className="welcome-content">
                  <h1>Welcome to Vanaila Chat</h1>
                  <p>Create a project or select an existing one to get started.</p>
                </div>
              </div>
            );
          })()
        )}
      </main>
    </div>
  );
};

export default function App() {
  return (
    <ChatProvider>
      <AppShell />
    </ChatProvider>
  );
}
