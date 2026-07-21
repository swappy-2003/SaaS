import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { IndexingService } from '../../services/indexingService.js';
import { logger } from '../../utils/logger.js';

const reindexBodySchema = z.object({
  siteId: z.string().min(1, 'siteId is required')
});

export async function reindexRoutes(fastify: FastifyInstance) {
  fastify.post('/reindex', async (request: FastifyRequest, reply: FastifyReply) => {
    logger.info('Received reindex request');

    // 1. Validate request body
    const bodyParse = reindexBodySchema.safeParse(request.body);
    if (!bodyParse.success) {
      logger.warn('Invalid reindex request body', bodyParse.error.format());
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid request body',
        details: bodyParse.error.format()
      });
    }

    const { siteId } = bodyParse.data;

    try {
      // 2. Start the indexing process asynchronously in the background.
      // This protects HTTP requests from timeouts during heavy crawler runs.
      IndexingService.indexSite(siteId)
        .then(() => {
          logger.info(`Background indexing completed successfully for siteId: "${siteId}"`);
        })
        .catch((err) => {
          logger.error(`Background indexing failed for siteId: "${siteId}"`, err);
        });

      // 3. Return 202 Accepted immediately
      return reply.status(202).send({
        status: 'accepted',
        message: `Re-indexing initiated for siteId: "${siteId}" in the background.`
      });
    } catch (error: any) {
      logger.error(`Re-indexing initiation failed for siteId: "${siteId}"`, error);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: error.message || 'Failed to initiate indexing.'
      });
    }
  });
}
