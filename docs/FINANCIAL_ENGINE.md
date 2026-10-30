# Financial engine specification

The engine is a pure TypeScript module: `evaluate(modelInputs, scenarioOverrides, engineVersion) -> results + dependencyEdges + diagnostics`. It accepts only reviewed typed assumptions and never calls Muse, the database, or the UI. Its inputs and outputs are serializable, versioned and reproducible.

## Input grammar

Each commercial line has vendor, category, currency, effective interval, billing cadence, charge timing, and a pricing rule. Supported first rules are: fixed one-time fee; fixed recurring fee; per-seat recurring fee; per-unit usage fee; graduated or volume tier table with explicit threshold convention; percentage discount with eligible base and dates; minimum annual commitment; annual escalation with start date and cap; and support surcharge. Contract dates and seat/usage forecasts are explicit. Unsupported or contradictory terms produce diagnostics, not guessed arithmetic.

Use `decimal.js` for unit prices, fractions and percentage rates; store decimal strings. Round a charge to currency minor units at the defined invoice-line boundary using an explicit half-up policy for the initial CAD fixtures. Sum rounded lines for period totals; do not round every multiplication intermediate. The export uses the same boundaries. Currency conversion requires a reviewed FX rate, pair and observation date; otherwise comparisons across currencies are blocked. A rate is an assumption, not a live hidden lookup.

## Time and calculation order

Use calendar months as atomic periods with inclusive start and exclusive end dates. Define whether an annual prepaid invoice occurs at term start or anniversary; no automatic annual-to-monthly conversion without respecting timing. For each vendor/period:

1. Determine active contract and revision, eligible seats/usage and tier rule.
2. Calculate gross license and usage charges, applying escalation only after its effective date and cap.
3. Apply explicitly eligible discounts in documented order.
4. Apply minimum commitment according to its contract period and whether it is a floor or additional fee; the same minimum must not be charged twice.
5. Add implementation, migration, support, exit and tax lines only when independently present or user supplied.
6. Round invoice lines, aggregate months into calendar/fiscal analysis years, then cumulative TCO.

TCO is total modeled cash outlay across the chosen horizon, with category and year breakdown. Cost per seat uses a defined denominator (seat-months or average active seats), displayed in the UI. Cash-flow projection means timing of outlays, not an inferred benefit stream.

ROI = `(benefits - costs) / costs`; NPV = sum of dated net cash flows discounted by a user-approved rate and convention; payback is the earliest date cumulative net cash flow becomes nonnegative. These are unavailable when benefits, timing or rate are absent. The UI must distinguish financial NPV from any public-sector social-value metric. Break-even or switching value for a single linear cost driver solves the cost difference for the driver; for tiered/nonlinear rules, enumerate breakpoints and solve/scan each interval, then verify the candidate with a fresh full evaluation. Report no unique answer when multiple crossings exist.

## Scenarios and versions

## Inspection and quantitative attribution

Expose typed rule metadata and result-line IDs alongside amounts so an inspection service can reconcile a selected month, year, category and vendor to the exact rounded lines. A result explanation must recompute `sum(lines)` with decimal arithmetic and refuse a mismatching snapshot. Dependency traversal returns `depends_on`, never an unqualified causal claim. To explain a revision, use the signed before/after bridge from two immutable versions and show changed inputs and interactions. To test a single driver, run a labeled counterfactual with the same engine; multiple interacting drivers must not be reported as independently additive unless a reconciliation proves it. Trend/anomaly rules can flag missing costs, currency conflicts, duplicate/overlapping terms, unexpected year changes or a formula/line mismatch as candidates with thresholds and evidence. Muse may choose a rule and phrase the result but cannot calculate or overwrite it.

A scenario is `{baseModelId, overrides:[{assumptionId, operation, value, unit}], name}`. Allow `set`, `increasePercent`, `increaseAmount` only for whitelisted driver types; validate date/range and unit. Scenario evaluation is pure and does not change approved baseline inputs. A contract amendment is different: its reviewed assumption revision creates a new baseline model version. Compare old and new results by vendor/year/category and compute signed deltas. The explanatory bridge is a deterministic sum of changed result lines; Muse may phrase it but cannot alter it.

## Comparability and ranking

Before ranking vendors, compare included scope, seat population, usage units, contract term, horizon coverage, currency, support/implementation/migration/exit categories, tax convention, and unresolved material clauses. Mark missing terms `unknown`, never zero. If a difference could change the ranking, display `provisional`; for materially unknown cost with no bounded value, display `cannot determine`. A cheapest-cost ranking is not an overall purchasing recommendation.

## Invariants and independent checks

- Every total equals the sum of its rounded constituent lines, by vendor/year/currency.
- TCO equals the sum of annual outlays over exactly the selected horizon.
- A zero-cost fee added once changes the result by zero; a positive standalone fee changes its eligible period by that fee, unless an explicit discount/minimum interaction applies.
- No charge appears outside its effective interval; no minimum or one-time fee is double counted.
- Identical normalized inputs produce identical outputs and digest, independent of document order.
- A scenario never changes baseline results; a published historical version never changes.
- Any unconverted currency mismatch or missing required rate blocks a comparable total.
- A numerical bridge's signed deltas sum to the displayed before/after difference.
- Switching-value candidates must change the ranking at the stated boundary when re-evaluated, within one minor unit.

Use hand-calculated golden cases for monthly/annual, tier thresholds, escalation caps, midterm amendments, minimum floors, discount eligibility and rounding. Add fast-check properties that avoid tautologically calling the same calculation as the oracle. Export reconciliation independently reads back workbook formulas/inputs and compares evaluated values using Excel or LibreOffice on a validation machine; merely setting `fullCalcOnLoad` is insufficient proof.
