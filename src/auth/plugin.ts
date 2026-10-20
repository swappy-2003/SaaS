import fastifyJwt from '@fastify/jwt';
import { FastifyInstance } from 'fastify';
import { config } from '../config/index.js';

export async function authPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(fastifyJwt, { secret: config.jwtSecret });

  fastify.decorate('authenticate', async function authenticate(request, reply) {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'A valid bearer token is required.'
      });
    }
  });
}
