/**
 * Facade over the per-domain modules in ./db. Callers and tests keep using
 * `DatabaseService.x()`; new code can import the domain module directly.
 */
import * as connection from './db/connection.js';
import * as projects from './db/projects.js';
import * as chats from './db/chats.js';
import * as messages from './db/messages.js';
import * as feedback from './db/feedback.js';
import * as codingSessions from './db/codingSessions.js';
import * as memory from './db/memory.js';
import * as settings from './db/settings.js';
import * as skills from './db/skills.js';

export type {
  ProjectRecord,
  CreateProjectInput,
  UpdateProjectInput,
  ChatRecord,
  UpsertChatInput,
  MessageRecord,
  MessageVersionRecord,
  MessageFeedbackRecord,
  UpsertFeedbackInput,
  InsertMessageInput,
  CodingSessionRecord,
  UpsertCodingSessionInput,
  MemoryEntryRecord,
  SkillRecord,
  UpsertSkillInput,
} from './db/types.js';

export class DatabaseService {
  // connection
  static initialize = connection.initialize;
  static runInTransaction = connection.runInTransaction;
  static close = connection.close;
  // projects
  static listProjects = projects.listProjects;
  static createProject = projects.createProject;
  static getProject = projects.getProject;
  static updateProject = projects.updateProject;
  static deleteProject = projects.deleteProject;
  // chats
  static listChats = chats.listChats;
  static getChat = chats.getChat;
  static upsertChat = chats.upsertChat;
  static deleteChat = chats.deleteChat;
  // messages
  static getMessage = messages.getMessage;
  static listMessages = messages.listMessages;
  static insertMessage = messages.insertMessage;
  static searchMessages = messages.searchMessages;
  static supersedeMessagesFrom = messages.supersedeMessagesFrom;
  static listMessageVersions = messages.listMessageVersions;
  // feedback
  static listTrainingPairs = feedback.listTrainingPairs;
  static listTrainingExamples = feedback.listTrainingExamples;
  static upsertFeedback = feedback.upsertFeedback;
  static getFeedback = feedback.getFeedback;
  static listFeedbackForChat = feedback.listFeedbackForChat;
  static autoPositiveForChat = feedback.autoPositiveForChat;
  static listHighScoringChats = feedback.listHighScoringChats;
  static listDistillationPairs = feedback.listDistillationPairs;
  static recordAbPick = feedback.recordAbPick;
  // codingSessions
  static getCodingSession = codingSessions.getCodingSession;
  static upsertCodingSession = codingSessions.upsertCodingSession;
  // memory
  static getAllMemoryEntries = memory.getAllMemoryEntries;
  static upsertMemory = memory.upsertMemory;
  static deleteMemory = memory.deleteMemory;
  // settings
  static getAllSettings = settings.getAllSettings;
  static getSetting = settings.getSetting;
  static upsertSetting = settings.upsertSetting;
  // skills
  static listSkills = skills.listSkills;
  static getSkill = skills.getSkill;
  static getSkillByName = skills.getSkillByName;
  static upsertSkill = skills.upsertSkill;
  static setSkillEnabled = skills.setSkillEnabled;
  static deleteSkill = skills.deleteSkill;
  static listEnabledSkills = skills.listEnabledSkills;
}
