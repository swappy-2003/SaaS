import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RagService } from '../../services/ragService.js';
import { logger } from '../../utils/logger.js';

const chatBodySchema = z.object({
  siteId: z.string().min(1, 'siteId is required'),
  message: z.string().min(1, 'message is required'),
  stream: z.boolean().optional().default(false) // Default to standard JSON, stream if true
});

type ChatBody = z.infer<typeof chatBodySchema>;

export async function chatRoutes(fastify: FastifyInstance) {
  fastify.post('/chat', async (request: FastifyRequest, reply: FastifyReply) => {
    logger.info('Received chat request');

    // 1. Validate request body
    const bodyParse = chatBodySchema.safeParse(request.body);
    if (!bodyParse.success) {
      logger.warn('Invalid chat request body', bodyParse.error.format());
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid request body',
        details: bodyParse.error.format()
      });
    }

    const { siteId, message, stream } = bodyParse.data;

    try {
      if (stream) {
        // --- STREAMING MODE (SSE) ---
        const { stream: tokenStream, sources } = await RagService.queryStream(siteId, message);

        // Set streaming response headers
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });

        // 1. Emit the citations sources block first
        reply.raw.write(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`);

        // 2. Stream tokens from OpenRouter
        for await (const token of tokenStream) {
          reply.raw.write(`data: ${JSON.stringify({ type: 'token', content: token })}\n\n`);
        }

        // 3. Emit termination signal
        reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        reply.raw.end();
        
        logger.info(`SSE stream completed for siteId: "${siteId}"`);
        return reply; // Fastify knows request is handled
      } else {
        // --- STANDARD JSON MODE ---
        const result = await RagService.query(siteId, message);
        return reply.status(200).send({
          answer: result.answer,
          sources: result.sources
        });
      }
    } catch (error: any) {
      logger.error(`Chat handler failed for siteId: "${siteId}"`, error);
      
      // If headers are already written, we must end the raw socket instead of standard send
      if (reply.raw.headersSent) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
        reply.raw.end();
        return reply;
      }

      return reply.status(500).send({
        error: 'Internal Server Error',
        message: error.message || 'An error occurred during query processing.'
      });
    }
  });
}
