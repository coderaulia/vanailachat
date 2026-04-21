import { useEffect, useMemo, useRef, useState } from 'react';
import { ChatHeader } from './components/ChatHeader';
import { ChatLog } from './components/ChatLog';
import { Composer } from './components/Composer';
import './App.css';
import { Sidebar } from './components/Sidebar';
import { ProjectDetail } from './components/ProjectDetail';
import { useMarkdownRenderer } from './hooks/useMarkdownRenderer';
import { ChatProvider, useChat } from './context/ChatContext';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

const AppShell = () => {
  const renderMarkdown = useMarkdownRenderer();
  const thinkingStart = useRef<number | null>(null);
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [showTokens, setShowTokens] = useState(false);

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
    'ctrl+shift+s': () => setIsSearchEnabled((prev: boolean) => !prev),
    'escape': () => { if (isCurrentChatSending) handleAbort(); },
  }), [handleNewChat, toggleSidebar, setIsSearchEnabled, isCurrentChatSending, handleAbort, setViewMode]);

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
      <Sidebar />

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

            <Composer thinkingSeconds={thinkingSeconds} />
          </>
        ) : (
          (() => {
            const currentProject = projects.find(p => p.id === selectedProjectId);
            if (currentProject) {
              return <ProjectDetail />;
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
