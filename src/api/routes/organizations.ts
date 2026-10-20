import { MembershipRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireOrganizationMembership } from '../../auth/authorization.js';
import { prisma } from '../../db/client.js';

const organizationIdParams = z.object({ organizationId: z.string().uuid() });
const createProjectBody = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60)
});

export async function organizationRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/organizations', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const memberships = await prisma.membership.findMany({
      where: { userId: request.user.sub },
      select: {
        role: true,
        organization: { select: { id: true, name: true, slug: true, createdAt: true } }
      },
      orderBy: { createdAt: 'asc' }
    });
    return reply.send({ organizations: memberships.map(({ organization, role }) => ({ ...organization, role })) });
  });

  fastify.get('/projects', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const projects = await prisma.project.findMany({
      where: { organization: { memberships: { some: { userId: request.user.sub } } } },
      select: {
        id: true,
        name: true,
        slug: true,
        organizationId: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { createdAt: 'asc' }
    });
    return reply.send({ projects });
  });

  fastify.post('/organizations/:organizationId/projects', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const params = organizationIdParams.safeParse(request.params);
    const body = createProjectBody.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid project data.' });
    }

    const membership = await requireOrganizationMembership(
      request.user.sub,
      params.data.organizationId,
      MembershipRole.ADMIN
    );
    if (!membership) {
      return reply.status(403).send({ error: 'Forbidden', message: 'You cannot create projects in this organization.' });
    }

    try {
      const project = await prisma.project.create({
        data: {
          organizationId: params.data.organizationId,
          name: body.data.name,
          slug: body.data.slug,
          vectorNamespace: `project-${randomUUID()}`
        },
        select: { id: true, name: true, slug: true, organizationId: true, createdAt: true }
      });
      return reply.status(201).send({ project });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        return reply.status(409).send({ error: 'Conflict', message: 'A project with this slug already exists.' });
      }
      throw error;
    }
  });
}
