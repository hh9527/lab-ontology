# Relation-first acceptance slice

This model is a pressure fixture, not a complete network inventory. All IDs
are tenant-scoped: a connection endpoint matches a device only when both the
device ID and tenant ID agree. A/Z denote stored endpoint positions, not
business direction. `connected_device` explicitly declares undirected business
connectivity over the two endpoint relations, while `upstream_device` declares
a directed A-to-Z relation on a separate route dataset. No peer semantics are
inferred from endpoint field names alone.
`connection_endpoint` separately declares the physical alternative: a device
participates when its tenant-scoped identity matches the A or Z endpoint.
This does not imply a device-to-device business connection.

The following cases specify the intended relation-based Intent contract. The
`graph` row-query shape now supports rooted, explicitly named instance trees,
projection of authorized plain dimensions, forward and reverse navigation of
declared edges, and ordered correlated existence/absence paths of arbitrary
length. It
also accepts `count: "<root instance>"` instead of `select` when every outer
JOIN follows a forward Safe edge; otherwise counting the root requires EXISTS
so that matching children cannot multiply its rows. It counts the root key
without reducing a composite grain to one guessed DISTINCT column. It
also supports grouping by root dimensions while counting a non-root child
when every edge in the outer join tree is functional when traversed from that
child. Grouping dimensions may name any declared graph instance because the
same proof prevents joins from duplicating the counted subject. Reverse Safe chains and forward FanOut edges whose keys cover the
complete parent identity provide this proof, including multi-hop paths.
Matching only a shared tenant does not prove site identity, so counting
same-tenant devices as children of a particular site is rejected. Branches
that can duplicate the counted child remain unproven and are rejected. By
default joins are inner; `include_empty: true` for non-root count subjects
uses LEFT JOINs to retain root groups with zero children. Root filters stay in
the outer WHERE; filters on nullable instances narrow their individual joined
sources rather than the outer WHERE, preserving empty root
groups. EXISTS anchored on the counted instance or its nullable ancestors
narrows that instance's LEFT JOIN ON condition; unrelated branches remain
unsupported. Business-link joins are not yet supported in this mode. A count uses a declared key, or a column of the dataset's
declared non-null identity grain when there is no single-column key. It never
uses a guessed DISTINCT key; entities without either identity declaration are
rejected. Identity fields in a single key or any position of a composite
dataset grain must be non-nullable, or the Model fails preparation before an
intent can count rows. It
rejects missing edges, role mismatches and disconnected nodes. Reverse
navigation reads the same edge from its other endpoint; it does
not establish any business-level peer direction or symmetry. Named business
links do: the Model specifies whether A/Z may be exchanged, and both roles
must cover the complete participant identity. Graph rows and single-edge
EXISTS can reference these links by their business ids; counting connected
devices uses EXISTS so that multiple link rows do not change device grain.
Graph filters name a particular entity instance and a declared dimension;
their values are bound rather than interpolated into SQL. In particular,
filtering an origin device and a peer device of the same type must use their
distinct allocated aliases inside the appropriate outer/EXISTS scopes.
An EXISTS can branch from its root or any previously connected instance, and
can follow an undirected/directed business link first, then continue along
ordinary named relations or more declared business links. It can also follow a
business link after a physical edge, retaining the original root correlation
and checking business direction at every step. Unconnected edges and incorrect
endpoint roles remain invalid.
The graph Intent is closed at every level: unknown request, node, edge,
projection, filter or existence fields are rejected as unsupported, never
ignored when they could narrow the intended result.
`tests/graph.telora`
exercises these cases against QueryAst and both SQL materializers.

These pairs are the implemented minimal-model acceptance cases. Each positive
case must lower to a QueryAst; each negative case must fail before QueryAst
construction with a diagnostic identifying the edge, role, or missing proof.

| Positive intent | Negative neighbor / required diagnosis |
| --- | --- |
| From a connection, bind `connection_a` to device `a` and `connection_z` to device `z`; project both device IDs. | Bind `connection_a` to a Site instance: invalid target type and edge ID. |
| From a device, find connections where it occupies A using the reverse of `connection_a`; independently find connections where it occupies Z using `connection_z`. | Treat A and Z as interchangeable roles without a declared symmetric peer relation: missing business relation proof. |
| From device `d`, follow `device_site` to site `s`, then `site_tenant` to tenant `t`; test existence without changing the grain of `d`. | Follow `device_site` to a tenant instance: invalid target type at that edge. |
| From device `d`, test existence of a connection via the reverse of `connection_a` and project/count devices at the explicit `d` grain. | Join all matching connections and count rows as devices: grain amplification, require an explicit count subject. |
| A connection endpoint and its Device share `tenant_id` as well as device ID. | Join only on device ID while omitting tenant ID: incomplete declared identity key. |
| Check existence through `connection_endpoint`, matching A or Z with complete tenant identity, and continue along another named edge. | Connect the same edge to Site instead of Device: invalid relation endpoint role. |
| Traverse the declared symmetric `connected_device` relation from either endpoint. | Infer symmetry solely from A/Z endpoint declarations: missing business link proof. |
| Traverse the declared directed `upstream_device` relation from A to Z. | Traverse Z to A without an inverse declaration: direction violation. |

An otherwise valid but unimplemented composition must report `unsupported`
separately from invalid model semantics. The Model explicitly establishes
endpoint identities and symmetric/directed peer semantics; unrelated-branch
EXISTS under empty-group counting and business-link outer joins remain
pending.
