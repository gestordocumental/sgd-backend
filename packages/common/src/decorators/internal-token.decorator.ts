import { SetMetadata } from '@nestjs/common';

/** Metadata key used by JwtGuard to restrict internal token acceptance. */
export const INTERNAL_TOKEN_KEYS_META = 'internalTokenKeys';

/**
 * Declares which INTERNAL_TOKEN_* env-var keys are valid for this endpoint.
 * When present, JwtGuard only accepts tokens whose value matches one of the
 * specified keys — rejecting tokens from other services even if they are
 * configured in the current service's environment.
 *
 * @example
 * // Only auth-service may call this endpoint
 * \@AllowInternalTokens('INTERNAL_TOKEN_AUTH_USER')
 * \@Get(':id/companies')
 * getCompanies(...) {}
 */
export const AllowInternalTokens = (...keys: string[]) =>
  SetMetadata(INTERNAL_TOKEN_KEYS_META, keys);
