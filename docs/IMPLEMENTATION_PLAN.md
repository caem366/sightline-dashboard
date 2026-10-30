# Dependency-aware implementation plan

Status: approved and implemented through the core vertical slice. The target is a functioning application, with strong document-to-decision provenance and honest unsupported states. The core vertical slice is two vendors, one reviewed five-year model, one scenario, one revised proposal, impact trace and editable Excel export.

## Repository structure and conventions

Create one standalone TypeScript application in this directory, with `src/client`, `src/server`, `src/shared`, `migrations`, `tests/fixtures`, and ignored `data`. See `ARCHITECTURE.md` for module ownership and API contracts. Keep document originals immutable; use schema validation at every external boundary. All API errors have stable codes. Plan migration numbers below are conceptual and should be committed with the implementation.

## Phase 0 — provider and document spike

- **Objective/dependency:** Bootstrap the minimal TypeScript package, then establish actual provider and parser behavior before designing prompts around assumptions. This is the first code phase, after approval.
- **Files/modules:** `scripts/probe-muse.ts`, `src/server/ai/provider.ts`, `src/server/documents/pdf.ts`, `tests/fixtures/proposals/`, `tests/ai/provider.test.ts`.
- **Database/API:** none beyond a temporary local fixture; no UI endpoint.
- **Work:** Probe assigned model ID, structured output, selected rendered-page image input, timeout/latency and one pricing-table extraction. Check PDF text coordinates and a table image. Do not print the key. If network remains unavailable, continue local architecture but mark live AI gate unverified.
- **Acceptance/output:** One recorded real provider response, validated schema and page reference, or an explicit transport/model limitation with fallback plan. A small fixture with expected values and source locations.

## Phase 1 — foundation and persistent project

- **Objective/dependency:** Build a runnable, navigable app before document or model features.
- **Files/modules:** `package.json`, Vite/TypeScript configs, `src/client/app/App.tsx`, shell/styles, `src/server/index.ts`, `src/server/api/projects.ts`, `src/server/db/{connection,migrate,repositories}.ts`, `src/shared/schemas/project.ts`, `migrations/001_foundation.sql`, `tests/api/projects.test.ts`.
- **Database/API:** `projects`, `vendors`, `audit_events`, `jobs`; `POST/GET /api/projects`, project list, health.
- **Acceptance/output:** Create, reload and reopen a project; keyboard-usable shell; typecheck/build/API smoke tests pass. Files and database remain local and ignored.

## Phase 2 — pure financial core

- **Objective/dependency:** Prove money correctness independently of Muse and document parsing.
- **Files/modules:** `src/server/finance/{types,pricing,periods,engine,graph,diagnostics}.ts`, `src/shared/schemas/assumption.ts`, `migrations/002_finance.sql`, `tests/finance/{golden,properties,version}.test.ts`, `src/server/api/model.ts`.
- **Database/API:** `assumptions`, `assumption_revisions`, `financial_models`, `model_inputs`, `calculated_results`, `dependency_edges`, `scenarios`; `GET /api/projects/:id/model`, `POST /api/projects/:id/scenarios`.
- **Acceptance/output:** Hand-entered reviewed inputs produce correct monthly/annual lines and five-year TCO; scenarios do not mutate baseline; versioned results reproduce after restart; invariant tests pass. Start with fixed/per-seat and one-time rules, then tiers/minimums/escalation after golden cases exist.

## Phase 3 — source ingestion, extraction and review

- **Objective/dependency:** Replace hand-entered vendor inputs with source-grounded proposals. Depends on provider spike and foundation; engine already has typed input contract.
- **Files/modules:** `src/server/documents/{store,pdf,xlsx,passages}.ts`, `src/server/ai/{extract,validate,prompts}.ts`, `src/server/review/service.ts`, `src/server/jobs/worker.ts`, `src/server/api/{documents,claims,jobs}.ts`, `src/client/features/documents/`, `src/client/features/review/`, `migrations/003_documents.sql`, `tests/{documents,ai,api}/`.
- **Database/API:** `documents`, `document_versions`, `source_passages`, `extracted_claims`, `review_decisions`, `model_runs`; document upload/job status/claims/review endpoints in `ARCHITECTURE.md`.
- **Acceptance/output:** Upload two text PDFs and a supporting XLSX; show source-highlighted claims; edit/approve/reject; publish one model from approved claims only. A material ambiguity remains unresolved. Worker recovers from restart and upload retry is idempotent.

## Phase 4 — comparison, scenarios and decision intelligence

- **Objective/dependency:** Turn correct models into an inspectable choice, after at least two approved vendors exist.
- **Files/modules:** `src/server/decision/{compare,completeness,switching,explain}.ts`, `src/server/ai/scenario.ts`, `src/server/api/{scenarios,decisions}.ts`, `src/client/features/{model,comparison,scenarios}/`, `tests/decision/`.
- **Database/API:** reuse models/scenarios/results/edges; add only missing indices/migration `004_decision.sql`; `POST /api/projects/:id/scenarios/interpret`, `GET /api/projects/:id/decisions`.
- **Acceptance/output:** Comparable vendor costs and annual charts; missing cost shown as unknown; provisional status when scope differs; seat-growth scenario parsed by Muse into a reviewed operation; switching value verified by full recomputation.

## Phase 5 — revision intelligence and impact

