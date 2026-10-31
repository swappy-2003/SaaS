import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireProjectMembership } from '../../auth/authorization.js';
import { prisma } from '../../db/client.js';
import { RagService } from '../../services/ragService.js';

const paramsSchema = z.object({ websiteId: z.string().uuid() });
const bodySchema = z.object({ message: z.string().trim().min(1).max(4000) });

/** Authenticated dashboard-only RAG test path; it deliberately bypasses public origin checks. */
export async function testChatRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/websites/:websiteId/test-chat', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = bodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid test-chat request.' });
    }

    const website = await prisma.website.findUnique({
      where: { id: params.data.websiteId },
      select: { id: true, name: true, projectId: true, status: true }
    });
    if (!website || !await requireProjectMembership(request.user.sub, website.projectId)) {
      return reply.status(404).send({ error: 'Not Found', message: 'Website not found.' });
    }
    if (website.status !== 'READY') {
      return reply.status(409).send({ error: 'Conflict', message: 'Index the website successfully before testing its assistant.' });
    }

    const result = await RagService.queryForWebsite(website.id, body.data.message, website.name);
    return reply.send(result);
  });
}
