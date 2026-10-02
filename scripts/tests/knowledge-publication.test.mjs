import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
test('real snapshot publication preserves previous artifacts on oversized model change', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'ontology-publication-'));
  try {
    cpSync(join(root, 'scripts/tests/fixtures/publication/foo'), join(workspace, 'publication_fixture'), { recursive: true });
    cpSync(join(root, 'ontology/src'), join(workspace, 'ontology/src'), { recursive: true });
    cpSync(join(root, 'ontology/telora-crate.json'), join(workspace, 'ontology/telora-crate.json'));
    writeFileSync(join(workspace, 'telora-config.json'), JSON.stringify({version: 1, members: ['publication_fixture', 'ontology']}));
    const lock = spawnSync(join(root, 'bin/telora'), ['-C', workspace, 'lock'], {encoding: 'utf8'});
    assert.equal(lock.status, 0, lock.stdout + lock.stderr);
    const artifact = join(workspace, 'foo.wasm');
    const probes = join(workspace, 'hidden.json');
    writeFileSync(probes, JSON.stringify([{domain: 'foo', key: 'Dimension/foo/private'}, {domain: 'foo', key: 'Field/foo/private'}]));
    const build = (...extra) => spawnSync(process.execPath, ['scripts/build-knowledge-snapshot.mjs',
      '--context', join(workspace, 'publication_fixture'), '--module', 'publication_fixture', '--domain', 'foo', '--output', artifact,
      '--not-found', probes, ...extra], { cwd: root, encoding: 'utf8' });
    const first = build('--max-node-chars', '32000');
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const files = [artifact, `${artifact}.knowledge.json`, `${artifact}.knowledge-sizes.json`];
    const before = files.map(file => readFileSync(file));
    const report = JSON.parse(before[2]);
    const threshold = report.domains[0].node_sizes[0].chars;
    assert.equal(report.domains[0].node_sizes[0].type, 'Dataset', first.stdout);
    const source = join(workspace, 'publication_fixture/src/lib.telora');
    writeFileSync(source, readFileSync(source, 'utf8').replace('"foo-v1"', '"foo-v2"').replace('    private: String,',
      '    private: String,\n    @edsl::column("new_field") @edsl::dimension("new_field", True, True, [edsl::FilterOp::Eq], [edsl::FilterInputKind::Text]) @edsl::field_role(edsl::FieldRole::Appellation) new_field: String,'));
    const rejected = build('--max-node-chars', String(threshold));
    assert.notEqual(rejected.status, 0, rejected.stdout + rejected.stderr);
    assert.match(rejected.stderr, /exceeds max-node-chars/);
    files.forEach((file, i) => assert.deepEqual(readFileSync(file), before[i]));
    const warning = build('--max-node-chars', String(threshold), '--on-oversize', 'warn');
    assert.equal(warning.status, 0, warning.stdout + warning.stderr);
    assert.equal(JSON.parse(readFileSync(files[2])).status, 'warning');
    assert.equal(JSON.parse(readFileSync(files[1])).domains[0].revision, 'foo-v2');
    const checked = spawnSync(process.execPath, ['scripts/check-knowledge-manifest.mjs', artifact, '--not-found', probes], {cwd: root, encoding: 'utf8'});
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  } finally {
    rmSync(workspace, {recursive: true, force: true});
  }
});
