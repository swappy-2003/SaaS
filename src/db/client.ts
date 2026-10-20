import { PrismaClient } from '@prisma/client';

/**
 * One process-wide client prevents connection storms during Fastify hot reloads.
 * Tenant access is enforced in the repository layer, never by this client alone.
 */
export const prisma = new PrismaClient();

export default prisma;
