import { Hono } from 'hono';
import type { AppDependencies } from '../types.js';

/**
 * Known skills from the official anthropics/skills GitHub repo.
 * We keep a static catalog with their raw SKILL.md URLs.
 * The backend fetches content on demand and caches locally in SQLite.
 */
const SKILLS_CATALOG: Array<{ name: string; rawUrl: string }> = [
  { name: 'frontend-design',       rawUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md' },
  { name: 'algorithmic-art',        rawUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/algorithmic-art/SKILL.md' },
  { name: 'brand-guidelines',       rawUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/brand-guidelines/SKILL.md' },
  { name: 'canvas-design',          rawUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/canvas-design/SKILL.md' },
  { name: 'claude-api',             rawUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/claude-api/SKILL.md' },
  { name: 'doc-coauthoring',        rawUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/doc-coauthoring/SKILL.md' },
  { name: 'internal-comms',         rawUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/internal-comms/SKILL.md' },
  { name: 'mcp-builder',            rawUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/mcp-builder/SKILL.md' },
  { name: 'skill-creator',          rawUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/SKILL.md' },
  { name: 'theme-factory',          rawUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/theme-factory/SKILL.md' },
  { name: 'web-artifacts-builder',  rawUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/web-artifacts-builder/SKILL.md' },
  { name: 'webapp-testing',         rawUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/webapp-testing/SKILL.md' },
];

/**
 * Minimal YAML frontmatter parser.
 * Extracts name/description from the `--- ... ---` block at the top of SKILL.md.
 */
function parseFrontmatter(raw: string): { name: string; description: string; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    return { name: '', description: '', body: raw };
  }
  const fm = match[1];
  const body = match[2] ?? '';

  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  const descMatch = fm.match(/^description:\s*([\s\S]*?)(?=\n\w|\n---|\s*$)/m);

  const name = nameMatch?.[1]?.trim() ?? '';
  // Description may span multiple lines (folded YAML) — collapse newlines
  const description = (descMatch?.[1] ?? '').replace(/\n\s+/g, ' ').trim();

  return { name, description, body: body.trim() };
}

export function skillsRouter(dependencies: AppDependencies): Hono {
  const app = new Hono();

  /** GET /api/skills/catalog — return list of available skills (merged with local install state) */
  app.get('/catalog', (context) => {
    const installed = dependencies.listSkills();
    const installedByName = new Map(installed.map((s) => [s.name, s]));

    const catalog = SKILLS_CATALOG.map((entry) => {
      const local = installedByName.get(entry.name);
      return {
        name: entry.name,
        rawUrl: entry.rawUrl,
        installed: !!local,
        enabled: local?.enabled ?? false,
        id: local?.id ?? null,
        description: local?.description ?? null,
      };
    });

    return context.json({ catalog });
  });

  /** GET /api/skills — list installed skills */
  app.get('/', (context) => {
    const skills = dependencies.listSkills();
    return context.json({ skills });
  });

  /**
   * POST /api/skills/install — fetch SKILL.md from GitHub and install locally.
   * Body: { name: string }
   */
  app.post('/install', async (context) => {
    try {
      const body = await context.req.json<{ name: string }>();
      const entry = SKILLS_CATALOG.find((e) => e.name === body.name);
      if (!entry) {
        return context.json({ error: `Unknown skill: ${body.name}` }, 404);
      }

      const response = await dependencies.fetchFn(entry.rawUrl);
      if (!response.ok) {
        return context.json({ error: `Failed to fetch skill: HTTP ${response.status}` }, 502);
      }

      const raw = await response.text();
      const { name: parsedName, description, body: content } = parseFrontmatter(raw);
      const skillName = parsedName || entry.name;

      const skill = dependencies.upsertSkill({
        name: skillName,
        description: description || `Skill: ${skillName}`,
        content,
        sourceUrl: entry.rawUrl,
        enabled: true,
      });

      return context.json({ skill });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Install failed' }, 500);
    }
  });

  /** PATCH /api/skills/:id — toggle enabled */
  app.patch('/:id', async (context) => {
    const id = context.req.param('id');
    try {
      const body = await context.req.json<{ enabled: boolean }>();
      if (typeof body.enabled !== 'boolean') {
        return context.json({ error: 'enabled (boolean) required' }, 400);
      }
      const ok = dependencies.setSkillEnabled(id, body.enabled);
      if (!ok) return context.json({ error: 'Skill not found' }, 404);
      return context.json({ id, enabled: body.enabled });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Update failed' }, 500);
    }
  });

  /** DELETE /api/skills/:id — uninstall */
  app.delete('/:id', (context) => {
    const id = context.req.param('id');
    const ok = dependencies.deleteSkill(id);
    if (!ok) return context.json({ error: 'Skill not found' }, 404);
    return context.json({ deleted: true });
  });

  /**
   * POST /api/skills/custom — install a custom SKILL.md by pasting raw content.
   * Body: { content: string }
   */
  app.post('/custom', async (context) => {
    try {
      const body = await context.req.json<{ content: string }>();
      if (!body.content?.trim()) {
        return context.json({ error: 'content is required' }, 400);
      }

      const { name: parsedName, description, body: skillBody } = parseFrontmatter(body.content);
      if (!parsedName) {
        return context.json({ error: 'SKILL.md must have a `name` in YAML frontmatter' }, 400);
      }

      const skill = dependencies.upsertSkill({
        name: parsedName,
        description: description || `Custom skill: ${parsedName}`,
        content: skillBody,
        sourceUrl: null,
        enabled: true,
      });

      return context.json({ skill });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Upload failed' }, 500);
    }
  });

  return app;
}
