# Telora testing

Telora separates module checking from behavior tests.

## Static checks

`telora check MODULE` parses, types, and initializes a complete module. Use it
for source modules and for development-time diagnostics:

```bash
telora check @src/model
```

A successful check does not execute function values. Do not expose ordinary
test values merely to make module initialization evaluate them.

## Behavior tests

Test modules live below `tests/`. A test entry directly exports values of type
`std/test.Test`, and is selected by its path without the `.telora` suffix:

```telora
import "std/test" as test;

export def accepts = test.should_ok(fn() {
    validate(valid_input)
});

export def rejects = test.should_fail_with(fn() {
    validate(invalid_input)
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

Keep deterministic success controls beside expected-failure cases. Domain APIs
should return `Result` only when callers genuinely need recovery; testing a
failure is not by itself a reason to change the domain error model.
