# Field roles and object references

Tracked in issue #33. These declarations expose business use to Agents and
future report planning. They do not add query operations, automatically
generate links, resolve objects, or choose a default identity display.

## Declaration

```telora
@edsl::reference("local", ["tenant_id", "device_id"])
@edsl::reference("global", ["uuid"])
type Device = struct {
    tenant_id: String,
    device_id: String,
    @edsl::field_role(edsl::FieldRole::Appellation)
    uuid: String,
    @edsl::field_role(edsl::FieldRole::Appellation)
    name: String,
    @edsl::field_role(edsl::FieldRole::Classification)
    category: String,
    @edsl::field_role(edsl::FieldRole::Metric)
    cpu_usage: Float,
};
```

This example shows semantic declarations only. A complete queryable type
also needs its usual source, column and capability annotations.

| Role | Meaning | Does not imply |
| --- | --- | --- |
| Appellation | Participates in identity display/expression | Uniqueness, default display or a display template |
| Reference | Participates in a declared unique address | That one member of a composite address is sufficient |
| Classification | Describes a business category | A closed value domain or filter capability |
| Metric | Describes quantitative use | A unit, aggregation rule or queryable measure |

Roles may overlap: uuid above has Appellation and the derived Reference role.
No role is guessed from an attribute name. Formal `metric_value` declarations
also derive Metric; explicitly labeling the same field Metric does not
duplicate it. A numeric field or count measure does not automatically become
Metric. Formal metric metadata continues to define units and aggregation.

## Unique reference sets

Each named reference is a trusted claim that its complete tuple uniquely
determines one object within the declaring dataset/type. Members of one set
participate together; different sets are alternative addresses. A reference
is dataset-qualified: the same tuple in another dataset is a different address.

For two tenants both using device_id D001, (T1, D001) and (T2, D001) are
different local addresses. D001 alone is incomplete. A global uuid is a
separate address for the same object. Display names may repeat or change
without changing either address. Preparation does not inspect stored values
to prove uniqueness, and this API does not implement address resolution.

Reference ids and sets must be nonempty; ids are distinct per type; members
must exist and be distinct. Members may be `T` or `Option(T)`, where T is
a scalar or closed enum; nonscalar members fail preparation.
Equivalent sets with reordered members are duplicates. Declaration order is
preserved but does not assign priority. Direct field_role(Reference) fails:
membership must come from a complete type-level reference.

References do not change primary keys, grain, count identity, joins or query
authorization. Existing key/grain declarations are not implicitly converted
into references. A supplied address must contain all members and valid non-NULL
values; enforcing that input contract belongs to a future address consumer.

`Option(T)` expresses field nullability directly in the type system. A
reference with optional members is unique whenever all its members are
present; a missing member makes the whole address unavailable. NULL is not
an address value. Such a reference does not establish a total row identity:
nullable fields remain forbidden as primary keys or dataset grain members.
Types without a key or declared grain still support raw field queries and
relation traversal; object counts and identity grouping require an independently
declared total identity. Query preparation retains nullability while checking
operands against T, including joins between T and Option(T).

## Discovery

Dataset detail adds `references: [{id,fields}]` and
`field_roles: [{field,roles}]`. Field detail adds `roles`, `reference_ids`, and
`nullable`, derived from the model field's `Option(T)` type.
Members use model field names, not SQL columns or dimension ids. A model
field name is not query vocabulary: an Agent still needs an authorized
dimension or measure to retrieve its value.

Roles do not publish otherwise invisible fields. Public discovery filters
roles by existing visibility and publishes a reference only when all members
are visible. It never truncates a composite reference. Internal prepared
metadata retains all declarations. Dataset links lead to the shared
`syntax/model/field_roles` contract when roles/references are present.

## Acceptance

`tests/field_roles.telora` covers alternative complete references, overlapping
roles, public metadata, private fields, unchanged query semantics, metric
derivation and invalid declarations. The device model publishes its existing
unique id as a reference, name/alias as Appellation, and classification/vendor
as Classification. Existing formal metrics derive Metric automatically.
No uniqueness claim is added for names, IP addresses or serial numbers.
