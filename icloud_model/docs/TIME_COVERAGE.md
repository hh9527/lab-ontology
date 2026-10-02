# Time coverage decisions

This is author-facing audit material. Runtime knowledge publishes the current
Model contract, not requests for an Agent to confirm modeling assumptions.

## Declarations

- Source `datetime` stored as String uses Utc1: UTC `YYYY-MM-DD HH:MM:SS`.
  This is the agreed modeling convention, not a discovered storage fact.
- Source `dte.time.format.pattern=YYYY-MM-DD` establishes Date. This covers
  backup-power and power-supply manufacturing dates, and the PON manufacture
  date shared by its three model roles.
- Integer clocks use the existing EpochMillis convention. Every declaration
  without source evidence for that unit has a source TODO for confirmation;
  tests guard this. Merely calling an integer a clock does not establish its unit.
- Clock declarations do not add sample grains, uniqueness, fixed collection
  intervals, timezone conversion, aggregation semantics or database clock reads.
- The SSID collection clock now authorizes Ge/Lt as well as Eq, allowing a window.
- Alarm reception (`ARRIVEUTC`) and NE-local occurrence (`OCCURTIME`) remain
  auxiliary encodings without authorized window dimensions. The published event
  window uses occurrence UTC. They have explicit RoleOnly dispositions in the
  audit, not an inference that those times do not exist.

## Reproduce

```sh
bin/telora -C icloud_model eval @src/source_audit:report \
  --initialization-fuel 100000 --request-fuel 100000 --with-memory-limit 1024 \
  > /tmp/icloud-prepared.json
python3 scripts/audit-icloud-time.py /tmp/icloud-prepared.json
python3 -m unittest discover -s scripts/tests
bin/telora -C icloud_model test time_coverage \
  --initialization-fuel 100000 --request-fuel 100000 --with-memory-limit 2048
```

`data/time_coverage.json` records every visible dataset, including datasets with
no temporal columns. For each clock it reports the declared role, published role,
logical input, authorized operators, window disposition, and evidence/confirmation
status. Undeclared source times and unreviewed exclusions fail the audit.
The source catalog and the compiled Prepared Model are compared; the report
does not infer a runtime logical type from a field name or physical SQL type.

Knowledge traversal is field/dimension -> DataType -> operation. TimeWindow
is a shared operation contract for all supported temporal types; `[start,end)`
and a null/omitted upper bound are not the `half_open` canonical-value feature.
Day/week/month bounds are resolved outside the service, then bound unchanged.
