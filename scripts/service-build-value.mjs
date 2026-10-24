// 实验协议：构建期 Service 返回 Bool，host 从 Wasm 自定义段恢复初始化输入。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const sectionName = 'experiment.service-build-value';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function modelPrefix(code) {
  return code.split('type QueryService =')[0]
    .replace('use std::codec as codec;\n', '')
    .replace('@service::source("verified")\n', '');
}
function leb(value) {
  const bytes = [];
  do { const next = value % 128; value = Math.floor(value / 128); bytes.push(next | (value ? 128 : 0)); } while (value);
  return Buffer.from(bytes);
}
function readLeb(bytes, cursor) {
  let value = 0, shift = 0;
  for (let i = 0; i < 5; i++) {
    assert(cursor.offset < bytes.length, 'truncated Wasm section size');
    const byte = bytes[cursor.offset++];
    value += (byte & 127) * 2 ** shift;
    if (!(byte & 128)) { assert(value <= 0xffffffff); return value; }
    shift += 7;
  }
  throw new Error('invalid Wasm section size');
}
export function appendBuildValue(wasm, metadata) {
  const name = Buffer.from(sectionName);
  const payload = Buffer.concat([leb(name.length), name, Buffer.from(JSON.stringify(metadata))]);
  return Buffer.concat([wasm, Buffer.from([0]), leb(payload.length), payload]);
}
export function readBuildValue(wasm) {
  assert(wasm.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])), 'expected core Wasm');
  const cursor = { offset: 8 };
  let metadata, baseEnd;
  while (cursor.offset < wasm.length) {
    const start = cursor.offset, id = wasm[cursor.offset++];
    const size = readLeb(wasm, cursor), end = cursor.offset + size;
    assert(end <= wasm.length, 'truncated Wasm section');
    if (id === 0) {
      const section = { offset: cursor.offset }, length = readLeb(wasm, section);
      assert(section.offset + length <= end, 'invalid custom section name');
      const name = wasm.subarray(section.offset, section.offset + length).toString('utf8');
      if (name === sectionName) {
        assert(!metadata && end === wasm.length, 'build value must occur once, as final section');
        assert(end - section.offset - length <= 65536, 'build value exceeds size limit');
        metadata = JSON.parse(wasm.subarray(section.offset + length, end).toString('utf8'));
        baseEnd = start;
      }
    }
    cursor.offset = end;
  }
  assert(metadata, 'missing Service build value');
  assert.equal(metadata.schema, 'experiment.service-build-value/v1');
  assert.equal(metadata.type, 'Bool');
  assert.equal(metadata.value, true, 'build verification must be true');
  for (const name of ['runtimeHash', 'verifiedArtifactHash', 'modelSourceHash', 'dependencySourceHash', 'compilerHash']) {
    assert.match(metadata[name], /^[a-f0-9]{64}$/, `invalid ${name}`);
  }
  assert.equal(metadata.runtimeHash, sha256(wasm.subarray(0, baseEnd)), 'build value belongs to another runtime');
  return metadata;
}