- **Objective/dependency:** Deliver signature source-to-decision change flow, after document, review and model contracts work.
- **Files/modules:** `src/server/documents/diff.ts`, `src/server/ai/revision.ts`, `src/server/review/publish.ts`, `src/server/decision/bridge.ts`, `src/server/api/revisions.ts`, `src/client/features/revisions/`, `migrations/005_revisions.sql` if needed, `tests/revisions/`.
- **Database/API:** use predecessor document-version ID, immutable assumption/model versions, review/audit; revision analyze and approval endpoints.
- **Acceptance/output:** Upload an amendment; detect the changed term and exact source; show proposed input change and impact preview; approval atomically publishes new model; before/after bridge reconciles; old version and source remain available. A different amendment produces a different computed result.

## Phase 6 — workbook export and full verification

- **Objective/dependency:** Produce a useful independent artifact, after model and revision math stabilizes.
- **Files/modules:** `src/server/export/{workbook,reconcile,store}.ts`, `src/server/api/exports.ts`, `src/client/features/report/`, `migrations/006_exports.sql`, `tests/export/`, `tests/e2e/analysis.spec.ts`.
- **Database/API:** `exports`; create/status/download export endpoints.
- **Acceptance/output:** XLSX has editable Inputs and linked formulas in Annual Costs/Comparison, source IDs, scenario sheet, and appropriate charts or chart-ready tables. Independent recalculation matches server results within one minor unit. Full browser path passes with fictional files. A mismatch blocks `verified` status.

## Phase 7 — product polish and evidence

- **Objective/dependency:** Make the functioning path legible and reliable; no new domain breadth.
- **Files/modules:** refine client components/styles, accessibility, error states, upload recovery; `tests/e2e/`, `docs/demo/` evidence and README.
- **Database/API:** no new entities unless correcting a demonstrated gap.
- **Acceptance/output:** Repeatable live Muse run with two proposals and one amendment, preserved success/failure evidence, no fabricated actions, clear provisional state, readable 2–3 minute walkthrough, clean build/test results.

## Phase 8 — native Model Intelligence (new core capability)

**Implementation status (October 29):** The inspection API, line-item reconciliation, rule and input explorer with source links, candidate anomaly rules, Muse intent planner, deterministic answer dispatcher, evidence-fact narrative selection, dedicated view, and contextual Model/Compare/Report entry points are implemented. Automated HTTP, unit, and Playwright checks pass, including mocked question-to-source and scenario-preview-to-result paths. The live question probe twice returned Baseten HTTP 403 before a model response, so the live exit gate remains open. The product deliberately renders quantitative prose from verified server facts; arbitrary Muse-written numerical prose is outside this implementation. Phase 9 remains research only.

- **Dependency:** Build on the existing reviewed model snapshots, Decimal engine, scenario endpoint, source passages and dependency graph. Do not reopen Phases 0–7 or reuse another product's code.
- **Vertical slice A:** Add typed inspection and explanation APIs in `src/server/intelligence/`, covering model metadata, formula/rule IDs, line-level reconciliation, assumptions, source IDs, warnings, version-scoped graph traversal and candidate anomaly rules. Add `GET /api/projects/:id/intelligence/inspect`, `GET /api/projects/:id/intelligence/explain`, and targeted trace/source endpoints. Unit and API tests must pass before Muse is introduced.
- **Vertical slice B:** Add a schema-validated Muse intent planner over a bounded inspection catalog and fixed tool registry. `POST /api/projects/:id/intelligence/ask` dispatches read-only deterministic tools and returns evidence IDs, status and version. The existing scenario interpreter produces an editable operation; a separate user action invokes the engine. Test unknown IDs, stale versions, prompt injection, out-of-scope tools and number/citation fabrication.
- **Vertical slice C:** Build the dedicated Model Intelligence view and contextual entry points from Model, Compare and Report. Show formula dependency paths, anomaly candidates, linked sources, answer scope and audience-specific commentary. Playwright must complete question → result → evidence → source and scenario preview → execute → unchanged baseline.
- **Exit:** A live Muse run answers at least three different native-model questions about the fictional two-vendor amendment, with all numeric facts reconciled and every evidence link resolvable. An unsupported question abstains. A historical version answer stays on that version. Preserve failed runs and report latency/coverage separately.

## Phase 9 — arbitrary imported Excel model research (future, separate gate)

Inventory XLSX OPC relationships, worksheet and table references, defined names/named ranges, formula grammar/AST and cross-sheet dependency graph. Test shared/array/dynamic formulas, date and number formats, calculation chains, cycles, unsupported functions, external links, VBA/macros, data connections and stale caches. Establish a supported-function matrix and independent calculation oracle before exposing imported-model questions. No arbitrary Excel comprehension or recalculation claim is permitted before that gate. The current proposal-XLSX passage parser is source ingestion, not an imported financial-model interpreter.

## Order, review and decisions

Phases 1 and 2 can proceed from the Phase 0 contract. Phase 3 requires the parser/provider findings; Phase 4 needs approved vendor models; Phase 5 needs stable revision and graph semantics; Phase 6 needs stable formulas. UI components are built alongside their workflows, not deferred to the end.

No product decision is required to begin Phase 0 once this plan is approved. Recommended defaults are CAD, five analysis years, fictional source files for tests, local single-user launch and review of every document-derived revision. Before using real confidential documents, the user must decide whether provider processing and retention are acceptable. Before production deployment, authentication, backups, tenant isolation and data policy require a separate plan.

**Exact first implementation task after approval:** initialize this directory as a standalone Node 24/React/TypeScript/Express app with `src/client`, `src/server`, `src/shared`, one health endpoint, typecheck/build/test scripts, ignored private `data`, then add the Phase 0 Baseten structured-output and rendered-page probe against a fictional proposal. Record the assigned model ID and probe outcome without recording credentials.
