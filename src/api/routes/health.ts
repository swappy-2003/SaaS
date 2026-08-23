import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Health check endpoint for checking deployment status.
 */
export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const memUsage = process.memoryUsage();

    return reply.status(200).send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      env: process.env.NODE_ENV || 'development',
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024)
      }
    });
  });
}
