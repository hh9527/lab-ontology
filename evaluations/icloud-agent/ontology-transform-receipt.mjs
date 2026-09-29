import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function transformResults(results, intents, outputDir) {
  if (!Array.isArray(results) || results.length !== intents.length) {
    throw new Error('ontology service returned an invalid transform response');
  }
  const assessed = results.map((result, index) => {
    if (result?.error === true && Array.isArray(result.diagnostics)) {
      return { index, accepted: false, diagnostics: result.diagnostics };
    }
    const query = result?.ok;
    if (result?.error !== false || typeof query?.sql !== 'string' ||
        !Array.isArray(query.bindings)) {
      throw new Error('ontology service returned an invalid transform response');
    }
    return { index, accepted: true, query };
  });
  if (assessed.some((item) => !item.accepted)) {
    return {
      content: [{ type: 'text', text: JSON.stringify({
        accepted: false,
        results: assessed.map(({ index, accepted, diagnostics }) => ({
          index, valid: accepted,
          ...(diagnostics === undefined ? {} : { diagnostics }),
        })),
      }) }],
      isError: true,
    };
  }
  const receipt = randomUUID();
  writeFileSync(join(outputDir, `${receipt}.json`), JSON.stringify({
    items: assessed.map(({ index, query }) => ({ intent: intents[index], query })),
  }), { flag: 'wx', mode: 0o600 });
  return {
    content: [{ type: 'text', text: JSON.stringify({
      accepted: true, receipt, count: intents.length,
    }) }],
    isError: false,
  };
}
