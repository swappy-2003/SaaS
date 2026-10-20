import { IndexJobStatus, MembershipRole, WebsiteStatus } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';

const websiteIdParams = z.object({ websiteId: z.string().uuid() });
const jobIdParams = z.object({ jobId: z.string().uuid() });

const websiteSelect = {
  id: true,
  verifiedAt: true,
  status: true,
  project: {
    select: {
      organization: { select: { memberships: { select: { userId: true, role: true } } } }
    }
  }
} as const;

async function findAuthorizedWebsite(userId: string, websiteId: string, minimumRole: MembershipRole) {
  const website = await prisma.website.findUnique({ where: { id: websiteId }, select: websiteSelect });
  const membership = website?.project.organization.memberships.find(({ userId: memberId }) => memberId === userId);
  const weights: Record<MembershipRole, number> = { MEMBER: 1, ADMIN: 2, OWNER: 3 };
  return website && membership && weights[membership.role] >= weights[minimumRole] ? website : null;
}

export async function indexingJobRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/websites/:websiteId/indexing-jobs', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const params = websiteIdParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid website ID.' });

    const website = await findAuthorizedWebsite(request.user.sub, params.data.websiteId, MembershipRole.ADMIN);
    if (!website) return reply.status(404).send({ error: 'Not Found', message: 'Website not found.' });
    if (!website.verifiedAt) return reply.status(409).send({ error: 'Conflict', message: 'Verify website ownership before indexing.' });

    const activeJob = await prisma.indexingJob.findFirst({
      where: { websiteId: website.id, status: { in: [IndexJobStatus.QUEUED, IndexJobStatus.RUNNING] } },
      select: { id: true, status: true }
    });
    if (activeJob) return reply.status(409).send({ error: 'Conflict', message: 'An indexing job is already active.', job: activeJob });

    try {
      const job = await prisma.$transaction(async (tx) => {
        await tx.website.update({ where: { id: website.id }, data: { status: WebsiteStatus.INDEXING } });
        return tx.indexingJob.create({
          data: { websiteId: website.id },
          select: { id: true, websiteId: true, status: true, requestedAt: true, attempt: true }
        });
      });
      return reply.status(202).send({ job });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        return reply.status(409).send({ error: 'Conflict', message: 'An indexing job is already active.' });
      }
      throw error;
    }
  });

  fastify.get('/websites/:websiteId/indexing-jobs', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const params = websiteIdParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid website ID.' });
    const website = await findAuthorizedWebsite(request.user.sub, params.data.websiteId, MembershipRole.MEMBER);
    if (!website) return reply.status(404).send({ error: 'Not Found', message: 'Website not found.' });

    const jobs = await prisma.indexingJob.findMany({
      where: { websiteId: website.id },
      select: { id: true, status: true, attempt: true, pagesCrawled: true, chunksCreated: true, errorMessage: true, requestedAt: true, startedAt: true, finishedAt: true },
      orderBy: { requestedAt: 'desc' },
      take: 25
    });
    return reply.send({ jobs });
  });

  fastify.post('/indexing-jobs/:jobId/cancel', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const params = jobIdParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid job ID.' });
    const job = await prisma.indexingJob.findUnique({
      where: { id: params.data.jobId },
      select: { id: true, status: true, websiteId: true }
    });
    if (!job) return reply.status(404).send({ error: 'Not Found', message: 'Indexing job not found.' });
    const website = await findAuthorizedWebsite(request.user.sub, job.websiteId, MembershipRole.ADMIN);
    if (!website) return reply.status(404).send({ error: 'Not Found', message: 'Indexing job not found.' });
    if (job.status !== IndexJobStatus.QUEUED) {
      return reply.status(409).send({ error: 'Conflict', message: 'Only queued jobs can be cancelled.' });
    }

    const cancelled = await prisma.$transaction(async (tx) => {
      const result = await tx.indexingJob.updateMany({
        where: { id: job.id, status: IndexJobStatus.QUEUED },
        data: { status: IndexJobStatus.CANCELLED, finishedAt: new Date() }
      });
      if (result.count !== 1) return null;
      await tx.website.update({ where: { id: website.id }, data: { status: WebsiteStatus.DRAFT } });
      return tx.indexingJob.findUnique({ where: { id: job.id }, select: { id: true, status: true, finishedAt: true } });
    });
    if (!cancelled) return reply.status(409).send({ error: 'Conflict', message: 'Job state changed before cancellation.' });
    return reply.send({ job: cancelled });
  });
}
