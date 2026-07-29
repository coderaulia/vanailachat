export type CodingHarnessId = 'claude-code';

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
  signal: AbortSignal;
}

export type CodingEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; input: Record<string, unknown> }
  | { type: 'session'; sessionId: string }
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
