// This adapter's product policy is independent of the service's integer range.
export const OUTPUT_ROW_LIMIT = 100;

export function withOutputLimit(input) {
  return { ...input, intents: input.intents.map(intent => ({ ...intent, limit: OUTPUT_ROW_LIMIT })) };
}
