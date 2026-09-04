# Spider development subset

This directory is a deterministic subset of the Spider 1.0 data archive.

- Source repository: https://github.com/taoyds/spider
- Source archive Google Drive id: `1403EGqzIDoHMdQF4c9Bkyl7dZLZ5Wt6J`
- Source archive SHA-256: `00636695dabed6b5f4b8328a16b13e069a2f16591d5efcce57660669c85b121b`
- Included split: development
- Included examples: 972
- Included databases: 19
- Excluded development database: `wta_1`

`wta_1` was excluded because its SQLite file alone is about 100 MiB. The
remaining files stay aligned: `dev.json` and `dev_gold.sql` both contain 972
entries, `tables.json` contains exactly the 19 referenced schemas, and
`database/` contains their corresponding SQLite databases.

The upstream data README is preserved as `README.upstream.txt`.

## `concert_singer` pilot split

The first Labflow experiment uses only `concert_singer`. Run
`scripts/prepare-spider-pilot.pl .` from the repository root to reproduce:

- `modeling/concert_singer.schema.json`
- `modeling/concert_singer.examples.jsonl` (24 cases, 14 SQL groups)
- `eval/suite-1.jsonl` (21 cases, 11 SQL groups)

Cases are grouped by lower-cased, whitespace-normalized gold SQL. Each complete
group is assigned by a SHA-256-derived 3/5 modeling, 2/5 evaluation partition,
so paraphrases of the same query cannot cross the boundary. Gold SQL is `R` in
both files. Labflow keeps evaluation `R` internal; the benchmark respondent
receives `Q` and the null `K`, but not `R`.
