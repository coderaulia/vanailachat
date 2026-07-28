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
  listChats: (projectId?: string, limit?: number) => ChatRecord[];
  getChat: (id: string) => ChatRecord | null;
  upsertChat: (input: UpsertChatInput) => ChatRecord;
  deleteChat: (id: string) => boolean;
  listMessages: (chatId: string, limit?: number) => MessageRecord[];
  insertMessage: (input: InsertMessageInput) => MessageRecord;
  getMessage: (id: string) => MessageRecord | null;
  upsertFeedback: (input: UpsertFeedbackInput) => MessageFeedbackRecord;
  getFeedback: (messageId: string) => MessageFeedbackRecord | null;
  listFeedbackForChat: (chatId: string) => MessageFeedbackRecord[];
  listTrainingPairs: () => Array<{
    chatId: string;
    userContent: string;
    assistantContent: string;
    rating: number;
    edited: boolean;
    createdAt: number;
  }>;
  autoPositiveForChat: (chatId: string, minTokens?: number) => { messageId: string; content: string; chatId: string } | null;
  listHighScoringChats: (limit?: number, minRate?: number, minRated?: number) => string[];
  listDistillationPairs: (chatIds: string[]) => Array<{
    chatId: string;
    userContent: string;
    assistantContent: string;
    rating: number;
    edited: boolean;
    createdAt: number;
  }>;
  recordAbPick: (input: {
    userContent: string;
    assistantContent: string;
    winnerModel: string;
    loserModel?: string;
  }) => { chatId: string; messageId: string };
  pickDirectory: () => Promise<string | null>;
  /** Runs a batch of synchronous writes as one transaction. */
  runInTransaction: <T>(fn: () => T) => T;
  /** Provider registry for multi-provider support */
  providerRegistry: ProviderRegistry;
  // ── Memory / Embedding (injected so routes stay testable) ────────────────
  listEnabledSkills: () => SkillRecord[];
  getAllMemoryEntries: (limit?: number) => MemoryEntryRecord[];
  upsertMemory: (input: {
    id?: string;
    type?: string;
    content: string;
    /** null when no embedding backend is reachable — kept for keyword recall. */
    embedding: Float32Array | null;
    metadata?: string | null;
    sourceId?: string | null;
  }) => MemoryEntryRecord;
  deleteMemory: (id: string) => boolean;
  embed: (text: string) => Promise<Float32Array>;
  /** Embed, or null when every embedding backend is unreachable. */
  embedOrNull: (text: string) => Promise<Float32Array | null>;
  searchMemories: (
    queryVec: Float32Array,
    topK?: number,
    threshold?: number,
  ) => Array<{ id: string; content: string; score: number; metadata: string | null }>;
  /** Token-overlap recall used when no embedding backend is available. */
  searchMemoriesByKeyword: (
    text: string,
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
