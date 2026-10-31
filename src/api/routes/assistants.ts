import { MembershipRole, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireProjectMembership } from '../../auth/authorization.js';
import { prisma } from '../../db/client.js';

const websiteIdParams = z.object({ websiteId: z.string().uuid() });
const assistantBody = z.object({
  name: z.string().trim().min(2).max(100),
  welcomeMessage: z.string().trim().min(1).max(500),
  theme: z.record(z.unknown()).optional()
});

const assistantSelect = {
  id: true, publicId: true, name: true, welcomeMessage: true, theme: true, createdAt: true, updatedAt: true
} as const;

async function findAuthorizedWebsite(userId: string, websiteId: string, minimumRole: MembershipRole) {
  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { id: true, projectId: true }
  });
  if (!website) return null;
  const project = await requireProjectMembership(userId, website.projectId, minimumRole);
  return project ? website : null;
}

/** Administrative configuration for the public assistant installed on a website. */
export async function assistantRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/websites/:websiteId/assistant', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const params = websiteIdParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid website ID.' });

    const website = await findAuthorizedWebsite(request.user.sub, params.data.websiteId, MembershipRole.MEMBER);
    if (!website) return reply.status(404).send({ error: 'Not Found', message: 'Website not found.' });

    const assistant = await prisma.assistant.findUnique({ where: { websiteId: website.id }, select: assistantSelect });
    return reply.send({ assistant });
  });

  fastify.put('/websites/:websiteId/assistant', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const params = websiteIdParams.safeParse(request.params);
    const body = assistantBody.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid assistant configuration.' });
    }

    const website = await findAuthorizedWebsite(request.user.sub, params.data.websiteId, MembershipRole.ADMIN);
    if (!website) return reply.status(404).send({ error: 'Not Found', message: 'Website not found.' });

    const theme = body.data.theme as Prisma.InputJsonValue | undefined;
    const data = {
      name: body.data.name,
      welcomeMessage: body.data.welcomeMessage,
      ...(theme === undefined ? {} : { theme })
    };
    const existing = await prisma.assistant.findUnique({ where: { websiteId: website.id }, select: { id: true } });
    const assistant = existing
      ? await prisma.assistant.update({ where: { id: existing.id }, data, select: assistantSelect })
      : await prisma.assistant.create({
          data: { websiteId: website.id, publicId: `asst_${randomBytes(18).toString('base64url')}`, ...data, theme: theme ?? {} },
          select: assistantSelect
        });

    return reply.status(existing ? 200 : 201).send({ assistant });
  });
}
