import dotenv from 'dotenv';
dotenv.config();

const isDev = process.env.NODE_ENV !== 'production';

export interface Logger {
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, error?: any, meta?: any): void;
  debug(message: string, meta?: any): void;
}

export const logger: Logger = {
  info: (message: string, meta?: any) => {
    const timestamp = new Date().toISOString();
    if (isDev) {
      console.log(`[INFO] ${timestamp}: ${message}`, meta ? JSON.stringify(meta, null, 2) : '');
    } else {
      console.log(JSON.stringify({ level: 'info', timestamp, message, ...meta }));
    }
  },
  warn: (message: string, meta?: any) => {
    const timestamp = new Date().toISOString();
    if (isDev) {
      console.warn(`[WARN] ${timestamp}: ${message}`, meta ? JSON.stringify(meta, null, 2) : '');
    } else {
      console.warn(JSON.stringify({ level: 'warn', timestamp, message, ...meta }));
    }
  },
  error: (message: string, error?: any, meta?: any) => {
    const timestamp = new Date().toISOString();
    const errorDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error;
    if (isDev) {
      console.error(`[ERROR] ${timestamp}: ${message}`, errorDetails || '', meta ? JSON.stringify(meta, null, 2) : '');
    } else {
      console.error(JSON.stringify({ level: 'error', timestamp, message, error: errorDetails, ...meta }));
    }
  },
  debug: (message: string, meta?: any) => {
    const timestamp = new Date().toISOString();
    if (isDev) {
      console.debug(`[DEBUG] ${timestamp}: ${message}`, meta ? JSON.stringify(meta, null, 2) : '');
    } else {
      console.debug(JSON.stringify({ level: 'debug', timestamp, message, ...meta }));
    }
  }
};
