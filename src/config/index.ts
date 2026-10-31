import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(32).optional(),
  VECTOR_DATA_DIR: z.string().default('./vectors'),
  OPENROUTER_API_KEY: z.string().optional().default(''),
  OPENROUTER_MODEL: z.string().default('meta-llama/llama-3-8b-instruct:free'),
  LLM_BASE_URL: z.string().default('https://openrouter.ai/api/v1'), // Configurable provider url
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  PUBLIC_CHAT_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(1000).default(30),
  PUBLIC_CHAT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3600000).default(60000),
  CRAWL_MAX_PAGES: z.coerce.number().int().positive().max(500).default(150),
  CRAWL_MAX_CONCURRENCY: z.coerce.number().int().positive().max(10).default(2),
  CRAWL_TIMEOUT_MS: z.coerce.number().int().positive().max(60000).default(10000),
  INDEX_WORKER_POLL_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
  INDEX_JOB_STALE_MS: z.coerce.number().int().min(60000).max(86400000).default(1800000),
  ENABLE_LEGACY_REINDEX: z.enum(['true', 'false']).default('false'),
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production' && !value.DATABASE_URL) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATABASE_URL'],
      message: 'DATABASE_URL is required in production.'
    });
  }
  if (!value.JWT_SECRET) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_SECRET'],
      message: 'JWT_SECRET is required and must contain at least 32 characters.'
    });
  }
});

const parseConfig = () => {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid configuration:', result.error.format());
    throw new Error(`Environment validation failed: ${JSON.stringify(result.error.format())}`);
  }
  return result.data;
};

const envConfig = parseConfig();

export const config = {
  port: envConfig.PORT,
  host: envConfig.HOST,
  nodeEnv: envConfig.NODE_ENV,
  databaseUrl: envConfig.DATABASE_URL,
  jwtSecret: envConfig.JWT_SECRET!,
  vectorDataDir: envConfig.VECTOR_DATA_DIR,
  openRouterApiKey: envConfig.OPENROUTER_API_KEY,
  openRouterModel: envConfig.OPENROUTER_MODEL,
  llmBaseUrl: envConfig.LLM_BASE_URL,
  rateLimitMax: envConfig.RATE_LIMIT_MAX,
  publicChatRateLimitMax: envConfig.PUBLIC_CHAT_RATE_LIMIT_MAX,
  publicChatRateLimitWindowMs: envConfig.PUBLIC_CHAT_RATE_LIMIT_WINDOW_MS,
  crawlMaxPages: envConfig.CRAWL_MAX_PAGES,
  crawlMaxConcurrency: envConfig.CRAWL_MAX_CONCURRENCY,
  crawlTimeoutMs: envConfig.CRAWL_TIMEOUT_MS,
  indexWorkerPollMs: envConfig.INDEX_WORKER_POLL_MS,
  indexJobStaleMs: envConfig.INDEX_JOB_STALE_MS,
  enableLegacyReindex: envConfig.ENABLE_LEGACY_REINDEX === 'true',
  isDev: envConfig.NODE_ENV === 'development',
};

export type Config = typeof config;
