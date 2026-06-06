import { Hono } from 'hono';
import { DatabaseService } from '../services/database.js';

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

export function skillsRouter(): Hono {
  const app = new Hono();

  /** GET /api/skills/catalog — return list of available skills (merged with local install state) */
  app.get('/catalog', (context) => {
    const installed = DatabaseService.listSkills();
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
    const skills = DatabaseService.listSkills();
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

      const response = await fetch(entry.rawUrl);
      if (!response.ok) {
        return context.json({ error: `Failed to fetch skill: HTTP ${response.status}` }, 502);
      }

      const raw = await response.text();
      const { name: parsedName, description, body: content } = parseFrontmatter(raw);
      const skillName = parsedName || entry.name;

      const skill = DatabaseService.upsertSkill({
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
      const ok = DatabaseService.setSkillEnabled(id, body.enabled);
      if (!ok) return context.json({ error: 'Skill not found' }, 404);
      return context.json({ id, enabled: body.enabled });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Update failed' }, 500);
    }
  });

  /** DELETE /api/skills/:id — uninstall */
  app.delete('/:id', (context) => {
    const id = context.req.param('id');
    const ok = DatabaseService.deleteSkill(id);
    if (!ok) return context.json({ error: 'Skill not found' }, 404);
    return context.json({ deleted: true });
  });

  return app;
}
