/** UTC text uses fixed three-digit milliseconds so lexical order is chronological. */
export function normalizeUtcMillis(value) {
  const match = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  const milliseconds = match ? Date.parse(value) : NaN;
  const normalized = match ? `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z` : '';
  if (!match || match[1].startsWith('0000-') || !Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== normalized) {
    throw new Error('anchor must be a valid UTC timestamp with seconds or 1..3 fractional digits');
  }
  return normalized;
}
