import { useEffect, useRef, useState } from 'react';
import { ChatHeader } from './components/ChatHeader';
import { ChatLog } from './components/ChatLog';
import { Composer } from './components/Composer';
import { Sidebar } from './components/Sidebar';
import { useChatApp } from './hooks/useChatApp';
import { useMarkdownRenderer } from './hooks/useMarkdownRenderer';

const App = () => {
  const renderMarkdown = useMarkdownRenderer();
  const thinkingStart = useRef<number | null>(null);
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const {
    attachedFiles,
    availableModels,
    closeSidebar,
    contextPercentage,
    contextWindow,
    conversation,
    currentChatId,
    fileInputRef,
    handleAttach,
    handleCreateProject,
    handleDeleteChat,
    handleRenameChat,
    handleNewChat,
    handleSaveSystemPrompt,
    handleSelectProject,
    handleSelectChat,
    handleTogglePin,
    handleSystemPromptChange,
    handleSend,
    isCurrentChatSending,
    isSearchEnabled,
    isSidebarOpen,
    openSidebar,
    prompt,
    projects,
    removeAttachment,
    selectedProjectId,
    selectedModel,
    setIsSearchEnabled,
    setPrompt,
    setSelectedModel,
    sortedHistories,
    statusText,
    systemPrompt,
    toggleTheme,
  } = useChatApp();

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
    <div className="app-shell">
      <Sidebar
        isOpen={isSidebarOpen}
        currentChatId={currentChatId}
        histories={sortedHistories}
        onClose={closeSidebar}
        onNewChat={handleNewChat}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onCreateProject={handleCreateProject}
        onSelectProject={handleSelectProject}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
        onRenameChat={handleRenameChat}
        onTogglePin={handleTogglePin}
      />

      <main className="main-content">
        <ChatHeader
          isCurrentChatSending={isCurrentChatSending}
          selectedModel={selectedModel}
          statusText={statusText}
          thinkingSeconds={thinkingSeconds}
          onOpenSidebar={openSidebar}
          onToggleTheme={toggleTheme}
        />

        <ChatLog
          conversation={conversation}
          isCurrentChatSending={isCurrentChatSending}
          renderMarkdown={renderMarkdown}
        />

        <Composer
          attachedFiles={attachedFiles}
          availableModels={availableModels}
          contextPercentage={contextPercentage}
          contextWindow={contextWindow}
          fileInputRef={fileInputRef}
          isCurrentChatSending={isCurrentChatSending}
          isSearchEnabled={isSearchEnabled}
          prompt={prompt}
          selectedModel={selectedModel}
          statusText={statusText}
          thinkingSeconds={thinkingSeconds}
          onAttach={handleAttach}
          onNewChat={handleNewChat}
          onRemoveAttachment={removeAttachment}
          onSelectModel={setSelectedModel}
          onSend={handleSend}
          onSetPrompt={setPrompt}
          onSetSystemPrompt={handleSystemPromptChange}
          onSaveSystemPrompt={handleSaveSystemPrompt}
          onToggleSearch={() => setIsSearchEnabled((enabled) => !enabled)}
          systemPrompt={systemPrompt}
        />
      </main>
    </div>
  );
};

export default App;
