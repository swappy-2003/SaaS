import { MembershipRole } from '@prisma/client';
import { prisma } from '../db/client.js';

/**
 * Resolves membership server-side. Client-provided organization or project IDs
 * are never trusted without this check.
 */
export async function requireOrganizationMembership(
  userId: string,
  organizationId: string,
  minimumRole: MembershipRole = MembershipRole.MEMBER
) {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_organizationId: { userId, organizationId }
    }
  });

  const roleWeight: Record<MembershipRole, number> = {
    MEMBER: 1,
    ADMIN: 2,
    OWNER: 3
  };

  if (!membership || roleWeight[membership.role] < roleWeight[minimumRole]) {
    return null;
  }

  return membership;
}
