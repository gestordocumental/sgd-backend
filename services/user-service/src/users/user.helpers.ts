import { BadRequestException } from '@nestjs/common';

export const INVITATION_TTL_SECONDS = 72 * 60 * 60; // 259200s = 72h

/**
 * Guards self-service actions (delete/disable/remove/etc.) that a caller
 * must not be able to perform on their own account. Centralized so the
 * error shape stays consistent across the several call sites that need it.
 */
export function assertNotSelfAction(
  actorId: string | undefined,
  targetId: string,
  { message, errorCode }: { message: string; errorCode: string },
): void {
  if (actorId && actorId === targetId) {
    throw new BadRequestException({ message, errorCode, params: { userId: targetId } });
  }
}

export function userDisplayName(user: {
  firstName?: string | null;
  lastName?: string | null;
  email: string;
}): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || user.email;
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ at: createdAt.toISOString(), id })).toString('base64url');
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function decodeCursor(raw: string): { at: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof parsed.at !== 'string' ||
      Number.isNaN(Date.parse(parsed.at)) ||
      typeof parsed.id !== 'string' ||
      !UUID_RE.test(parsed.id)
    ) {
      throw new BadRequestException('Invalid cursor');
    }
    return parsed;
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}
