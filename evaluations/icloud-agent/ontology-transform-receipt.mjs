import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function transformResults(response, intents, outputDir) {
  if (response?.error === true && Array.isArray(response.diagnostics)) {
    return {
      content: [{ type: 'text', text: JSON.stringify({
        accepted: false, diagnostics: response.diagnostics,
      }) }],
      isError: true,
    };
  }
  const batch = response?.ok;
  if (response?.error !== false || typeof batch?.accepted !== 'boolean' ||
      !Array.isArray(batch.results) || batch.results.length !== intents.length ||
      batch.results.some((item, index) => item?.index !== index ||
        typeof item.valid !== 'boolean' || !Array.isArray(item.diagnostics))) {
    throw new Error('ontology service returned an invalid transform response');
  }
  if (!batch.accepted) {
    if (batch.queries !== null || batch.results.every((item) => item.valid)) {
      throw new Error('ontology service returned an invalid transform response');
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({
        accepted: false,
        results: batch.results,
      }) }],
      isError: true,
    };
  }
  if (!batch.results.every((item) => item.valid) ||
      !Array.isArray(batch.queries) || batch.queries.length !== intents.length ||
      batch.queries.some((query) => typeof query?.sql !== 'string' ||
        !Array.isArray(query.bindings))) {
    throw new Error('ontology service returned an invalid transform response');
  }
  const receipt = randomUUID();
  writeFileSync(join(outputDir, `${receipt}.json`), JSON.stringify({
    items: batch.queries.map((query, index) => ({ intent: intents[index], query })),
  }), { flag: 'wx', mode: 0o600 });
  return {
    content: [{ type: 'text', text: JSON.stringify({
      accepted: true, receipt, count: intents.length,
    }) }],
    isError: false,
  };
}
