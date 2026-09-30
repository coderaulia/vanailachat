import type { TrainingExampleDto } from '../../lib/api';
import type { TrainingExample } from './types';

/** The web API returns camelCase and the desktop IPC snake_case. */
export function toTrainingExample(example: TrainingExampleDto): TrainingExample {
  return {
    id: example.id,
    chatId: example.chatId ?? example.chat_id ?? '',
    chatTitle: example.chatTitle ?? example.chat_title ?? '',
    userContent: example.userContent ?? example.user_content ?? '',
    assistantContent: example.assistantContent ?? example.assistant_content ?? '',
    rating: example.rating,
    edited: example.edited,
    createdAt: example.createdAt ?? example.created_at ?? 0,
  };
}
