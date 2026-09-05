# Dog resolver feedback: ranked detail output order

Exact projection now works for ordinary cross-entity listings. One residual resolver choice remains:
when `ranked` filters detail rows through a hidden grouped-key comparison and the selected attributes
span the detail base plus a safely reachable parent, the physical base-first `dimensions` order must
not determine the public column order.

- Derive `output_order` from the order in which result attributes are requested.
- Keep `dimensions` in the deterministic base-first order required for subject/grain resolution.
- Include every selected dimension exactly once in `output_order`; do not add the hidden comparison
  attribute, grouping key or ranking measure.
- Apply this rule equally to ascending and descending ranked comparisons.

Add a domain-neutral adjacent test whose ranked detail projection names a parent attribute before a
base attribute, and assert exact SQL column order. Do not include benchmark questions, values,
answers or reference SQL. Keep all four authorized checks green. The bounded multi-hop related
aggregate foundation revision may arrive separately; integrate it when available without weakening
this output-order rule.
