import React, { createContext, useContext, ReactNode } from 'react';
import { useChatApp } from '../hooks/useChatApp';

export type ChatContextType = ReturnType<typeof useChatApp>;

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const chatState = useChatApp();
  return (
    <ChatContext.Provider value={chatState}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
