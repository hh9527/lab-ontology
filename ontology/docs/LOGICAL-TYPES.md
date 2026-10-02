# Logical types and field capabilities

Three facts are distinct:

1. Physical storage encodes values, e.g. String or Int.
2. A logical type defines the value domain and meaning of operations.
3. A dimension's filterable/ops declaration selects the capabilities offered
   for this particular field. It may narrow type operations, never invent them.

Indexes, storage and query costs can motivate a field capability restriction.
The current API does not inspect database indexes or infer permissions from
them. An Eq-only Text dimension is not evidence that Contains lacks a meaning
for Text. Conversely, String storage does not give every logical type Text
operations. The existing time declarations distinguish Rfc3339, Utc1, Date,
LocalDateTime and EpochMillis under the same principle.

## IPv4 acceptance slice

```telora
@edsl::column("ip")
@edsl::logical_type(edsl::LogicalType::Ipv4)
@edsl::dimension("address", True, True,
    [edsl::FilterOp::Eq], [edsl::FilterInputKind::Ipv4])
ip: Option(String),
```

The Model promises canonical dotted-decimal storage: exactly four octets in
0..255, no leading zeros, whitespace, port, CIDR suffix or alternate notation.
Option(String) allows SQL NULL, which is missing rather than an address.
Preparation validates the declaration but does not scan the database to prove
its encoding. Do not apply this annotation to unknown-format source columns.

Ipv4 defines Eq and Ne over addresses, plus restricted InSubnet and
NotInSubnet over networks. The example field offers only Eq;
declaring Ne would also be legal. Contains, StartsWith, EndsWith, lexical
ordering and Min/Max are not IPv4 operations. Count remains available when
independently declared. Relations cannot equate Ipv4 to ordinary Text merely
because both are stored as String. Scope and union predicates retain typed
inputs. No implicit conversion to a text view is provided.

Intent still uses an ordinary JSON string, without kind:

```json
{"node":"host","dimension":"address","op":"Eq","value":"192.0.2.1"}
```

The Model selects Ipv4, validates the value and emits a bound String parameter.
SQLite and PostgreSQL need no IP parsing for this limited canonical encoding.
Typed callers use FilterInput::Ipv4, not FilterInput::Text. Field knowledge
publishes the explicit logical_type; dimension knowledge publishes Ipv4 input
documentation and the actual field ops. Field links lead to the common
logical-types knowledge contract.

This is not general IpAddress support: IPv6, native inet
storage and address ordering require their own semantics and backend plans.
They are not approximated by text search. Existing iCloud IP columns remain
unchanged until their representation and desired operations are established.
Automatic type inference from field names is deliberately absent.

## Restricted subnet operations

A field may declare InSubnet and/or NotInSubnet in ops. Intent passes a
canonical CIDR String without kind, e.g. `"10.4.0.0/16"`. The operator selects
a network argument; Eq/Ne still require a single address. Typed callers use
FilterInput::Ipv4Subnet. any_of continues to enumerate addresses, not networks.

Every integer mask /0..32 is supported. Network host bits must be zero;
`10.4.2.3/16` is rejected, not normalized. No IPv6 or alternate mask notation
is accepted. The same canonical dotted-decimal storage contract is required.

Complete octets form a binary text range: prefix `10.4.` becomes
`address >= bound("10.4.") AND address < bound("10.4/")`. This excludes
`10.40.0.1`. SQLite applies COLLATE BINARY; PostgreSQL applies COLLATE "C".
Partial octets add a generated bound regex, e.g. /20 enumerates the 16 valid
values of the third octet. /1..7 require only regex, without a prefix prefilter.
Generated patterns use the common subset: anchors, groups, decimal alternatives,
`[.]` and `[0-9]{1,3}`. They are not caller-supplied SQL or regex fragments.
All boundaries and patterns are bindings allocated by the immutable context.

/32 uses bound address equality; /0 uses address self-equality. NotInSubnet
negates the entire membership condition, not just the regex or prefix. NULL
matches neither operation. No native inet support or SQL reverse parsing is used.

PostgreSQL supports regex natively. SQLite execution connections must register
`regexp(pattern, value)`, returning NULL when either argument is NULL and 1/0
otherwise. The sqlite3 command-line implementation alone does not establish
this capability for Python or Node library connections. For Node's node:sqlite:

```js
db.function('regexp', { deterministic: true }, (pattern, value) => {
  if (pattern === null || value === null) return null;
  return new RegExp(pattern).test(value) ? 1 : 0;
});
```

The range makes index access possible, not mandatory: its index must use the
same collation (BINARY in SQLite, "C" in PostgreSQL). Database statistics and
the optimizer still decide the plan; negative membership may not benefit.

Preparation probes each distinct lowering shape and rejects insufficient scalar
profiles: Eq/Ne, Ge/Lt, BinaryText, And, RegexMatch and Not as applicable.
Discovery links the logical-type and filter contracts to the subnet contract.

Run the focused execution check from the repository root (Node with node:sqlite):

```sh
bin/telora -C ontology eval @test/subnets:runtime_cases --request-fuel 10000 | node ontology/tests/subnets-runtime.mjs
```

This executes the generated queries across all masks and address boundaries,
checks both complements and NULL, and verifies index range access for /16 and /20.
