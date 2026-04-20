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
  const [showTokens, setShowTokens] = useState(false);
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
    handleExportData,
    handleImportData,
    handleRenameChat,
    handleNewChat,
    handleDismissRoleSuggestion,
    handleProjectRootChange,
    handleSaveProjectRoot,
    handleSaveSystemPrompt,
    handleSelectRole,
    handleSelectProject,
    handleSelectChat,
    handleTogglePin,
    handleAcceptRoleSuggestion,
    handleSystemPromptChange,
    handleSend,
    isCurrentChatSending,
    isSearchEnabled,
    isSidebarOpen,
    openSidebar,
    toggleSidebar,
    prompt,
    projectRoot,
    projects,
    removeAttachment,
    selectedProjectId,
    selectedRole,
    selectedModel,
    setIsSearchEnabled,
    setPrompt,
    setSelectedModel,
    sortedHistories,
    statusText,
    suggestedModelName,
    suggestedRoleLabel,
    systemPrompt,
    shouldShowRoleSuggestion,
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
    <div className={`app-shell ${isSidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      <Sidebar
        isOpen={isSidebarOpen}
        currentChatId={currentChatId}
        histories={sortedHistories}
        onClose={closeSidebar}
        onNewChat={handleNewChat}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onCreateProject={handleCreateProject}
        onExport={handleExportData}
        onImport={handleImportData}
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
          showTokens={showTokens}
          statusText={statusText}
          thinkingSeconds={thinkingSeconds}
          onToggleSidebar={toggleSidebar}
          onToggleShowTokens={() => setShowTokens((previous) => !previous)}
          onToggleTheme={toggleTheme}
        />

        <ChatLog
          conversation={conversation}
          isCurrentChatSending={isCurrentChatSending}
          showTokens={showTokens}
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
          onRoleAcceptSuggestion={handleAcceptRoleSuggestion}
          onRoleDismissSuggestion={handleDismissRoleSuggestion}
          onSaveProjectRoot={handleSaveProjectRoot}
          onSelectRole={handleSelectRole}
          onSelectModel={setSelectedModel}
          onSend={handleSend}
          onSetPrompt={setPrompt}
          onSetProjectRoot={handleProjectRootChange}
          onSetSystemPrompt={handleSystemPromptChange}
          onSaveSystemPrompt={handleSaveSystemPrompt}
          onToggleSearch={() => setIsSearchEnabled((enabled) => !enabled)}
          selectedRole={selectedRole}
          shouldShowRoleSuggestion={shouldShowRoleSuggestion}
          suggestedModelName={suggestedModelName}
          suggestedRoleLabel={suggestedRoleLabel}
          systemPrompt={systemPrompt}
          projectRoot={projectRoot}
        />
      </main>
    </div>
  );
};

export default App;
