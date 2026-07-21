import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { FastifyInstance } from 'fastify';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Registers essential security middlewares on the Fastify instance:
 * CORS, Helmet security headers, and API rate limiting.
 */
export async function registerSecurity(fastify: FastifyInstance): Promise<void> {
  logger.info('Registering security middlewares (CORS, Helmet, Rate Limiter)...');

  // 1. Configure CORS
  await fastify.register(cors, {
    origin: '*', // For a reusable SaaS/public API product. Can be restricted in config later.
    methods: ['GET', 'POST', 'OPTIONS'],
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
      // Use IP address or fallback to default
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

  logger.info('Security middlewares successfully registered.');
}
