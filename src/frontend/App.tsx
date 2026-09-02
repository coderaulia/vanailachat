import { lazy, Suspense, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { ChatHeader } from './components/ChatHeader';
import { ChatLog } from './components/ChatLog';
import { Composer } from './components/Composer';
import { ApprovalPrompt } from './components/ApprovalPrompt';
import { CodebasePanel } from './components/CodebasePanel';
import './App.css';
import { Sidebar } from './components/Sidebar';
import { useMarkdownRenderer } from './hooks/useMarkdownRenderer';
import { ChatProvider, useChat } from './context/ChatContext';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { OnboardingWizard, useOnboarding } from './components/OnboardingWizard';
import { setPricingOverrides } from './config/modelPricing';
import { AppLogPanel } from './components/AppLogPanel';
import { installAppLogCapture } from './lib/appLog';

import { apiFetchSettings } from './lib/api';

// Rendered only on demand, so they are kept out of the initial bundle.
// OnboardingWizard stays eager: useOnboarding runs on every load.
const SettingsModal = lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal })),
);
const ProjectDetail = lazy(() =>
  import('./components/ProjectDetail').then((m) => ({ default: m.ProjectDetail })),
);
const ProjectsLanding = lazy(() =>
  import('./components/ProjectsLanding').then((m) => ({ default: m.ProjectsLanding })),
);

const AppShell = () => {
  const renderMarkdown = useMarkdownRenderer();
  const { show: showOnboarding, markDone } = useOnboarding();
  const thinkingStart = useRef<number | null>(null);
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [showTokens, setShowTokens] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const saved = localStorage.getItem('vanaila_show_tokens');
    return saved === null ? true : saved === 'true';
  });

  const handleToggleTokens = useCallback(() => {
    setShowTokens((previous) => {
      const next = !previous;
      try {
        localStorage.setItem('vanaila_show_tokens', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLogOpen, setIsLogOpen] = useState(false);

  useEffect(() => { installAppLogCapture(); }, []);

  // Per-model rates the built-in table cannot know — a gateway serves its own
  // model names at its own prices. Stored as JSON in the model_pricing setting.
  useEffect(() => {
    apiFetchSettings()
      .then((settings) => {
        const raw = settings['model_pricing'];
        if (raw) setPricingOverrides(JSON.parse(raw));
      })
      .catch(() => {
        // No overrides configured — built-in rates still apply.
      });
  }, []);

  const {
    conversation,
    pendingApproval,
    respondToApproval,
    projectRoot,
    isCurrentChatSending,
    isSidebarOpen,
    viewMode,
    handleNewChat,
    toggleSidebar,
    setIsSearchEnabled,
    handleAbort,
    setViewMode,
  } = useChat();

  const responseStats = useMemo(() => {
    const assistantIndex = conversation.map((message) => message.role).lastIndexOf('assistant');
    if (assistantIndex < 1) return null;
    const assistant = conversation[assistantIndex];
    const user = conversation.slice(0, assistantIndex).reverse().find((message) => message.role === 'user');
    if (!user || !assistant.completionTokens || assistant.completionTokens <= 0) return null;
    const latencyMs = Math.max(0, assistant.timestamp - user.timestamp);
    const seconds = Math.max(latencyMs / 1000, 0.001);
    return { latencyMs, completionTokens: assistant.completionTokens, tokensPerSecond: assistant.completionTokens / seconds };
  }, [conversation]);

  const [isCodebasePanelOpen, setIsCodebasePanelOpen] = useState(false);

  // Auto-open codebase panel when tool approval is requested
  useEffect(() => {
    if (pendingApproval) {
      setIsCodebasePanelOpen(true);
    }
  }, [pendingApproval]);

  const activeActivities = useMemo(() => {
    const lastAssistant = conversation.slice().reverse().find((m) => m.role === 'assistant');
    return lastAssistant?.toolActivities || [];
  }, [conversation]);

  const shortcutsMap = useMemo(() => ({
    'ctrl+n': () => { handleNewChat(); setViewMode('chat'); },
    'ctrl+b': () => toggleSidebar(),
    'ctrl+/': () => toggleSidebar(),
    'ctrl+,': () => setIsSettingsOpen((prev) => !prev),
    'ctrl+k': () => {
      const searchInput = document.querySelector('.sidebar-search__input') as HTMLInputElement | null;
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    },
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

  // OS theme synchronization with FreeDesktop appearance portal
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleThemeChange = (e: MediaQueryListEvent) => {
      const savedTheme = localStorage.getItem('vanaila-theme');
      if (!savedTheme) {
        document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
      }
    };
    mediaQuery.addEventListener('change', handleThemeChange);
    return () => mediaQuery.removeEventListener('change', handleThemeChange);
  }, []);

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
        {viewMode === 'projects' ? (
          <Suspense fallback={null}>
            <ProjectsLanding />
          </Suspense>
        ) : viewMode === 'project' ? (
          <Suspense fallback={null}>
            <ProjectDetail />
          </Suspense>
        ) : (
          <>
            <ChatHeader
              showTokens={showTokens}
              thinkingSeconds={thinkingSeconds}
              onToggleShowTokens={handleToggleTokens}
              responseStats={responseStats}
              isCodebasePanelOpen={isCodebasePanelOpen}
              onToggleCodebasePanel={() => setIsCodebasePanelOpen((prev) => !prev)}
              onToggleLog={() => setIsLogOpen((prev) => !prev)}
              isLogOpen={isLogOpen}
            />
            {isLogOpen && <AppLogPanel onClose={() => setIsLogOpen(false)} />}

            <div className="chat-and-panel-wrapper">
              <div className="chat-column">
                <ChatLog
                  showTokens={showTokens}
                  renderMarkdown={renderMarkdown}
                />

                <ApprovalPrompt />
                <Composer thinkingSeconds={thinkingSeconds} />
              </div>

              {isCodebasePanelOpen && (
                <CodebasePanel
                  isOpen={isCodebasePanelOpen}
                  onClose={() => setIsCodebasePanelOpen(false)}
                  activities={activeActivities}
                  pendingApproval={pendingApproval}
                  onRespondApproval={respondToApproval}
                  workspacePath={projectRoot}
                />
              )}
            </div>
          </>
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
