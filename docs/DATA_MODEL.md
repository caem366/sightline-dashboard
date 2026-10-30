# Data model and consistency

SQLite is authoritative for metadata, approved inputs, version lineage, calculated snapshots and audit. Original bytes live in a private content-addressed directory. UUID/ULID-like IDs are opaque; all timestamps are UTC ISO-8601. Monetary decimals are canonical strings; currency is an ISO code. Foreign keys are enabled and migrations are transactional.

| Table | Core fields | Invariant |
|---|---|---|
| `projects` | id, name, objective, investment_type, base_currency, horizon_start, years, created_at | Horizon is 1–5 years initially. |
| `vendors` | id, project_id, name, option_status | Unique vendor per project/name normalization. |
| `documents` | id, project_id, vendor_id nullable, kind, filename, created_at | Logical document lineage. |
| `document_versions` | id, document_id, version_no, sha256, storage_key, uploaded_at, processing_status, predecessor_id nullable | Unique version number; immutable original hash. |
| `source_passages` | id, version_id, page_or_sheet, coordinates_or_cell, text, text_hash | Must locate an exact source in one immutable version. |
| `extracted_claims` | id, passage_id, kind, raw_text, normalized_candidate_json, confidence_label, ambiguity, model_run_id, status | A claim is a proposal, never a calculation input. |
| `assumptions` | id, project_id, vendor_id nullable, kind, unit, current_revision_id nullable | Stable identity across revisions. |
| `assumption_revisions` | id, assumption_id, revision_no, value_decimal_or_text, currency nullable, interval_json, provenance_type, source_passage_id nullable, reviewer_id, review_reason, status, created_at | Approved revisions immutable. Document-derived approved values require a passage; user values require named owner. |
| `financial_models` | id, project_id, version_no, parent_id nullable, input_digest, engine_version, status, created_at | Published model snapshot references exact revisions and engine version. |
| `model_inputs` | model_id, assumption_revision_id | Exact approved input set; unique pair. |
| `scenarios` | id, project_id, base_model_id, name, overrides_json, created_at | Overrides are validated and do not mutate baseline. |
| `calculated_results` | id, model_id, scenario_id nullable, vendor_id, year, category, amount_decimal, currency, formula_key | Immutable; annual and total rows derived from same input snapshot. |
| `dependency_edges` | model_id, from_type, from_id, to_type, to_id, edge_kind | Only allowed node types; no cross-project links or cycles. |
| `review_decisions` | id, claim_id nullable, proposed_revision_id nullable, action, actor, reason, expected_model_version, at | Approval/rejection/edit always audited. |
| `audit_events` | id, project_id, correlation_id, event_type, actor, payload_redacted_json, at | Append-only application event log. |
| `exports` | id, model_id, scenario_id nullable, sha256, storage_key, reconciliation_status, created_at | Export binds a specific immutable snapshot. |
| `jobs` | id, project_id, version_id nullable, kind, state, attempts, error_code, created_at, updated_at | Restartable and idempotent by stage/version. |
| `model_runs` | id, provider, model_id, prompt_version, input_digest, schema_version, outcome, latency_ms, at | Do not store API keys or unredacted sensitive prompts in ordinary logs. |

`assumptions.kind` is a controlled vocabulary: license price, quantity, tier threshold/rate, minimum commitment, discount, implementation, migration, support, tax, escalation, contract dates, usage growth, benefits, discount rate and FX rate. Each assumption also has a unit such as `CAD/seat/month`, `CAD once`, or `percent/year`; an untyped number is invalid. Detailed pricing structures live in validated JSON records tied to assumption revisions until a repeated pattern warrants normalized tables.

## Publication transaction

## Model Intelligence read model

An inspection response is bound to `{projectId, modelId, modelVersion, scenarioId?}`. Stable evidence IDs identify `assumption`, `source_passage`, `formula`, `monthly_result`, `annual_result`, `comparison`, and `warning`. Each result references the precise input revisions and calculation rule used by the immutable snapshot. Evidence links are resolved server-side and scoped to one project; free-form model URLs or IDs are never trusted. The current `dependency_edges` table is a mathematical lineage graph. It cannot, by itself, establish that an assumption caused a business outcome. A revision bridge can attribute a measured change to a versioned input set; a single-input counterfactual is labeled sensitivity when interactions make additive attribution invalid.

Add `intelligence_queries` only if saved history becomes a user workflow: id, project_id, model_id, scenario_id, question, selected_context_json, intent_json, answer_json, evidence_ids_json, status, provider_run_id, created_at. Do not persist sensitive document snippets or chain-of-thought. Native inspection can initially be computed from existing immutable tables without a new migration. Imported Excel models require separate workbook/cell/formula/dependency entities and validation status; they must never be mixed with approved native model inputs by filename alone.

1. Validate claim/revision and expected project model version.
2. Write review decision and immutable approved assumption revision.
3. Assemble all current approved inputs; reject missing mandatory terms or mark comparison provisional.
4. Calculate model and graph in memory; verify invariants.
5. Insert model version, input links, results, edges and audit event in one transaction; set project current_model_id last.
6. Return the new version and change summary. A failure leaves the previous model published.

The graph has source lineage and calculation dependency edges. Source passage → claim → revision edges are persistent. Formula → annual result → comparison edges are regenerated per model version. A topological traversal finds affected results; the first implementation may recompute the small entire project and still use the graph for explainability, then optimize incremental recomputation after profiling.

No mutable `current_value` is trusted over the revision referenced by a model. A revision never rewrites prior models. Deleting a document with referenced approved assumptions is disallowed until the project is explicitly archived or the assumption lineage is migrated; exports retain their model snapshot.
