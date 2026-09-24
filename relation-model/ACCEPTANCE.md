# Relation-first acceptance slice

This model is a pressure fixture, not a complete network inventory. All IDs
are tenant-scoped: a connection endpoint matches a device only when both the
device ID and tenant ID agree. A/Z denote stored endpoint positions, not
business direction. Neither a symmetric nor a directed peer relation has yet
been declared; the ontology must not infer either from the two endpoint keys.

The following cases specify the intended relation-based Intent contract. They
are acceptance targets, not currently supported Intent syntax. Each positive
case must lower to a QueryAst; each negative case must fail before QueryAst
construction with a diagnostic identifying the edge, role, or missing proof.

| Positive intent | Negative neighbor / required diagnosis |
| --- | --- |
| From a connection, bind `connection_a` to device `a` and `connection_z` to device `z`; project both device IDs. | Bind `connection_a` to a Site instance: invalid target type and edge ID. |
| From a device, find connections where it occupies A using the reverse of `connection_a`; independently find connections where it occupies Z using `connection_z`. | Treat A and Z as interchangeable roles without a declared symmetric peer relation: missing business relation proof. |
| From device `d`, follow `device_site` to site `s`, then `site_tenant` to tenant `t`; test existence without changing the grain of `d`. | Follow `device_site` to a tenant instance: invalid target type at that edge. |
| From device `d`, test existence of a connection via the reverse of `connection_a` and project/count devices at the explicit `d` grain. | Join all matching connections and count rows as devices: grain amplification, require an explicit count subject. |
| A connection endpoint and its Device share `tenant_id` as well as device ID. | Join only on device ID while omitting tenant ID: incomplete declared identity key. |
| Once a symmetric device-peer relation is declared, traverse either endpoint with the same meaning. | Before it is declared, infer symmetry solely from A/Z endpoints: missing symmetry proof. |
| Once a directed device-peer relation is declared, traverse its declared source-to-target direction. | Traverse it backwards without an inverse declaration: direction violation. |

An otherwise valid but unimplemented composition must report `unsupported`
separately from invalid model semantics. The current Model only establishes
the endpoint and tenant identity facts; symmetric/directed peer semantics are
explicitly pending ontology vocabulary and must not pass prematurely.
