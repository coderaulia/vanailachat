import { ChatHeader } from './components/ChatHeader';
import { ChatLog } from './components/ChatLog';
import { Composer } from './components/Composer';
import { Sidebar } from './components/Sidebar';
import { useChatApp } from './hooks/useChatApp';
import { useMarkdownRenderer } from './hooks/useMarkdownRenderer';

const App = () => {
  const renderMarkdown = useMarkdownRenderer();
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
    handleDeleteChat,
    handleNewChat,
    handleSelectChat,
    handleSend,
    isCurrentChatSending,
    isSearchEnabled,
    isSidebarOpen,
    openSidebar,
    prompt,
    removeAttachment,
    selectedModel,
    setIsSearchEnabled,
    setPrompt,
    setSelectedModel,
    sortedHistories,
    statusText,
    toggleTheme,
  } = useChatApp();

  return (
    <div className="app-shell">
      <Sidebar
        isOpen={isSidebarOpen}
        currentChatId={currentChatId}
        histories={sortedHistories}
        onClose={closeSidebar}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
      />

      <main className="main-content">
        <ChatHeader
          selectedModel={selectedModel}
          statusText={statusText}
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
          onAttach={handleAttach}
          onNewChat={handleNewChat}
          onRemoveAttachment={removeAttachment}
          onSelectModel={setSelectedModel}
          onSend={handleSend}
          onSetPrompt={setPrompt}
          onToggleSearch={() => setIsSearchEnabled((enabled) => !enabled)}
        />
      </main>
    </div>
  );
};

export default App;
