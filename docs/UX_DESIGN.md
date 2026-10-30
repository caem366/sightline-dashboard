# UX design and information architecture

Design principle: **every number is inspectable and every uncertain claim is visibly uncertain.** The product is a dense financial workspace, not a chat-led interface. The primary desktop width is 1280–1600px; narrow viewports use tabs/drawers without hiding approval status.

## Navigation

Left rail: Projects, Reviews, Recent versions, Exports. Within a project: Overview, Documents, Model, Model Intelligence, Compare, Revisions, Report. A persistent top bar shows project, base currency/horizon, current model version, and processing/review state. No decorative metric is shown without a computable definition.

| Screen | Layout and key interactions |
|---|---|
| Dashboard | Searchable project rows, last model version, unresolved claims, last activity and explicit decision status. Create project primary action. |
| New Analysis | Short form: objective, currency, analysis start/horizon, vendors, seat/usage forecast, optional assumptions; upload drop zone. Save draft without documents. |
| Document Intelligence | Split viewer: original page/sheet at left, extracted claim cards at right. Clicking claim highlights exact source. Approve/edit/reject controls with unit/date fields; batch approve only clear claims. |
| Financial Model | Assumptions grid with source/status chips; annual cost table; category totals; formula drawer shows rule, effective interval and dependency path. User edits create a proposed revision. |
| Comparison | Vendor columns, annual stacked bars, cumulative line, category gap table, comparability banner, scenario controls and switching-value panel. Ranking says `provisional` or `cannot determine` when warranted. |
| Revision Intelligence | Old/new passages side by side, proposed changes, impact preview, approve controls, old/new model versions, numerical bridge and timeline. Previous version remains one click away. |
| Decision Report | Cost result, limitations, approved assumptions, material unknowns, sensitivity, source references and export. Separate lowest modeled cost from overall decision. |
| Model Intelligence | Model/version banner, contextual question field, suggested questions, answer cards, evidence rail and a dependency explorer. A chart bar, table cell, assumption, formula or result can open this view with its ID preselected. Show an operation preview before any what-if execution; show candidate anomaly status and rule. Executive/analyst/reviewer narrative modes share the same evidence. |

An answer card contains a direct answer, scope (model version, vendor, year, currency), calculation/reasoning steps from deterministic tools, and a numbered evidence list. Clicking an annual result highlights the matching model table; clicking an assumption opens its reviewed revision; clicking a source passage opens Documents at the original page/cell. `Depends on` is the graph label; `change attributed to` appears only for a reconciled before/after bridge. If Muse is unavailable, deterministic inspection and result explanations remain usable and the question field explicitly reports the provider requirement. An imported workbook has a separate `unsupported/unverified` state rather than appearing as a native model.

## Core interactions

The important demo path is Documents → Review → Compare → Revision → Impact → Report. A click on a changed TCO value opens `year/category → formula → approved assumption → claim → highlighted source`. A natural-language scenario appears as an editable operation card (`Increase seat count by 30% across years 2–5`) before calculation. A `missing implementation cost` warning offers `supply value` or `mark unknown`; it never offers a default zero disguised as fact.

## Visual system

Use a restrained dark navy or warm charcoal surface with light content cards, strong typographic hierarchy, tabular numerals, and color-safe status indicators. One accent color marks actions; vendor colors stay consistent across charts and tables. Green/red alone must never encode pass/fail. Money has explicit currency, sign, date horizon and rounding. Tables support sticky labels, keyboard navigation and readable empty/error/loading states. Chart tooltips show exact underlying values and category definitions; every chart has a corresponding table. Motion is limited to transitions that clarify a model change.

Reusable components: AppShell, ProjectHeader, StatusBadge, CurrencyValue, SourceAnchor, DocumentViewer, ClaimCard, AssumptionGrid, CostTable, CostChart, ComparisonGap, ScenarioOperation, RevisionDiff, ImpactBridge, FormulaTrace, ReviewAction, AuditTimeline and ExportStatus. Build actual data flows before visual polish; no placeholder charts or fake activity.

Accessibility: semantic headings and tables, visible keyboard focus, labelled file input and review controls, accessible chart alternatives, sufficient contrast, and screen-reader announcements when jobs finish or model versions change.
