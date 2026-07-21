import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  OPENROUTER_API_KEY: z.string().optional().default(''),
  OPENROUTER_MODEL: z.string().default('meta-llama/llama-3-8b-instruct:free'),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
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
  openRouterApiKey: envConfig.OPENROUTER_API_KEY,
  openRouterModel: envConfig.OPENROUTER_MODEL,
  rateLimitMax: envConfig.RATE_LIMIT_MAX,
  isDev: envConfig.NODE_ENV === 'development',
};

export type Config = typeof config;
