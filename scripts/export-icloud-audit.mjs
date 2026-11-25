import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/export-icloud-audit.mjs <output.json>');
const temporaryRoot = process.env.TMPDIR || join(homedir(), '.cache/tmp');
mkdirSync(temporaryRoot, { recursive: true });
const temporary = mkdtempSync(join(temporaryRoot, 'ic-source-audit-'));
try {
  for (const name of ['ontology', 'icloud_model']) {
    cpSync(join(root, name, 'src'), join(temporary, name, 'src'), { recursive: true });
    cpSync(join(root, name, 'telora-crate.json'), join(temporary, name, 'telora-crate.json'));
  }
  // 审计仅加载声明，不初始化服务的 build::stage 入口。
  writeFileSync(join(temporary, 'icloud_model/src/lib.telora'), 'pub mod typed;\n');
  writeFileSync(join(temporary, 'telora-config.json'), JSON.stringify({ version: 1, members: ['ontology', 'icloud_model'] }));
  const lock = JSON.parse(readFileSync(join(root, 'telora-lock.json')));
  lock.packages = Object.fromEntries(Object.entries(lock.packages).filter(([name]) => ['ontology', 'icloud_model'].includes(name)));
  writeFileSync(join(temporary, 'telora-lock.json'), JSON.stringify(lock));
  const result = spawnSync(process.env.TELORA_BIN || join(root, 'bin/telora'), ['-C', join(temporary, 'icloud_model'), 'eval', '@src/source_audit:report',
    '--initialization-fuel', '400000', '--request-fuel', '100000', '--with-memory-limit', '2048'],
  { encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  writeFileSync(resolve(output), JSON.stringify(report, null, 2) + '\n');
  console.log(`Exported ${report.datasets.length} datasets and ${report.relations.length} relations`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
