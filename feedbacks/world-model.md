# World domain follow-up: remove stale projection-order contradictions

The decoder-complete JSON examples are now fixed and all checks pass. One documentation
contradiction remains in the numbered semantic rules: they still state that HAVING results and all
outputs always place dimensions before measures. That is no longer true when a non-empty
`output_order` is supplied.

Make this documentation-only correction without changing source behavior or reading held-out data:

- State that empty `output_order` uses the legacy dimensions-then-measures order.
- State that non-empty `output_order` is the exact public order for `Ordinary`, selected/hidden
  HAVING, and related existence variants.
- Keep hidden HAVING/order/related/scalar mechanics excluded from public output in either mode.
- Search all of `DOMAIN.md` and `INTENT.md` for unconditional fixed-order claims and make them
  consistent with this rule.
- Run all four authorized checks and make no unrelated changes.
