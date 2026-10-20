import Fastify from 'fastify';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { registerSecurity } from './api/middleware/security.js';
import { healthRoutes } from './api/routes/health.js';
import { reindexRoutes } from './api/routes/reindex.js';
import { chatRoutes } from './api/routes/chat.js';
import { authPlugin } from './auth/plugin.js';
import { authRoutes } from './api/routes/auth.js';
import { organizationRoutes } from './api/routes/organizations.js';

const fastify = Fastify({
  logger: false // Disable default Pino logging since we use our own custom structured logger
});

async function startServer() {
  try {
    // 1. Setup security middlewares (cors, helmet, rate-limit)
    await registerSecurity(fastify);
    // Auth decorates the root instance so all subsequently registered routes
    // can use fastify.authenticate.
    await authPlugin(fastify);

    // 2. Register application endpoints
    await fastify.register(authRoutes);
    await fastify.register(organizationRoutes);
    await fastify.register(healthRoutes);
    await fastify.register(reindexRoutes);
    await fastify.register(chatRoutes);

    // 3. Global error handling
    fastify.setErrorHandler((error, request, reply) => {
      logger.error('Unhandled Fastify request exception', error);
      reply.status(error.statusCode || 500).send({
        error: error.name || 'InternalServerError',
        message: config.isDev
          ? error.message || 'An unexpected error occurred.'
          : 'An unexpected error occurred.'
      });
    });

    // 4. Start HTTP listener
    logger.info(`Bootstrapping server environment: ${config.nodeEnv}`);
    await fastify.listen({
      port: config.port,
      host: config.host
    });

    logger.info(`🚀 Server running and listening at: http://${config.host}:${config.port}`);
  } catch (error) {
    logger.error('Fatal crash on server start', error);
    process.exit(1);
  }
}

startServer();
export default fastify;
