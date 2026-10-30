# Test and verification strategy

## Implemented checks (October 29, 2026)

Run `npm run build` and `npm test`. The current suite uses Node's test runner, fast-check, real HTTP requests, and Playwright. It covers deterministic financial rules, missing and conflicting costs, source validation, PDF rendering, approved revisions, model history, scenarios, and workbook formulas. A fictional amendment export was also recalculated with desktop Excel and matched both server totals. A live Muse run processed two fictional proposals and an amendment, with explicit fixture review before each model publication; a separate scenario interpretation also succeeded. Two live claims had nonempty ambiguity strings despite matching the expected source and value. The remaining cases below are the broader specification, not a claim that every case has passed.

Tests verify **source interpretation**, **financial calculation**, **version propagation**, and **export** separately. A correct-looking chart cannot substitute for a correct input or formula. Use fictional but commercially plausible PDF/XLSX fixtures with page/cell answer keys and at least one amendment. Keep fixtures in `tests/fixtures/`; no real confidential proposal enters the repository.

## Test layers

| Layer | Tool and assertions |
|---|---|
| Pure finance unit | Vitest golden tables with independently hand-calculated expected line items and totals. Cover one-time, monthly/annual prepaid, usage, tiers, minimums, discounts, escalation, caps, dates and rounding. |
| Property | fast-check: totals reconcile; date-window isolation; permutation invariance of independent lines; baseline immutability; monotonicity for an independent positive fee; scenario revert; bridge sum. State preconditions for discount/minimum interactions. |
| Document parser | Fixed PDFs/XLSX: text, page/coordinate, cell/formula, hashes, version lineage, scan-only error; malformed and oversized uploads. |
| Muse contract | Mock provider responses for valid, malformed, unsupported, duplicate, contradictory and prompt-injected claims. Zod and semantic validators reject invalid source IDs, units or dates. Live fixtures measure extraction and source accuracy. |
| Review/revision | Approve/edit/reject flows; unresolved terms cannot enter authoritative model; stale expected version conflicts; old version unchanged; amendment affects only intended assumptions. |
| Dependency/decision | Graph has no cycles or cross-project edges; changed source leads to affected result path; numerical delta and switching value re-evaluate correctly; missing comparability blocks firm recommendation. |
| API/integration | Supertest against temporary SQLite and filesystem; persistence after restart, transactional rollback, idempotent upload/job, safe download paths, bounded requests, redacted errors. |
| Workbook | Open exported XLSX, inspect formulas and source references; recalculate with Excel or LibreOffice in a validation environment and compare annual/total values to server within one currency minor unit. A cached result alone is not proof. |
| Browser | Playwright runs create → upload → review → model → scenario → revision → impact → export; checks source navigation and accessible status/error states. |

## Required cases

## Model Intelligence tests and gate

Unit: inspection totals reconcile to rounded result lines; graph traversal terminates, stays within selected model/project and distinguishes dependency from causation; selected old version returns old values; trend and missing-cost rules produce candidate findings with correct thresholds. Contract: mock Muse intent with valid/unknown IDs, malformed schema, invented citation, invented number, source prompt injection and out-of-project target; only validated intents dispatch. Scenario question produces a reviewable operation and deterministic preview with unchanged baseline. Browser: select annual table result, open Model Intelligence with context, ask a question, inspect formula/assumption/source links, follow a link, return to the same model version, and review an executive narrative. Live: run two fictional vendors and an amendment; check answer values, citation correctness, model version, anomaly wording and latency. A passing model refusal counts as safe behavior, not answer accuracy.

Acceptance: for the supported native model, every displayed quantitative answer must match a server result or independently checked deterministic calculation and resolve to at least one valid evidence ID. Unsupported intents abstain. No arbitrary uploaded Excel workbook is called understood until formula parsing, graph validation and independent recalculation pass the separate imported-model test matrix.

1. CAD 100/seat/month versus CAD 1,200/seat/year, with invoice timing visible.
2. A USD quote alongside CAD without approved FX rate blocks comparison.
3. Implementation cost absent from one proposal is `unknown`, not zero.
4. Duplicate implementation fee in an order form and master agreement is not charged twice without review.
5. Conflicting escalation clauses remain unresolved and block finality.
6. Tier threshold edge (e.g., 100 versus 101 seats) follows the declared graduated/volume convention.
7. Annual escalation and cap use correct effective date and never exceed cap.
8. Mid-contract amendment changes only applicable later periods.
9. Incorrect billing-period interpretation is caught by source-to-unit validation or human review.
10. Ambiguous `up to` pricing does not become a fixed amount.
11. ROI/NPV/payback are unavailable when benefits/rate/timing are missing.
12. One approved revision reverses the cost ranking; another does not. Neither winner is hardcoded.
13. Prompt-injected document requests secret disclosure or an arbitrary tool; no such operation is available.
14. Source passage is removed or moved in new version; old model still resolves to original version.

## Evaluation and release gates

For each live Muse fixture, record expected term, extracted value, unit, effective date, source and ambiguity status. Report field accuracy and source correctness separately; a model refusal/abstention is not counted as extraction success. Preserve failure artifacts. The vertical slice is accepted only when a repeatable live run supports two vendors, one amendment, review, correct recalculation, source trace, and reconciled workbook. No claim of broad document support until varied external samples pass.

Use `npm run typecheck`, `npm test`, `npm run build`, and a Playwright e2e command in CI/local checks after initialization. The first implementation task must set those commands and one smoke test. Do not expand tests to unimplemented features; each new money rule or trust boundary needs a meaningful case.
