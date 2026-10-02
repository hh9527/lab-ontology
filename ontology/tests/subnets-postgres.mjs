import { readFileSync } from 'node:fs';

// Emit one rollback-only PostgreSQL batch; SQL templates are Telora exports.
// Fixture parameters go through EXECUTE ... USING, never substituted into templates.
const { cases, views } = JSON.parse(readFileSync(process.argv[2] ?? 0, 'utf8'));
const number = (ip) => ip.split('.').reduce((n, octet) => n * 256 + Number(octet), 0);
const address = (n) => [24, 16, 8, 0].map((bits) => Math.floor(n / 2 ** bits) % 256).join('.');
const samples = new Set(['10.4.2.3', '10.40.0.1', '10.4.15.255', '10.4.16.0',
  '10.4.31.255', '10.4.32.0', '10.4.2.127', '10.4.2.128', '10.4.2.255',
  '127.255.255.255', '128.0.0.0', '255.255.255.255']);
for (const { network } of cases) {
  const [base, mask] = network.split('/');
  const lower = number(base);
  const width = 2 ** (32 - Number(mask));
  for (const n of [lower - 1, lower, lower + 1, lower + width - 1, lower + width]) {
    if (n >= 0 && n < 2 ** 32) samples.add(address(n));
  }
}
const literal = (v) => v === null ? 'NULL::text' : `'${String(v).replaceAll("'", "''")}'::text`;
console.log('BEGIN; SET LOCAL standard_conforming_strings = on; CREATE TEMP TABLE hosts(ip text, raw text) ON COMMIT DROP;');
console.log(`INSERT INTO hosts VALUES ${[...samples].map((ip) => `(${literal(ip)}, ${literal(ip)})`).join(',')}, (NULL, 'missing');`);
let tested = 0;
function check(query, expected, label) {
  const bindings = query.bindings.length ? ` USING ${query.bindings.map(literal).join(', ')}` : '';
  console.log(`DO $check$
DECLARE r record; actual text[] := ARRAY[]::text[]; expected text[] := ARRAY[${expected.map(literal).join(', ')}]::text[];
BEGIN
  FOR r IN EXECUTE ${literal(query.sql)}${bindings} LOOP
    actual := array_append(actual, (SELECT value FROM jsonb_each_text(to_jsonb(r)) LIMIT 1));
  END LOOP;
  SELECT array_agg(v ORDER BY v COLLATE "C" NULLS FIRST) INTO actual FROM unnest(actual) AS v;
  SELECT array_agg(v ORDER BY v COLLATE "C" NULLS FIRST) INTO expected FROM unnest(expected) AS v;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '%: actual %, expected %', ${literal(label)}, actual, expected;
  END IF;
END $check$;`);
  tested += 1;
}
for (const { network, queries } of cases) {
  const [base, mask] = network.split('/');
  const lower = number(base);
  const upper = lower + 2 ** (32 - Number(mask));
  for (const [index, query] of queries.entries()) {
    check(query, [...samples].filter((ip) => {
      const inside = number(ip) >= lower && number(ip) < upper;
      return index === 0 ? inside : !inside;
    }), `${network} ${index === 0 ? 'InSubnet' : 'NotInSubnet'}`);
  }
}
const invalid = ['010.4.16.1', '2001:db8::1', '10.4.256.1', '10.4.16.1:80',
  '10.4.16.1 ', '10.4.16.1\n', '10.4.16.1\r\n', '10.4.16.1\u2028', 'garbage', ''];
console.log(`INSERT INTO hosts VALUES ${invalid.map((ip) => `(${literal(ip)}, ${literal(ip)})`).join(',')};`);
check(views[0], [...samples, ...Array(invalid.length + 1).fill(null)], 'mixed projection');
for (const [index, complement] of [false, true].entries()) {
  check(views[index + 1], [...samples].filter((ip) => {
    const inside = number(ip) >= number('10.4.16.0') && number(ip) < number('10.4.32.0');
    return complement ? !inside : inside;
  }), 'mixed subnet/complement');
}
check(views[3], [...samples], 'mixed /0');
check(views[4], [], 'mixed not /0');
check(views[5], [samples.size], 'mixed distinct count');
console.log(`SELECT 'Passed ${tested} generated PostgreSQL queries with bound parameters'; ROLLBACK;`);
