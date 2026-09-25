# Dog Kennel Domain Model

This document is the resolver-facing description of the EnterpriseKnowledge model
implemented by `dog_model`.  It is written only in business vocabulary; physical
storage details (table names, column names, aliases, join paths, SQL text) are
private implementation details and are intentionally absent here.

## Purpose

The model exposes a closed vocabulary of *entities*, *measures*, and *dimensions*
for a dog kennel / veterinary practice.  A resolver expresses an analytic request
entirely in that vocabulary (see `INTENT.md`); the model deterministically lowers
every well-formed request to a single parameterized SQL query with bound values.
Requests may never contain SQL keywords, raw expressions, aliases, table or column
names, or join fragments.

## Entities and relationships

The domain has the following entities.  Each entity has a stable business identity.

| Entity | Meaning |
| --- | --- |
| `Breed` | Kennel-recognized dog breed. |
| `Charge` | Rate-card item describing a charge type and its standard amount. |
| `Size` | Kennel-recognized size class. |
| `TreatmentType` | Kind of veterinary treatment. |
| `Owner` | Dog owner / client. |
| `Dog` | Dog boarded or treated at the kennel. |
| `Professional` | Veterinary or kennel professional. |
| `Treatment` | A performed treatment of one dog by one professional. |

Relationships among entities are one-to-many and many-to-one:

- each dog is owned by one owner; an owner may own many dogs;
- each dog has one breed and one size class;
- each treatment is performed on one dog;
- each treatment is performed by one professional;
- each treatment is of one treatment type;
- each treatment belongs to a single professional/dog/type combination.

These relationships are used to (a) count dogs or treatments from the owning side,
(b) restrict base entities to those with or without related records, and
(c) project descriptive attributes across a safe (grain-preserving) path.

## Measures

Measures are countable / aggregable facts and always keep their natural grain.

| Measure | Grain entity | Meaning |
| --- | --- | --- |
| `DogCount` | Dog | Count of dogs. |
| `OwnerCount` | Owner | Count of owners. |
| `ProfessionalCount` | Professional | Count of professionals. |
| `TreatmentCount` | Treatment | Count of treatments. |
| `ChargeCount` | Charge | Count of rate-card items. |
| `MaxDogAge` | Dog | Oldest dog age (max of age). |
| `MinDogAge` | Dog | Youngest dog age (min of age). |
| `AvgDogAge` | Dog | Average dog age. |
| `MaxDogWeight` | Dog | Heaviest dog weight. |
| `MinDogWeight` | Dog | Lightest dog weight. |
| `AvgDogWeight` | Dog | Average dog weight. |
| `MaxChargeAmount` | Charge | Largest standard charge amount. |
| `MinChargeAmount` | Charge | Smallest standard charge amount. |
| `AvgChargeAmount` | Charge | Average standard charge amount. |
| `TotalTreatmentCost` | Treatment | Sum of treatment cost. |
| `AvgTreatmentCost` | Treatment | Average treatment cost. |
| `MinTreatmentCost` | Treatment | Cheapest treatment cost. |
| `MaxTreatmentCost` | Treatment | Most expensive treatment cost. |

Every scalar summary is computed over the restricted population: row filters and
related-existence constraints on the intent narrow the aggregate input rather than
being dropped.

## Dimensions

Dimensions are selectable, filterable, groupable, and orderable attributes.

### Dog dimensions

| Dimension | Type | Filter capability |
| --- | --- | --- |
| `DogName` | text | eq / text search |
| `DogAge` | integer | range + equality |
| `DogWeight` | number | equality |
| `DogGender` | text | equality |
| `AbandonedFlag` | integer (0/1) | equality |
| `DogBreedCode` | text | equality |
| `DogSizeCode` | text | equality |
| `DogOwnerId` | integer | equality |
| `DogDateOfBirth` | text (date) | equality / text search |
| `DogDateArrived` | text (date) | equality / text search |
| `DogDateAdopted` | text (date) | equality / text search |
| `DogDateDeparted` | text (date) | equality / text search |

### Owner dimensions

`OwnerId` (integer), `OwnerFirstName`, `OwnerLastName`, `OwnerEmailAddress`,
`OwnerCity`, `OwnerState`, `OwnerStreet`, `OwnerZipCode`, `OwnerHomePhone`,
`OwnerCellNumber` (all text).

### Professional dimensions

`ProfessionalId` (integer), `ProfessionalRole`, `ProfessionalFirstName`,
`ProfessionalLastName`, `ProfessionalEmailAddress`, `ProfessionalCity`,
`ProfessionalState`, `ProfessionalStreet`, `ProfessionalZipCode`,
`ProfessionalHomePhone`, `ProfessionalCellNumber` (all text except
`ProfessionalId`).

### Charge dimensions

`ChargeType` (text), `ChargeAmount` (number).

### Breed / Size / TreatmentType dimensions

`BreedName`, `BreedCode`; `SizeDescription`, `SizeCode`;
`TreatmentTypeDescription`.

### Treatment dimensions

`TreatmentDate` (text date), `TreatmentCostAmount` (number),
`TreatmentDogId` (integer), `TreatmentProfessionalId` (integer).

## Semantics and boundaries

- All dynamic values (filter values, limits) are bound parameters, never embedded
  in SQL text.
- Aggregated requests group by the requested dimensions and order by projected
  measures or dimensions; scalar aggregate requests (a measure with no grouping
  dimension) return a single summary row.  When a request selects only grouping
  dimensions and ranks groups by a measure, the ranking measure stays hidden and is
  never added to the result columns.
- `exists` restricts base rows to those having at least one matching related
  record; a positive `min_matches` requires at least that many matching records.
- `absence` restricts base rows to those having no matching related record.
- Row-level requests are lists; `distinct` removes duplicate result rows.
- Text matching operators are case-insensitive contains / starts-with / ends-with,
  and case-sensitive not-contains.
- `set` combines two compatible projections with union / intersection /
  difference; operands must agree in column count and positional type.
- `compare` keeps base rows whose attribute satisfies a comparison against a
  scalar aggregate (for example average or extreme age/cost) computed over an
  authorized population.
- `ranked` keeps base detail rows whose categorical attribute equals / compares
  with the hidden top or bottom grouped key (the group ranked first by an
  aggregate), keeping the detail projection independent and the ranking measure
  hidden.
- Unknown vocabulary, unsupported operator/value combinations, and unsupported
  shapes fail atomically with a diagnostic; no partial SQL is published.
- Relationship fan-out that would change the base grain is never used to widen a
  base entity's result.
