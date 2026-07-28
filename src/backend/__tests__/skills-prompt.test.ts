import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createApp } from '../app.js';
import { OllamaService } from '../services/ollama.js';
import { ToolService } from '../services/tools.js';
import { resolveTools } from '../routes/chat.js';

const BIG_SKILL = '# Skill Creator\n\nA skill for creating new skills.\n' + 'x'.repeat(32_000);

function skills() {
  return [
    {
      id: 'skill_1',
      name: 'skill-creator',
      description: null,
      content: BIG_SKILL,
      sourceUrl: null,
      enabled: true,
      installedAt: 0,
    },
    {
      id: 'skill_2',
      name: 'brand-guidelines',
      description: 'Brand voice and colour rules',
      content: 'Use the brand palette.',
      sourceUrl: null,
      enabled: true,
      installedAt: 0,
    },
  ];
}

async function systemPromptFor(overrides: Record<string, unknown> = {}) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({ done: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson' },
    })
  );

  const app = createApp({
    fetchFn: fetchMock,
    getBaseUrl: () => 'http://ollama.local',
    getInstalledModels: async () => ['llama3'],
    getModelDetails: async () => ({ capabilities: ['chat', 'tools'] }),
    listEnabledSkills: () => skills(),
    getSetting: () => null,
    ...overrides,
  });

  const response = await app.request('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama3',
      messages: [{ role: 'user', content: 'how do i use the settings?' }],
      stream: true,
    }),
  });
  await response.text();

  const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as {
    messages: Array<{ role: string; content: string }>;
    tools?: Array<{ function?: { name?: string } }>;
  };

  return { systemPrompt: body.messages[0].content, tools: body.tools ?? [] };
}

describe('skill injection', () => {
  beforeEach(() => {
    vi.spyOn(OllamaService, 'getInstalledModels').mockResolvedValue(['llama3']);
  });

  it('lists skills by name and summary instead of inlining their content', async () => {
    const { systemPrompt } = await systemPromptFor();

    expect(systemPrompt).toContain('[Available Skills]');
    expect(systemPrompt).toContain('skill-creator: A skill for creating new skills.');
    expect(systemPrompt).toContain('brand-guidelines: Brand voice and colour rules');
    expect(systemPrompt).not.toContain('x'.repeat(100));
    // The whole prompt must stay far below the ~34KB the old inline path cost.
    expect(systemPrompt.length).toBeLessThan(2_000);
  });

  it('drops the skills section when nothing is enabled', async () => {
    const { systemPrompt } = await systemPromptFor({ listEnabledSkills: () => [] });
    expect(systemPrompt).not.toContain('[Available Skills]');
  });

  it('restores full inlining when skills_inline is set', async () => {
    const { systemPrompt } = await systemPromptFor({
      getSetting: (key: string) => (key === 'skills_inline' ? 'true' : null),
    });

    expect(systemPrompt).toContain('[Skill: skill-creator]');
    expect(systemPrompt.length).toBeGreaterThan(30_000);
  });
});

describe('load_skill availability', () => {
  const allTools = () => ToolService.getToolDefinitions() as unknown as Record<string, unknown>[];
  const names = (tools: Record<string, unknown>[]) =>
    tools.map((t) => (t as { function?: { name?: string } }).function?.name);

  it('is offered when skills are enabled', () => {
    expect(names(resolveTools(allTools(), true, null, false, true))).toContain('load_skill');
  });

  it('is withheld when no skill is enabled', () => {
    expect(names(resolveTools(allTools(), true, null, false, false))).not.toContain('load_skill');
  });

  it('survives a persona tool allowlist that omits it', () => {
    const tools = resolveTools(allTools(), true, ['read_file'], false, true);
    expect(names(tools)).toContain('load_skill');
    expect(names(tools)).toContain('read_file');
    expect(names(tools)).not.toContain('run_command');
  });
});

describe('load_skill tool', () => {
  beforeEach(async () => {
    // Stub the store so the test does not depend on whatever skills the
    // developer happens to have installed locally.
    const { DatabaseService } = await import('../services/database.js');
    vi.spyOn(DatabaseService, 'listEnabledSkills').mockReturnValue(skills());
  });

  it('returns the full body of an enabled skill', async () => {
    const result = await ToolService.executeTool('load_skill', { name: 'brand-guidelines' }, null);
    expect(result).toContain('[Skill: brand-guidelines]');
    expect(result).toContain('Use the brand palette.');
  });

  it('matches case-insensitively', async () => {
    const result = await ToolService.executeTool('load_skill', { name: 'Brand-Guidelines' }, null);
    expect(result).toContain('[Skill: brand-guidelines]');
  });

  it('reports the available names when asked for something unknown', async () => {
    const result = await ToolService.executeTool('load_skill', { name: 'no-such-skill' }, null);
    expect(result).toContain("Skill 'no-such-skill' is not enabled");
    expect(result).toContain('brand-guidelines');
  });
});
