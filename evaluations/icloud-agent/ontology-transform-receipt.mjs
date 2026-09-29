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
      !Array.isArray(batch.diagnostics) ||
      batch.diagnostics.some((item) => !Number.isInteger(item?.index) ||
        item.index < 0 || item.index >= intents.length ||
        typeof item.diagnostic?.message !== 'string' ||
        !['Error', 'Warning', 'Info'].includes(item.diagnostic?.severity))) {
    throw new Error('ontology service returned an invalid transform response');
  }
  const hasErrors = batch.diagnostics.some((item) => item.diagnostic.severity === 'Error');
  if (batch.accepted === hasErrors) {
    throw new Error('ontology service returned an invalid transform response');
  }
  if (!batch.accepted) {
    if (batch.queries !== null) {
      throw new Error('ontology service returned an invalid transform response');
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({
        accepted: false,
        diagnostics: batch.diagnostics,
      }) }],
      isError: true,
    };
  }
  if (!Array.isArray(batch.queries) || batch.queries.length !== intents.length ||
      batch.queries.some((query) => typeof query?.sql !== 'string' ||
        !Array.isArray(query.bindings))) {
    throw new Error('ontology service returned an invalid transform response');
  }
  const receipt = randomUUID();
  writeFileSync(join(outputDir, `${receipt}.json`), JSON.stringify({
    diagnostics: batch.diagnostics,
    items: batch.queries.map((query, index) => ({ intent: intents[index], query })),
  }), { flag: 'wx', mode: 0o600 });
  return {
    content: [{ type: 'text', text: JSON.stringify({
      accepted: true, receipt, count: intents.length,
      diagnostics: batch.diagnostics,
    }) }],
    isError: false,
  };
}
