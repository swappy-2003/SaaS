import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { FastifyInstance } from 'fastify';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Registers essential security middlewares on the Fastify instance:
 * CORS (restricted to allowed domains), Helmet security headers, and API rate limiting.
 */
export async function registerSecurity(fastify: FastifyInstance): Promise<void> {
  logger.info('Registering production-grade security middlewares...');

  // 1. Configure CORS (Restricting access to only allowed frontend domains)
  const allowedOriginsString = process.env.ALLOWED_ORIGINS || '';
  // Split comma-separated origins, default to '*' in development if empty
  const allowedOrigins = allowedOriginsString
    ? allowedOriginsString.split(',').map(o => o.trim())
    : (config.isDev ? '*' : []);

  logger.info(`CORS allowed origins configured:`, allowedOrigins);

  await fastify.register(cors, {
    origin: allowedOrigins,
    methods: ['POST', 'OPTIONS'], // Restrict to POST (chat/reindex) and OPTIONS (preflight)
    allowedHeaders: ['Content-Type', 'Authorization']
  });

  // 2. Configure Helmet (Security Headers)
  await fastify.register(helmet, {
    contentSecurityPolicy: config.isDev ? false : undefined
  });

  // 3. Configure Rate Limiter
  await fastify.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      return req.headers['x-forwarded-for'] as string || req.ip;
    },
    errorResponseBuilder: (request, context) => {
      return {
        statusCode: 429,
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Maximum allowed is ${context.max} requests per ${context.after}.`
      };
    }
  });

  logger.info('Security middlewares successfully registered and active.');
}
