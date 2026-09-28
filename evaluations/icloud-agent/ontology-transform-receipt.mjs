import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function transformResult(result, intent, context, outputDir) {
  if (result?.error === true) {
    return { content: [{ type: 'text', text: JSON.stringify({
      schema: result.schema,
      error: true,
      diagnostics: result.diagnostics,
    }) }], isError: true };
  }
  const query = result?.ok;
  if (result?.error !== false || typeof query?.sql !== 'string' ||
      !Array.isArray(query.bindings)) {
    throw new Error('ontology service returned an invalid transform response');
  }
  const receipt = randomUUID();
  writeFileSync(join(outputDir, `${receipt}.json`), JSON.stringify({
    intent,
    ...(context === undefined ? {} : { ctx: context }),
    query,
  }), { flag: 'wx', mode: 0o600 });
  return {
    content: [{ type: 'text', text: JSON.stringify({ accepted: true, receipt }) }],
    isError: false,
  };
}
