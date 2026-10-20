import { createHash, randomBytes } from 'node:crypto';
import * as cheerio from 'cheerio';
import { MembershipRole } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireProjectMembership } from '../../auth/authorization.js';
import { prisma } from '../../db/client.js';
import { assertPublicWebsiteUrl, fetchVerifiedWebsiteHtml, UnsafeWebsiteUrlError } from '../../security/publicUrl.js';

const projectIdParams = z.object({ projectId: z.string().uuid() });
const websiteIdParams = z.object({ websiteId: z.string().uuid() });
const createWebsiteBody = z.object({
  name: z.string().trim().min(2).max(100),
  url: z.string().trim().max(2048),
  allowedOrigins: z.array(z.string().trim().url().max(2048)).max(20).default([])
});

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeAllowedOrigins(origins: string[]): string[] {
  return [...new Set(origins.map((origin) => {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new UnsafeWebsiteUrlError('Allowed origins must be HTTP(S) origins without a path.');
    }
    return url.origin;
  }))];
}

function rootOnly(url: URL): URL {
  if (url.pathname !== '/' || url.search) {
    throw new UnsafeWebsiteUrlError('Enter the website root URL, such as https://example.com/.');
  }
  return url;
}

export async function websiteRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/projects/:projectId/websites', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const params = projectIdParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid project ID.' });

    const project = await requireProjectMembership(request.user.sub, params.data.projectId);
    if (!project) return reply.status(404).send({ error: 'Not Found', message: 'Project not found.' });

    const websites = await prisma.website.findMany({
      where: { projectId: project.id },
      select: {
        id: true, name: true, url: true, allowedOrigins: true, status: true, verifiedAt: true,
        lastIndexedAt: true, indexedPageCount: true, indexedChunkCount: true, createdAt: true, updatedAt: true
      },
      orderBy: { createdAt: 'asc' }
    });
    return reply.send({ websites });
  });

  fastify.post('/projects/:projectId/websites', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const params = projectIdParams.safeParse(request.params);
    const body = createWebsiteBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid website data.' });

    const project = await requireProjectMembership(request.user.sub, params.data.projectId, MembershipRole.ADMIN);
    if (!project) return reply.status(404).send({ error: 'Not Found', message: 'Project not found.' });

    try {
      const url = rootOnly(await assertPublicWebsiteUrl(body.data.url));
      const verificationToken = `rbv_${randomBytes(24).toString('base64url')}`;
      const website = await prisma.website.create({
        data: {
          projectId: project.id,
          name: body.data.name,
          url: url.toString(),
          allowedOrigins: normalizeAllowedOrigins(body.data.allowedOrigins),
          verificationTokenHash: tokenHash(verificationToken)
        },
        select: { id: true, name: true, url: true, status: true, allowedOrigins: true, createdAt: true }
      });
      return reply.status(201).send({
        website,
        verification: {
          token: verificationToken,
          instruction: `Add <meta name="ragbot-verification" content="${verificationToken}"> to the <head> of ${url.origin}, then call POST /websites/${website.id}/verify. Store this token now; it is not returned again.`
        }
      });
    } catch (error) {
      if (error instanceof UnsafeWebsiteUrlError) {
        return reply.status(400).send({ error: 'Bad Request', message: error.message });
      }
      if ((error as any)?.code === 'P2002') {
        return reply.status(409).send({ error: 'Conflict', message: 'This website already exists in the project.' });
      }
      throw error;
    }
  });

  fastify.post('/websites/:websiteId/verify', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const params = websiteIdParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid website ID.' });

    const website = await prisma.website.findFirst({
      where: { id: params.data.websiteId, project: { organization: { memberships: { some: { userId: request.user.sub, role: { in: ['OWNER', 'ADMIN'] } } } } } },
      select: { id: true, url: true, verificationTokenHash: true, verifiedAt: true }
    });
    if (!website) return reply.status(404).send({ error: 'Not Found', message: 'Website not found.' });
    if (website.verifiedAt) return reply.send({ verifiedAt: website.verifiedAt, status: 'already_verified' });
    if (!website.verificationTokenHash) return reply.status(409).send({ error: 'Conflict', message: 'Website has no active verification token.' });

    try {
      const { html } = await fetchVerifiedWebsiteHtml(website.url);
      const suppliedToken = cheerio.load(html)('meta[name="ragbot-verification"]').first().attr('content')?.trim();
      if (!suppliedToken || tokenHash(suppliedToken) !== website.verificationTokenHash) {
        return reply.status(422).send({ error: 'Unprocessable Entity', message: 'Verification meta tag was not found or did not match.' });
      }

      const updated = await prisma.website.update({
        where: { id: website.id },
        data: { verifiedAt: new Date() },
        select: { id: true, url: true, status: true, verifiedAt: true }
      });
      return reply.send({ website: updated });
    } catch (error) {
      if (error instanceof UnsafeWebsiteUrlError) {
        return reply.status(400).send({ error: 'Bad Request', message: error.message });
      }
      throw error;
    }
  });
}
