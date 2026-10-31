import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { prisma } from '../../db/client.js';
import { RagService } from '../../services/ragService.js';
import { logger } from '../../utils/logger.js';

const publicIdParams = z.object({ publicId: z.string().regex(/^asst_[A-Za-z0-9_-]{20,}$/) });
const publicChatBody = z.object({
  message: z.string().trim().min(1).max(4000),
  visitorId: z.string().trim().min(1).max(128).optional(),
  conversationId: z.string().uuid().optional(),
  stream: z.boolean().optional().default(false)
});

const publicAssistantSelect = {
  id: true,
  publicId: true,
  name: true,
  welcomeMessage: true,
  theme: true,
  website: {
    select: {
      id: true, name: true, allowedOrigins: true, status: true,
      project: { select: { id: true, organizationId: true } }
    }
  }
} as const;

function requestOrigin(request: { headers: Record<string, string | string[] | undefined> }): string | null {
  const value = request.headers.origin;
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') ? url.origin : null;
  } catch {
    return null;
  }
}

function assertAllowedOrigin(request: { headers: Record<string, string | string[] | undefined> }, allowedOrigins: string[]): string | null {
  const origin = requestOrigin(request);
  return origin && allowedOrigins.includes(origin) ? origin : null;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.trim().length / 4);
}

async function persistExchange(input: {
  websiteId: string;
  projectId: string;
  organizationId: string;
  visitorId: string;
  conversationId?: string;
  message: string;
  answer: string;
  publicId: string;
}): Promise<string> {
  const conversation = input.conversationId
    ? await prisma.conversation.findFirst({ where: { id: input.conversationId, websiteId: input.websiteId }, select: { id: true } })
    : null;
  const conversationId = conversation?.id ?? (await prisma.conversation.create({
    data: { websiteId: input.websiteId, visitorId: input.visitorId }, select: { id: true }
  })).id;

  await prisma.$transaction([
    prisma.chatMessage.createMany({ data: [
      { conversationId, role: 'USER', content: input.message },
      { conversationId, role: 'ASSISTANT', content: input.answer }
    ] }),
    prisma.usageEvent.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        eventType: 'public_chat_completion',
        inputTokens: estimateTokens(input.message),
        outputTokens: estimateTokens(input.answer),
        metadata: { assistantPublicId: input.publicId, websiteId: input.websiteId }
      }
    })
  ]);
  return conversationId;
}

export async function publicChatRoutes(fastify: FastifyInstance): Promise<void> {
  const routeOptions = {
    config: {
      rateLimit: {
        max: config.publicChatRateLimitMax,
        timeWindow: config.publicChatRateLimitWindowMs,
        keyGenerator: (request: any) => `${request.params.publicId}:${request.ip}`
      }
    }
  };

  fastify.get('/public/assistants/:publicId', routeOptions, async (request, reply) => {
    const params = publicIdParams.safeParse(request.params);
    if (!params.success) return reply.status(404).send({ error: 'Not Found', message: 'Assistant not found.' });
    const assistant = await prisma.assistant.findUnique({ where: { publicId: params.data.publicId }, select: publicAssistantSelect });
    if (!assistant || assistant.website.status !== 'READY') return reply.status(404).send({ error: 'Not Found', message: 'Assistant not found.' });

    const origin = assertAllowedOrigin(request, assistant.website.allowedOrigins);
    if (!origin) return reply.status(403).send({ error: 'Forbidden', message: 'This origin is not allowed for the assistant.' });
    reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
    return reply.send({ assistant: { publicId: assistant.publicId, name: assistant.name, welcomeMessage: assistant.welcomeMessage, theme: assistant.theme } });
  });

  fastify.post('/public/assistants/:publicId/chat', routeOptions, async (request, reply) => {
    const params = publicIdParams.safeParse(request.params);
    const body = publicChatBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid public chat request.' });

    const assistant = await prisma.assistant.findUnique({ where: { publicId: params.data.publicId }, select: publicAssistantSelect });
    if (!assistant || assistant.website.status !== 'READY') return reply.status(404).send({ error: 'Not Found', message: 'Assistant not found.' });

    const origin = assertAllowedOrigin(request, assistant.website.allowedOrigins);
    if (!origin) return reply.status(403).send({ error: 'Forbidden', message: 'This origin is not allowed for the assistant.' });
    reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');

    const { message, stream } = body.data;
    const visitorId = body.data.visitorId ?? randomUUID();
    const context = {
      websiteId: assistant.website.id,
      projectId: assistant.website.project.id,
      organizationId: assistant.website.project.organizationId,
      visitorId,
      conversationId: body.data.conversationId,
      message,
      publicId: assistant.publicId
    };

    try {
      if (!stream) {
        const result = await RagService.queryForWebsite(assistant.website.id, message, assistant.website.name);
        const conversationId = await persistExchange({ ...context, answer: result.answer });
        return reply.send({ answer: result.answer, sources: result.sources, conversationId, visitorId });
      }

      const result = await RagService.queryStreamForWebsite(assistant.website.id, message, assistant.website.name);
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': origin,
        Vary: 'Origin'
      });
      reply.raw.write(`data: ${JSON.stringify({ type: 'sources', sources: result.sources, visitorId })}\n\n`);
      let answer = '';
      for await (const token of result.stream) {
        answer += token;
        reply.raw.write(`data: ${JSON.stringify({ type: 'token', content: token })}\n\n`);
      }
      const conversationId = await persistExchange({ ...context, answer });
      reply.raw.write(`data: ${JSON.stringify({ type: 'done', conversationId, visitorId })}\n\n`);
      reply.raw.end();
      return reply;
    } catch (error) {
      logger.error(`Public chat failed for assistant ${assistant.publicId}`, error);
      if (reply.raw.headersSent) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: 'Unable to complete the response.' })}\n\n`);
        reply.raw.end();
        return reply;
      }
      throw error;
    }
  });
}
