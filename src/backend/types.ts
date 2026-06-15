import type {
  ChatRecord,
  CreateProjectInput,
  InsertMessageInput,
  MemoryEntryRecord,
  MessageFeedbackRecord,
  MessageRecord,
  ProjectRecord,
  SkillRecord,
  UpdateProjectInput,
  UpsertChatInput,
  UpsertFeedbackInput,
  UpsertSkillInput,
} from './services/database.js';
import type { InstalledModelMetadata } from './services/ollama.js';
import type { ProviderRegistry } from './services/providerRegistry.js';

export interface ChatRequestBody {
  model?: string;
  chatId?: string;
  messages?: Array<{ role: string; content: unknown }>;
  stream?: boolean;
  search?: boolean;
  /** Skip memory search + auto-save. Used for internal calls (title generation, etc.) so that the synthetic prompt is not embedded into the vector store. */
  skipMemory?: boolean;
  [key: string]: unknown;
}

export interface AppDependencies {
  executeTool: (name: string, args: unknown, projectRoot: string | null) => Promise<string>;
  fetchFn: typeof fetch;
  getBaseUrl: () => string;
  getInstalledModels: () => Promise<string[]>;
  getInstalledModelMetadata: () => Promise<InstalledModelMetadata[]>;
  getModelDetails: (modelName: string) => Promise<unknown>;
  getToolDefinitions: () => unknown[];
  listProjects: () => ProjectRecord[];
  getProject: (id: string) => ProjectRecord | null;
  createProject: (input: CreateProjectInput) => ProjectRecord;
  updateProject: (id: string, input: UpdateProjectInput) => ProjectRecord;
  deleteProject: (id: string) => boolean;
  listChats: (projectId?: string) => ChatRecord[];
  getChat: (id: string) => ChatRecord | null;
  upsertChat: (input: UpsertChatInput) => ChatRecord;
  deleteChat: (id: string) => boolean;
  listMessages: (chatId: string) => MessageRecord[];
  insertMessage: (input: InsertMessageInput) => MessageRecord;
  getMessage: (id: string) => MessageRecord | null;
  upsertFeedback: (input: UpsertFeedbackInput) => MessageFeedbackRecord;
  getFeedback: (messageId: string) => MessageFeedbackRecord | null;
  listFeedbackForChat: (chatId: string) => MessageFeedbackRecord[];
  pickDirectory: () => Promise<string | null>;
  /** Provider registry for multi-provider support */
  providerRegistry: ProviderRegistry;
  // ── Memory / Embedding (injected so routes stay testable) ────────────────
  listEnabledSkills: () => SkillRecord[];
  getAllMemoryEntries: (limit?: number) => MemoryEntryRecord[];
  upsertMemory: (input: {
    id?: string;
    type?: string;
    content: string;
    embedding: Float32Array;
    metadata?: string | null;
    sourceId?: string | null;
  }) => MemoryEntryRecord;
  deleteMemory: (id: string) => boolean;
  embed: (text: string) => Promise<Float32Array>;
  searchMemories: (
    queryVec: Float32Array,
    topK?: number,
    threshold?: number,
  ) => Array<{ id: string; content: string; score: number; metadata: string | null }>;
  searchMemoriesByText: (
    text: string,
    topK?: number,
    threshold?: number,
  ) => Promise<Array<{ id: string; content: string; score: number; metadata: string | null }>>;
  // ── Skills ───────────────────────────────────────────────────────────────
  listSkills: () => SkillRecord[];
  upsertSkill: (input: UpsertSkillInput) => SkillRecord;
  setSkillEnabled: (id: string, enabled: boolean) => boolean;
  deleteSkill: (id: string) => boolean;
  // ── Settings (key-value store) ───────────────────────────────────────────
  getAllSettings: () => Record<string, string>;
  getSetting: (key: string) => string | null;
  upsertSetting: (key: string, value: string) => void;
}
