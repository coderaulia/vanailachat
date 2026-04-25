import type {
  ChatRecord,
  CreateProjectInput,
  InsertMessageInput,
  MessageRecord,
  ProjectRecord,
  UpdateProjectInput,
  UpsertChatInput,
} from './services/database.js';
import type { InstalledModelMetadata } from './services/ollama.js';

export interface ChatRequestBody {
  model?: string;
  chatId?: string;
  messages?: Array<{ role: string; content: unknown }>;
  stream?: boolean;
  search?: boolean;
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
  pickDirectory: () => Promise<string | null>;
}
