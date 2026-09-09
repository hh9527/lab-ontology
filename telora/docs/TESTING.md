# Telora testing

Telora separates module checking from behavior tests.

## Static checks

`telora check MODULE` parses, types, and initializes a complete module. Use it
for source modules and for development-time diagnostics:

```bash
telora check @src/model
```

A successful check does not run Test thunks or fixture factories. It does
initialize module values, which can call functions. Keep behavior checks inside
test thunks: a top-level `def passed = validate(input);` runs too early, even if
a Test later returns `passed`. Store reusable behavior in a function instead.

## Behavior tests

Test modules live below `tests/`. A test entry directly exports values of type
`std/test.Test`, and is selected by its path without the `.telora` suffix:

```telora
import "std/test" as test;

def positive: Fn() -> Bool = fn() { 1 + 1 == 2 };

export def accepts = test.should_ok(fn() {
    if positive() { True } else { fail!("unexpected sum") }
});

export def rejects = test.should_fail_with(fn() {
    raise!("invalid input")
}, "invalid input");
```

```bash
telora test model
```

`should_ok`, `should_fail`, and `should_fail_with` retain their zero-argument
thunks and execute them only when the test runs. `should_ok` accepts any normal
return value, including `False` and `Err(...)`; use an assertion that calls
`fail!` when a Boolean condition must hold.

`should_fail` requires a recoverable execution failure. `should_fail_with`
also requires the primary error message to contain its non-empty,
case-sensitive substring. Syntax, type, import, and module initialization
errors abort the module before any test runs.

Export one Test per independently diagnosable contract. Do not hide a whole
suite behind one exported Test: a failure would skip the remaining assertions.
Tests are discovered among the entry module's direct Test exports (including
explicit reexports), not ordinary imports or containers. Nested entries such
as `test query/lowering` are supported; invoke each suite explicitly.

## Results and diagnostics

Use ordinary calls and then decide what to do with their results:

```telora
import "std/codec" as codec;
import "std/value" { Value };
import "std/test" as test;

export def decodes = test.should_ok(fn() {
    let value = codec.decode(Int.type, Value.Int(7)).unwrap!();
    if value == 7 { True } else { fail!("wrong decoded value", value) }
});

export def returns_error = test.should_ok(fn() {
    match codec.decode(Int.type, Value.String("bad")) {
        Err(_) => True,
        Ok(value) => fail!("invalid input was accepted", value),
    }
});

export def raises_error = test.should_fail(fn() {
    codec.decode(Int.type, Value.String("bad")).unwrap!()
});
```

Match `Err` when testing a recoverable result contract; check its public error
details where available. Use `should_fail_with` with a stable message fragment
when the contract requires a particular execution failure. A Boolean probe
rejecting input does not prove the actual lowering entry rejects it: test both
when both are public contracts, with a nearby valid-input control.

`unwrap!` returns the Ok payload or delegates Err to `raise!`. Accepted error
types are String and BlameError. String supplies only a message, with no data
references; BlameError supplies a message and explicit subjects. `raise!` adds
the authored call-site rule, without implicitly attaching function arguments
or the Result container. `fail!(message, subjects...)` remains supported and
means `raise!(blame!(message, subjects...))` at that site. Keep subjects when
they explain a failed assertion; do not replace sourced failures with bare
strings. Other error types require an explicit adapter.

`ok_or_warn!` returns Some on success and delegates errors to `warn!`, which
returns None. It is not a success assertion: warnings do not make should_ok
fail. Do not use it to hide failures in positive tests.

The removed function macros `should_ok!` / `must_ok!`, `try_unwrap!`, and
`std/result.unwrap` are not test idioms. The ordinary `test.should_ok` function
is still the test constructor. Pass explicit type metadata to codec and
reflection APIs (`Int.type`, `Value.type`); leave type annotations and enum
constructors as types and constructors.

## Fixtures

Use `with_fixtures` when the same test should run against sourced JSON, YAML,
or TOML values:

```telora
import "std/test" as test;
import "std/value" {Value};

export def inputs = test.with_fixtures(["fixtures/a.json"], fn(value) {
    test.should_ok(fn() {
        match value {
            Value.Object(_) => True,
            _ => fail!("expected object", value),
        }
    })
});
```

Fixture paths are relative to the module that constructs the fixture Test and
must stay within its crate. A factory receives a sourced Value and returns a
Test, possibly another fixture group. Keep decoding, lowering, and assertions
in the child thunk so failures are reported as cases, not factory failures.
Missing or malformed fixtures and factory failures are setup errors; a child
should_fail cannot consume them. Do not migrate every small inline example to
a file: fixtures are useful for repeated data-driven contracts and provenance.

## Repository regression workflow

From the lab-ontology root, use the same local `bin/telora` for all commands:

```bash
./bin/telora -C ontology check @src/query
./bin/telora -C ontology check @src/edsl
./bin/telora -C ontology test query
./bin/telora -C ontology test ontology
./bin/telora -C ontology test intent
./bin/telora -C ontology test model-rules
./bin/telora -C world-model test query
./bin/telora -C spider-model test query
./bin/telora -C dog-model test query
python3 scripts/test-model-diagnostics.py
```

The diagnostic script consumes intentionally failing cases under
`ontology/tests/diagnostics/rejections.telora` and asserts their public JSONL
messages, rule modules and data sources. Run this entry through the script;
its direct `telora test` exit status is intentionally nonzero.

Also check each model's `@src/bin/make-query` and smoke-test the corresponding
`bin/*-make-query` entry with valid and invalid inputs. A probe-only test is
not a substitute for exercising the production lowering boundary.

Read the process exit status and the `telora.test/v2` JSONL summary: require
nonzero total, zero failed, and no abort. Case records identify individual
exports and fixture indices. Do not compare failed preparation timings with
successful runs; end-to-end test time includes loading, checking and module
initialization, not just assertion execution.

Keep deterministic success controls beside expected-failure cases. Domain APIs
should return `Result` only when callers genuinely need recovery; testing a
failure is not by itself a reason to change the domain error model.
