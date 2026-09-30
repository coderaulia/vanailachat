export const DEFAULT_PROJECT_NAME = 'Default';

export function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeTimestamp(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}
