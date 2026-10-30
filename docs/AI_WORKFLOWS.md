# Muse workflows and trust boundaries

Use **one orchestrator with four typed stages**, not four independent agents. Separate agents would multiply latency, prompt drift and handoff errors without giving these tasks independent authority. Stages share a versioned document/assumption contract and are triggered by explicit user operations. All calls are bounded by input size, output schema, timeout, retry budget and model-run audit metadata.

## Stages

| Stage | Muse responsibility | Code responsibility | Result |
|---|---|---|---|
| Extract | Interpret passages and pricing tables; propose terms, units, dates, source spans and ambiguities. | Parse/render documents, select relevant pages, validate schema/source coordinates, deduplicate candidates. | Claims awaiting review. |
| Compare | Propose semantic mappings between different vendor terminology; identify candidate missing scope or contradictions. | Enforce controlled pricing grammar and deterministic comparability checks. | Reviewable mappings and warnings. |
| Scenario | Translate a question into whitelisted operations on known driver IDs. | Validate units/ranges, calculate baseline and scenario, compute switching values. | Scenario result with displayed interpreted operation. |
| Revision | Compare new/old passages and propose changed financial assumptions, including effective date. | Version originals, match passages/assumptions, require approval, publish new model transactionally, compute exact delta. | Impact preview, then approved new version. |
| Native Model Intelligence | Map a natural-language question and selected UI object to one bounded read-only intent; draft concise audience-specific prose using returned evidence IDs. | Select one immutable snapshot, execute deterministic inspection/trace/compare/anomaly/scenario tools, reconcile numbers, validate every citation and numerical statement, or abstain. | Evidence-backed answer cards and reviewed scenario previews. |

Muse never receives a DB write, arbitrary code execution, financial-total override, or approval tool. Document text is untrusted data. A document instruction to ignore policy, reveal secrets, or call an endpoint is ignored by tool registry and tested. Use `response_format` JSON Schema if supported by the assigned Baseten model; then validate the response with Zod and semantic rules. If schema format is unavailable, request one JSON action at a time and validate through the same registry; never trust free-form numbers as model results.

## Extraction contract

Each candidate includes `kind`, `rawValue`, normalized decimal/string value, currency/unit, cadence, effective interval, pricing-rule candidate, `sourcePassageId`, exact short excerpt, confidence label (`clear|ambiguous|conflicting`), and a plain-language uncertainty reason. Reject missing or mismatched source IDs and values not present in the cited passage unless they are explicitly marked inferred and routed for review. Multiple clauses may support or conflict with one assumption. Keep the model-visible context to selected excerpts plus page images, not a concatenation of every document by default.

For PDFs, first extract text with page positions. Render selected pages for tables and visual layout; compare visual interpretation with extracted text. Direct PDF input through Baseten is not assumed. For XLSX, provide sheet/cell coordinates and formula text separately from cached values. Never silently evaluate an uploaded formula from a stale cache.

## Prompt and call design

### Model Intelligence tool contract

`inspect_model({modelId})` returns version, currency/horizon, vendor IDs, result IDs, rule catalog and warnings. `get_result({modelId,vendorId,year?,category?})` returns exact stored totals and rounded lines. `trace_dependencies({modelId,resultId,depth})` returns typed graph edges plus source passage IDs. `compare_vendors({modelId,vendorIds})` returns server-calculated differences and comparability. `detect_anomalies({modelId,ruleIds?})` returns candidate findings with observations, rule/threshold and uncertainty. `preview_scenario({baseModelId,operation})` validates an operation and invokes the pure engine without publication. `get_source({passageId})` returns a short exact excerpt and local navigation target. All IDs must belong to the same project and selected model; depth, result counts, bytes and time are capped.

For a question, Muse first emits a schema-validated intent with target IDs from the inspection catalog. The server calls tools and creates an evidence ledger. Muse may then propose narrative sentences referencing only ledger IDs. Reject unknown citations, unsupported claims, invented money/percent/date values, model-version drift, and a claim of causation from a dependency edge alone. If prose verification is inconclusive, show the deterministic answer with `needs review` or abstain. Scenario interpretation is a proposed operation card; only a user action executes it. System prompts treat source document text and user questions as untrusted data. Do not send an unstructured workbook or unrestricted DB dump.

Audience modes are analyst (calculation and caveats), executive (decision context and material change), and reviewer (source and validation path). Every mode retains the same quantitative ledger and limitations. A narrative never calls lowest modeled cost the best overall procurement decision. Imported workbook interpretation remains disabled until the separate parser/recalculation gate in `ARCHITECTURE.md` passes.

System instructions define the allowed task, schema and `unknown` behavior. Developer-side context lists approved project vocabulary and available source IDs. User documents are clearly delimited as evidence, not instructions. `temperature`/reasoning settings and model ID are recorded with prompt version. One stage call returns proposals; code checks all references; the UI asks for approval. A failed or malformed response is retried at most once with the validation error, then marked `needs_review` and left out of the model.

The existing VEIL Baseten client demonstrates endpoint shape and JSON Schema usage with the assigned `meta-models/muse-spark-open-1026`, but a fresh endpoint, image-input, schema and latency probe is the first implementation gate. The attempt from this session failed at network transport; no credential or model compatibility conclusion follows from it.

## Evaluation fixtures

Maintain fictional proposals with answer keys for value, unit, page/cell, date, and clause status. Grade field-level precision/recall, source correctness, revision mapping and whether an ambiguous input appropriately abstains. Log actual model behavior separately from deterministic validation results. Preserve bad outputs for regression. Do not fabricate an AI action in a demo; if extraction fails, show the review/failure state.
