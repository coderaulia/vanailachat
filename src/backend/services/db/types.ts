export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  memory: string | null;
  pinned: number;
  created_at: number;
}

export interface ChatRow {
  id: string;
  project_id: string;
  title: string;
  model: string | null;
  project_root: string | null;
  system_prompt: string | null;
  pinned: number;
  archived: number;
  role: string | null;
  created_at: number;
  updated_at: number;
  usage: number;
}

export interface MessageRow {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  created_at: number;
  version_of?: string | null;
  version_count?: number | null;
}

export interface ProjectRecord {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  memory: string | null;
  pinned: boolean;
  createdAt: number;
}

export interface CreateProjectInput {
  id?: string;
  name: string;
  description?: string | null;
  instructions?: string | null;
  memory?: string | null;
  pinned?: boolean;
  createdAt?: number;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  instructions?: string | null;
  memory?: string | null;
  pinned?: boolean;
}

export interface ChatRecord {
  id: string;
  projectId: string;
  title: string;
  model: string | null;
  projectRoot: string | null;
  systemPrompt: string | null;
  pinned: boolean;
  archived: boolean;
  role: string | null;
  createdAt: number;
  updatedAt: number;
  usage: number;
}

export interface UpsertChatInput {
  id?: string;
  projectId?: string;
  title?: string;
  model?: string | null;
  projectRoot?: string | null;
  systemPrompt?: string | null;
  pinned?: boolean;
  archived?: boolean;
  role?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface MessageRecord {
  id: string;
  chatId: string;
  role: string;
  content: string;
  promptTokens: number | null;
  completionTokens: number | null;
  createdAt: number;
  /** Id of the first answer in this message's regenerate group, if any. */
  versionOf: string | null;
  /** Answers in the group, including superseded ones; 1 when never regenerated. */
  versionCount: number;
}

export interface MessageVersionRecord {
  id: string;
  content: string;
  createdAt: number;
  current: boolean;
}

export interface MessageFeedbackRecord {
  messageId: string;
  rating: number;
  editedContent: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertFeedbackInput {
  messageId: string;
  rating: number;
  editedContent?: string | null;
}

export interface InsertMessageInput {
  id?: string;
  chatId: string;
  role: string;
  content: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  createdAt?: number;
  versionOf?: string | null;
}

export interface CodingSessionRecord {
  chatId: string;
  harness: string;
  harnessSessionId: string | null;
  workspacePath: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertCodingSessionInput {
  chatId: string;
  harness: string;
  harnessSessionId?: string | null;
  workspacePath: string;
  status: string;
}

export interface MemoryEntryRow {
  id: string;
  type: string;
  content: string;
  embedding: Buffer;
  metadata: string | null;
  source_id: string | null;
  created_at: number;
}

export interface MemoryEntryRecord {
  id: string;
  type: string;
  content: string;
  embedding: string;
  metadata: string | null;
  sourceId: string | null;
  createdAt: number;
}

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  content: string;
  sourceUrl: string | null;
  enabled: boolean;
  installedAt: number;
}

export interface UpsertSkillInput {
  id?: string;
  name: string;
  description: string;
  content: string;
  sourceUrl?: string | null;
  enabled?: boolean;
}

export interface SkillRow {
  id: string;
  name: string;
  description: string;
  content: string;
  source_url: string | null;
  enabled: number;
  installed_at: number;
}
