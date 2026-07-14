import { isNonTrippingClientError } from './org-client.service';

describe('isNonTrippingClientError', () => {
  it.each([400, 403, 404, 409, 422])(
    'returns true for deterministic client error %i — must not trip the circuit',
    (status) => {
      expect(isNonTrippingClientError(status)).toBe(true);
    },
  );

  it.each([408, 429])(
    'returns false for %i — signals org-service is struggling, must trip the circuit',
    (status) => {
      expect(isNonTrippingClientError(status)).toBe(false);
    },
  );

  it.each([500, 502, 503, 504])('returns false for server error %i', (status) => {
    expect(isNonTrippingClientError(status)).toBe(false);
  });

  it.each([undefined, null, 'not-a-number', 399, 600])(
    'returns false for a non-4xx or non-numeric status (%p)',
    (status) => {
      expect(isNonTrippingClientError(status)).toBe(false);
    },
  );
});
