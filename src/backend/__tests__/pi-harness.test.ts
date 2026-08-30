import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => {
  return {
    createAgentSession: vi.fn(),
    createCodingTools: vi.fn(),
    createReadOnlyTools: vi.fn(),
    modelRuntime: {
      getModel: vi.fn(),
      hasConfiguredAuth: vi.fn(),
      setRuntimeApiKey: vi.fn(),
    },
    session: {
      agent: { abort: vi.fn() },
      dispose: vi.fn(),
      getSessionId: vi.fn(() => 'pi-session-1'),
      prompt: vi.fn(),
      sessionManager: { getSessionId: vi.fn(() => 'pi-session-1') },
      subscribe: vi.fn(),
    },
  };
});

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: mocks.createAgentSession,
  createCodingTools: mocks.createCodingTools,
  createReadOnlyTools: mocks.createReadOnlyTools,
  DefaultResourceLoader: class {
    async reload() {}
  },
  ModelRuntime: {
    create: vi.fn(async () => mocks.modelRuntime),
  },
  SessionManager: {
    inMemory: vi.fn(() => ({ getSessionId: () => 'pi-session-1' })),
    open: vi.fn(() => ({ getSessionId: () => 'pi-session-1' })),
  },
  SettingsManager: {
    create: vi.fn(() => ({})),
  },
}));

import { ApprovalService } from '../services/approvals.js';
import { CodingHarnessRegistry } from '../services/codingHarness.js';
import { DatabaseService } from '../services/database.js';
import { PiHarness } from '../services/piHarness.js';

function freshDb() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vanaila-pi-')), 'test.sqlite');
}

function resetDatabase() {
  (DatabaseService as unknown as { db: { close: () => void } | null }).db?.close();
  (DatabaseService as unknown as { db: unknown }).db = null;
}

describe('Pi Harness', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = freshDb();
    resetDatabase();
    DatabaseService.initialize(dbPath);
    ApprovalService.clear();
    vi.clearAllMocks();
    mocks.createAgentSession.mockResolvedValue({ session: mocks.session });
    mocks.modelRuntime.getModel.mockReturnValue({ id: 'gpt-test', provider: 'custom-test' });
    mocks.modelRuntime.hasConfiguredAuth.mockReturnValue(true);
    mocks.session.subscribe.mockReturnValue(() => {});
    mocks.session.prompt.mockResolvedValue(undefined);
  });

  it('uses the existing Vanaila provider configuration without Pi settings', async () => {
    const status = await new PiHarness().status();
    expect(status).toMatchObject({ available: true, id: 'pi-harness' });

    DatabaseService.upsertSetting('pi_provider', 'custom-test');
    DatabaseService.upsertSetting('pi_model', 'gpt-test');
    const configured = await new PiHarness().status();
    expect(configured).toMatchObject({ available: true, id: 'pi-harness' });
  });

  it('returns the configured Pi harness', () => {
    const registry = new CodingHarnessRegistry([new PiHarness()]);
    expect(registry.get('pi-harness')?.id).toBe('pi-harness');
  });

  it('creates an approved mutating Pi tool and streams its completion', async () => {
    DatabaseService.upsertSetting('pi_provider', 'custom-test');
    DatabaseService.upsertSetting('pi_model', 'gpt-test');
    DatabaseService.upsertSetting('pi_base_url', 'https://pi.test/v1');
    DatabaseService.upsertSetting('pi_api_key', 'pi-secret');
    DatabaseService.upsertSetting('pi_tool_policy', 'approval');

    const editExecute = vi.fn(async () => ({
      content: [{ type: 'text', text: 'edited' }],
      details: { path: 'src/app.ts' },
    }));
    mocks.createReadOnlyTools.mockReturnValue([
      { name: 'read', label: 'read', description: 'read', parameters: {}, execute: editExecute },
    ]);
    mocks.createCodingTools.mockReturnValue([
      { name: 'read', label: 'read', description: 'read', parameters: {}, execute: editExecute },
      { name: 'edit', label: 'edit', description: 'edit', parameters: {}, execute: editExecute },
    ]);

    mocks.createAgentSession.mockImplementation(async (options: {
      customTools: Array<{ name: string; execute: () => Promise<unknown> }>;
    }) => {
      mocks.session.prompt.mockImplementation(async () => {
        await options.customTools.find((tool) => tool.name === 'edit')!.execute();
      });
      return { session: mocks.session };
    });

    const controller = new AbortController();
    const events: Array<{ type: string; name?: string; status?: string }> = [];
    for await (const event of new PiHarness().run({
      prompt: 'Edit the app',
      cwd: process.cwd(),
      mode: 'implement',
      signal: controller.signal,
      onApproval: (approval) => {
        expect(approval.tool).toBe('edit');
        setTimeout(() => ApprovalService.resolve(approval.id, true), 0);
      },
    })) {
      events.push(event as { type: string; name?: string; status?: string });
    }

    expect(editExecute).toHaveBeenCalled();
    expect(events.some((event) => event.type === 'tool' && event.name === 'edit' && event.status === 'start')).toBe(true);
    expect(events.some((event) => event.type === 'tool' && event.name === 'edit' && event.status === 'done')).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
  });

  afterEach(() => {
    ApprovalService.clear();
    resetDatabase();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  });
});
