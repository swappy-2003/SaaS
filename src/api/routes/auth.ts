import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { registerUser, verifyUserCredentials } from '../../auth/service.js';

const passwordSchema = z.string().min(12, 'Password must be at least 12 characters.').max(72);
const registerBodySchema = z.object({
  email: z.string().trim().email().max(254),
  password: passwordSchema,
  organizationName: z.string().trim().min(2).max(100)
});
const loginBodySchema = z.object({
  email: z.string().trim().email().max(254),
  password: passwordSchema
});

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/auth/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = registerBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid registration data.' });
    }

    const registered = await registerUser(parsed.data);
    if (!registered) {
      return reply.status(409).send({ error: 'Conflict', message: 'An account with this email already exists.' });
    }

    const accessToken = await reply.jwtSign(
      { sub: registered.user.id, email: registered.user.email },
      { expiresIn: '7d' }
    );

    return reply.status(201).send({
      accessToken,
      user: registered.user,
      organization: registered.organization
    });
  });

  fastify.post('/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = loginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid login data.' });
    }

    const user = await verifyUserCredentials(parsed.data.email, parsed.data.password);
    if (!user) {
      logger.warn('Rejected login attempt');
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid email or password.' });
    }

    const accessToken = await reply.jwtSign({ sub: user.id, email: user.email }, { expiresIn: '7d' });
    return reply.send({ accessToken, user });
  });

  fastify.get('/auth/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    return reply.send({ user: { id: request.user.sub, email: request.user.email } });
  });
}
