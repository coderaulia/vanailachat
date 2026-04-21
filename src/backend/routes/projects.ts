import { Hono } from 'hono';
import type { AppDependencies } from '../types.js';
import { toOptionalNumber } from '../helpers/index.js';

export function projectsRouter(dependencies: AppDependencies): Hono {
  const app = new Hono();

  app.get('/', (context) => {
    try {
      const projects = dependencies.listProjects();
      return context.json({ projects });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });

  app.post('/', async (context) => {
    try {
      const body = (await context.req.json()) as { 
        id?: unknown; 
        name?: unknown; 
        description?: unknown;
        instructions?: unknown;
        memory?: unknown;
        createdAt?: unknown 
      };
      if (typeof body.name !== 'string' || !body.name.trim()) {
        return context.json({ error: 'Project name is required' }, 400);
      }

      const project = dependencies.createProject({
        id: typeof body.id === 'string' ? body.id : undefined,
        name: body.name,
        description: typeof body.description === 'string' ? body.description : undefined,
        instructions: typeof body.instructions === 'string' ? body.instructions : undefined,
        memory: typeof body.memory === 'string' ? body.memory : undefined,
        createdAt: toOptionalNumber(body.createdAt),
      });

      return context.json({ project }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });

  app.get('/:id', (context) => {
    try {
      const id = context.req.param('id');
      const project = dependencies.getProject(id);
      if (!project) {
        return context.json({ error: 'Project not found' }, 404);
      }
      return context.json({ project });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });

  app.patch('/:id', async (context) => {
    try {
      const id = context.req.param('id');
      const body = (await context.req.json()) as {
        name?: unknown;
        description?: unknown;
        instructions?: unknown;
        memory?: unknown;
        pinned?: unknown;
      };

      const project = dependencies.updateProject(id, {
        name: typeof body.name === 'string' ? body.name : undefined,
        description: typeof body.description === 'string' ? body.description : undefined,
        instructions: typeof body.instructions === 'string' ? body.instructions : undefined,
        memory: typeof body.memory === 'string' ? body.memory : undefined,
        pinned: typeof body.pinned === 'boolean' ? body.pinned : undefined,
      });

      return context.json({ project });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });
 
  app.delete('/:id', (context) => {
    try {
      const id = context.req.param('id');
      const deleted = dependencies.deleteProject(id);
      if (!deleted) {
        return context.json({ error: 'Project not found' }, 404);
      }
      return context.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });

  return app;
}
