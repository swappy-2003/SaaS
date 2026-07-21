import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Health check endpoint for checking deployment status.
 */
export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV || 'development'
    });
  });
}
