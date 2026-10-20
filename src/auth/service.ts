import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../db/client.js';

const PASSWORD_ROUNDS = 12;

export interface RegisterInput {
  email: string;
  password: string;
  organizationName: string;
}

export interface SafeUser {
  id: string;
  email: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function organizationSlug(name: string): string {
  const readable = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'organization';

  return `${readable}-${randomUUID().slice(0, 8)}`;
}

export async function registerUser(input: RegisterInput) {
  const email = normalizeEmail(input.email);
  const passwordHash = await bcrypt.hash(input.password, PASSWORD_ROUNDS);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing) {
      return null;
    }

    const user = await tx.user.create({
      data: { email, passwordHash },
      select: { id: true, email: true }
    });
    const organization = await tx.organization.create({
      data: {
        name: input.organizationName.trim(),
        slug: organizationSlug(input.organizationName),
        memberships: { create: { userId: user.id, role: 'OWNER' } }
      },
      select: { id: true, name: true, slug: true }
    });

    return { user, organization };
  });
}

export async function verifyUserCredentials(emailInput: string, password: string): Promise<SafeUser | null> {
  const email = normalizeEmail(emailInput);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash) {
    return null;
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    return null;
  }

  return { id: user.id, email: user.email };
}
