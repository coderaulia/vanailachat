import type { ApiChat, ApiProject, Message, MessageRole } from '../types/chat';
import type { ApiChatDto, ApiMessageDto, ApiProjectDto } from './api';

// Both backends return camelCase now; the snake_case fallbacks keep older
// desktop builds and exported files working.

function toMessageRole(role: string): MessageRole {
  if (role === 'user' || role === 'assistant' || role === 'system') {
    return role;
  }
  return 'assistant';
}

export function toProject(p: ApiProjectDto): ApiProject {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? null,
    instructions: p.instructions ?? null,
    memory: p.memory ?? null,
    pinned: Boolean(p.pinned),
    projectRoot: p.projectRoot ?? p.project_root ?? null,
    createdAt: p.createdAt ?? p.created_at ?? Date.now(),
  };
}

export function toChat(c: ApiChatDto): ApiChat {
  return {
    id: c.id,
    projectId: c.projectId ?? c.project_id ?? '',
    title: c.title,
    model: c.model ?? null,
    projectRoot: c.projectRoot ?? c.project_root ?? null,
    systemPrompt: c.systemPrompt ?? c.system_prompt ?? null,
    pinned: Boolean(c.pinned),
    archived: Boolean(c.archived),
    role: c.role ?? null,
    createdAt: c.createdAt ?? c.created_at ?? Date.now(),
    updatedAt: c.updatedAt ?? c.updated_at ?? Date.now(),
    usage: typeof c.usage === 'number' ? c.usage : 0,
  };
}

export function toMessage(m: ApiMessageDto): Message {
  return {
    id: m.id,
    role: toMessageRole(m.role),
    content: m.content,
    promptTokens: m.promptTokens ?? m.prompt_tokens ?? null,
    completionTokens: m.completionTokens ?? m.completion_tokens ?? null,
    timestamp: m.createdAt ?? m.created_at ?? m.timestamp ?? Date.now(),
    versionOf: m.versionOf ?? m.version_of ?? null,
    versionCount: m.versionCount ?? m.version_count ?? 1,
  };
}
