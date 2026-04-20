export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  timestamp: number;
}

export interface Chat {
  id: string;
  projectId: string;
  title: string;
  conversation: Message[];
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  role: string | null;
  model: string | null;
  projectRoot: string | null;
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

export interface ApiChat {
  id: string;
  projectId: string;
  title: string;
  model: string | null;
  projectRoot?: string | null;
  systemPrompt?: string | null;
  pinned?: boolean;
  role?: string | null;
  createdAt: number;
  updatedAt: number;
  usage?: number;
}

export interface ApiMessage {
  id: string;
  chatId: string;
  role: string;
  content: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  createdAt: number;
}

export interface ApiProject {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  memory: string | null;
  pinned?: boolean;
  createdAt: number;
}

export type SendMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface StreamEvent {
  message?: { content?: string };
  usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}


