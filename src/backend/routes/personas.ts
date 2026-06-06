import { Hono } from 'hono';
import { getPersonaList, PERSONAS } from '../services/personas.js';

export function personasRouter(): Hono {
  const app = new Hono();

  /** List all available personas */
  app.get('/', (context) => {
    const personas = getPersonaList().map((p) => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      description: p.description,
    }));
    return context.json({ personas });
  });

  /** Get a specific persona's full prompt */
  app.get('/:id', (context) => {
    const id = context.req.param('id');
    const persona = PERSONAS[id];
    if (!persona) {
      return context.json({ error: 'Persona not found' }, 404);
    }
    return context.json({ persona });
  });

  return app;
}
