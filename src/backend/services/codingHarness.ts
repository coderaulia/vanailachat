export type CodingHarnessId = 'claude-code' | 'deepseek-harness';

export interface CodingHarnessStatus {
  id: CodingHarnessId;
  label: string;
  available: boolean;
  reason?: string;
}

export interface CodingRunInput {
  prompt: string;
  cwd: string;
  sessionId?: string | null;
  mode: 'plan' | 'implement';
  model?: string;
  autoApprove?: boolean;
  signal: AbortSignal;
  onApproval?: (approval: CodingApproval) => void;
}

export interface CodingApproval {
  id: string;
  tool: string;
  summary: string;
  details: Record<string, unknown>;
}

export type CodingEvent =
  | { type: 'text'; text: string }
  | {
      type: 'tool';
      id?: string;
      name: string;
      status?: 'start' | 'done' | 'error';
      category?: 'command' | 'file_write' | 'file_edit' | 'file_read' | 'document' | 'tool';
      file?: string;
      command?: string;
      detail?: string;
      input?: Record<string, unknown>;
    }
  | { type: 'session'; sessionId: string }
  | {
      type: 'usage';
      usage: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    }
  | { type: 'done' };

/** A swappable local execution engine for coding work. */
export interface CodingHarness {
  readonly id: CodingHarnessId;
  status(): Promise<CodingHarnessStatus>;
  run(input: CodingRunInput): AsyncIterable<CodingEvent>;
}

export class CodingHarnessRegistry {
  constructor(private readonly harnesses: CodingHarness[]) {}

  list(): Promise<CodingHarnessStatus[]> {
    return Promise.all(this.harnesses.map((harness) => harness.status()));
  }

  get(id: string): CodingHarness | null {
    return this.harnesses.find((harness) => harness.id === id) ?? null;
  }
}
