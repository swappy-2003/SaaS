import { FastifyInstance } from 'fastify';
import { widgetScript } from '../../widget/script.js';

/** Serves the dependency-free script customers paste into their website. */
export async function widgetRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/widget.js', async (_request, reply) => {
    return reply
      .type('application/javascript; charset=utf-8')
      .header('Cache-Control', 'public, max-age=300')
      .send(widgetScript);
  });
}
