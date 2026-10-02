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

Ipv4 defines Eq and Ne over addresses. The example field offers only Eq;
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

This is not general IpAddress support: IPv6, subnet membership, native inet
storage and address ordering require their own semantics and backend plans.
They are not approximated by text search. Existing iCloud IP columns remain
unchanged until their representation and desired operations are established.
Automatic type inference from field names is deliberately absent.
