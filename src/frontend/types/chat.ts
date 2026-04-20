export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
}

export interface Chat {
  id: string;
  title: string;
  conversation: Message[];
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  model: string | null;
  systemPrompt: string | null;
  usage?: number;
}

export type AttachmentType = 'text' | 'image';

export interface Attachment {
  name: string;
  content: string;
  type: AttachmentType;
}

export interface ContextWindow {
  current: number;
  total: number;
}
