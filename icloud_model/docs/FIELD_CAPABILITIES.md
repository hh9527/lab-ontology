# Source-field query capabilities

The source metadata establishes physical encoding and business descriptions.
The Model chooses query capabilities; indexes and costs do not change the
meaning of an operator. This policy is not an authorization or access-control
system. Existing visibility, relations, identities, grains and time encodings
are preserved.

## Reviewed families

`scripts/icloud_capabilities.py` records the reviewed source vocabulary and is
shared by schema refresh, reconciliation and compiled-model audit. Source type,
enum declarations, timestamp roles and primary-key markers take precedence over
text-search families. New/unclassified strings remain exact-only for review.

| Family | Offered operations | Interpretation |
| --- | --- | --- |
| Names, aliases, descriptions and locations | Eq, Ne, Contains, NotContains, StartsWith, EndsWith | Search the displayed/stored text |
| Versions, SNs, asset numbers, part numbers | Same text operations | Representation matching, not version ordering or identifier normalization |
| Open product/model/vendor text | Same text operations | No closed vendor or category vocabulary is invented |
| MAC/WWN and raw address representations | Same text operations | Literal representation matching, not address arithmetic |
| Numeric fields | Eq, Ne, Gt, Ge, Lt, Le | Numeric comparison, never text matching |
| Declared canonical values | Existing Eq/Ne domain capabilities | Canonical IDs and physical wires remain separate |
| Identity/reference keys and unclassified strings | Existing exact-only capability | No blanket wildcard grant |
| Clocks and strings representing numbers | Existing typed/explicit capability | No implicit text search or invented encoding |

Eq/Ne compare exact stored text. Text pattern operations fold ASCII A-Z only
and treat `%`, `_` and quotes literally; they are not SQL LIKE patterns. NULL
matches neither a positive text predicate nor its negative complement. Text
search does not promise indexed execution. PostgreSQL renders the same ASCII
folding explicitly; locale-dependent case folding is not silently substituted.
Every public dimension reports its actual ops and links the shared filter
contract. A rejected Contains is not permission to substitute StartsWith.

## Raw address and explicit IPv4 view

The sources do not guarantee that every address column is canonical IPv4.
Raw address dimensions remain Text; Contains means a literal substring, not a
subnet. For example `device_ip_address` Contains `10.4` and subnet membership
in `10.4.0.0/16` are different requests.

Address columns additionally expose named computed IPv4 dimensions, such as
`device_ip_address_ipv4`. The explicit `canonical_ipv4_view` conversion retains
only canonical four-octet addresses (0..255, no leading zeros); IPv6, NULL,
malformed strings and alternate representations produce NULL. No source row is
silently normalized or retyped, and the raw dimension remains available.
IPv6-only fields and subnet-mask fields do not get an IPv4 address view.

The view offers Eq/Ne and InSubnet/NotInSubnet for /0..32. A network must have
zero host bits. NotInSubnet is the complement **within valid IPv4 values**;
it does not include IPv6 or unrecognized source values. /0 therefore selects
every valid IPv4 value, not every raw source row. Projection may return NULL;
distinct value counts ignore NULL. Knowledge descriptions publish these facts.

The view is a deterministic row-local scalar expression, not a join or a row
expansion. It can be filtered, projected, grouped and counted as distinct values
without inventing an identity. Existing graph fanout/grain and scope restrictions
still apply. Equalities on different computed dimensions sharing one column are
not automatically contradictory.

Validation on raw strings has a cost: the computed view does not promise source
index access. The direct logical_type(Ipv4) route remains appropriate when a
domain can establish canonical storage; it can use binary prefix range indexes
as described in [logical types](../../ontology/docs/LOGICAL-TYPES.md).
SQLite executors must register the documented regexp function; PostgreSQL has
native support. The normalization guard uses the common regex subset, including
negated character classes to reject final newlines consistently across engines.

## Whole-model gate

Export the prepared model and audit source provenance plus all declared capabilities:

```sh
bin/telora -C icloud_model eval @src/source_audit:report --initialization-fuel 100000 --request-fuel 100000 --with-memory-limit 1024 > /tmp/icloud-prepared.json
python3 scripts/audit-icloud-model.py /tmp/icloud-prepared.json --metadata ../imaster-cloud/.compact/metadata
python3 -m unittest discover -s scripts/tests
bin/telora -C icloud_model test capabilities --initialization-fuel 100000 --request-fuel 500000 --with-memory-limit 1024
```

The audit covers all 48 source tables and 822 source fields, including duplicate
business carriers. It verifies every searchable dimension and explicit IPv4
view, numeric operator completeness, and the absence of text-search leakage into
canonical values, identities and clocks. Representative SQL tests cover all six
text operations, literal parameter binding and rejected semantic substitutions.

Refresh emits reviewable patches through `refresh-icloud-schema.py`; existing
declarations are reconciled through `reconcile-icloud-capabilities.py`. Both use
the same policy. New semantic categories require review, not suffix-based logical
type inference. Manufacturing date formats, string-encoded quantities and IPv6
arithmetic are not invented by this field-search policy.
