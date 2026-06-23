const UNIT_MULTIPLIERS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3_600,
  d: 86_400,
};

/**
 * Parses a duration string (e.g. "15m", "1h", "300s", "300") into seconds.
 * Supports units: s, m, h, d. Bare numbers are treated as seconds.
 * Returns `fallback` (default 300) when the input cannot be parsed.
 */
export function parseDurationToSeconds(value: string, fallback = 300): number {
  const match = /^(\d+)([smhd])?$/.exec(value.trim());
  if (!match) return fallback;
  const multiplier = UNIT_MULTIPLIERS[match[2] ?? 's'] ?? 1;
  return Number(match[1]) * multiplier;
}
