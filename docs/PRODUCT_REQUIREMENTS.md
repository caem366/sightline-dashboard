# Financial Decision Workspace — product requirements

Status: active implementation, 2026-10-29. This is a real local single-user application; fictional documents are test data, not a simulated UI.

## Promise and scope

**Financial decisions you can trace back to their source.** The first use case is comparing enterprise software proposals and revising a decision when a commercial document changes. The user owns the decision. Muse proposes interpretations; approved assumptions and deterministic code produce authoritative numbers.

Core means required for the first functioning application. Enhancement means subsequent work. The application must never invent a price, benefit, exchange rate, or discount rate to fill a gap.

## Roles and workflows

The initial role is an analyst who prepares a purchasing recommendation; a reviewer may be the same local user initially. Do not assume a particular job title or accounting policy.

| Workflow | Core acceptance behavior |
|---|---|
| Create analysis | Create project with name, objective, base currency, 1–5 year horizon, vendors, seat/usage forecast and optional assumptions; persist it and reopen it. |
| Ingest | Upload PDF proposals/amendments and XLSX support files; retain originals and hashes; show processing state and errors. |
| Review | Show extracted claims beside page/cell evidence; approve, edit or reject; unresolved material terms block a final recommendation. Human edits retain their author and reason. |
| Model | Compute annual and cumulative vendor cost, recurring/one-time breakdown, and cash outlay from approved inputs. Missing fees stay explicit. ROI/NPV/payback appear only after benefits, timing and discount rate are supplied. |
| Scenario | Change seat count, usage growth, implementation, discount, escalation and duration; recalculate without altering baseline. Natural language maps to validated operations and displays the interpreted operation before execution. |
| Compare | Normalize supported commercial terms, show side-by-side cost categories, scope differences, sensitivity and switching value. Rankings are provisional if material comparability gaps remain. |
| Revise | Add a new document version, show changed passages and proposed assumption revisions; approval creates a new immutable model version; show numerical before/after bridge and source path. |
| Export | Download a formula-backed XLSX with Inputs, Annual Costs, Comparison, Scenarios and Sources sheets; verify workbook output against server results. |
| Model Intelligence | Ask about a native model, select a result/chart/table/formula as context, inspect the exact line-item calculation and source path, preview a validated what-if, investigate warnings/trends, and generate audience-specific commentary with evidence links. Unknown or unsupported answers abstain. |

The decision report contains a cost ranking only when comparable, key assumptions, material unknowns, scenario sensitivity and source links. It never calls the cheapest vendor the best overall vendor without a user-supplied non-price evaluation.

## Nonfunctional requirements

- Persist projects, originals, reviews, model versions and audit events across restarts.
- Model arithmetic is deterministic and independent of Muse. All money rules and rounding are documented in `FINANCIAL_ENGINE.md`.
- Every document-derived assumption has a versioned source span. User-provided inputs have named provenance.
- All AI output is schema validated, size bounded and treated as untrusted. No uploaded document can instruct server operations.
- A failed extraction or unresolved clause is visible and recoverable; previous approved model remains usable.
- The UI is keyboard accessible and readable at 1280px desktop; responsive layout stacks panels on narrower screens.
- Local-first launch. Production authentication, tenancy, compliance and enterprise connectors are enhancements, not implied by the local build.

## Core versus enhancements

Core: two-vendor comparison; PDF/XLSX ingestion; evidence-backed extraction; review; deterministic model; comparison and scenarios; one amendment impact flow; history; formula-backed Excel; verification tests; natural-language intelligence over the application's native, validated model versions.

Enhancements: OCR for scans, multiple currencies with approved FX rates, complex tier families, actual-spend integration, collaboration, PDF/slides report, portfolio dashboards, more pricing models, and understanding arbitrary uploaded Excel models. A capability becomes supported only when it has calculation fixtures and end-to-end evidence.

## Native Model Intelligence acceptance

The answer surface is part of the Model/Compare/Report workflow, not a free-standing chatbot. It must show the bound project, model version, optional scenario, selected object, answer status, and clickable evidence. Quantitative statements must use server-produced result/assumption/formula IDs and exact values. A model-selected question plan cannot update assumptions, approve claims, or supply authoritative arithmetic. User-confirmed scenario operations run through the same deterministic engine as the Scenario Lab; their results are labeled hypothetical and preserve the baseline. Anomaly findings say `candidate` with rule, observations, and uncertainty; they do not assert an accounting error. Executive commentary separates cost findings from purchasing recommendations and cites every number. A selected historical model must never silently answer using the latest version.

## Success evidence

An uncut run opens two fictional source documents, approves extracted terms, computes a five-year comparison, ingests a revised clause, shows the reviewer its effect, approves it, recomputes the ranking from code, traces a changed result to the clause, and opens an editable workbook whose values reconcile. A different amendment must lead to a different computed outcome. Preserve failed runs.

See `ARCHITECTURE.md`, `DATA_MODEL.md`, `FINANCIAL_ENGINE.md`, `AI_WORKFLOWS.md`, `UX_DESIGN.md`, `TEST_STRATEGY.md`, and `IMPLEMENTATION_PLAN.md` for implementation contracts.
