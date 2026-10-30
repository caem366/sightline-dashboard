# Sightline — Financial Decision Workspace

A local application for comparing software proposals from reviewed source terms. Upload fictional PDF or XLSX proposals, inspect the page or cell evidence, approve financial assumptions, calculate five-year costs, test scenarios, review amendments, and export an editable Excel model.

The Sightline interface and desktop/mobile screenshot review are documented in [`docs/REDESIGN.md`](docs/REDESIGN.md).

## Run

Requires Node 24 and npm. From this directory:

```powershell
npm ci
npx playwright install chromium
npm run dev
```

Open `http://127.0.0.1:5173`. The Vite client proxies `/api` to the Express server at `http://127.0.0.1:4310`. For a single-server build, use `npm run build` and `npm start`, then open port 4310. `GET /api/health` reports the server and Muse configuration state. `npm test` runs unit, API, and Playwright tests. Originals, page images, exports, and SQLite data stay in the ignored `data/` directory. The app binds to loopback only.

## Muse

Set `BASETEN_API_KEY` in the server process to enable live extraction and scenario interpretation. `BASETEN_MODEL_ID` defaults to `meta-models/muse-spark-open-1026`; change it if your Baseten assignment uses another Muse ID. The server sends proposal text and rendered PDF pages to Baseten. Use fictional documents unless you have separately approved provider processing of confidential proposals. Without credentials, uploads and manual source-linked review still work; the UI states that Muse is unavailable. Muse proposes terms only. A user must approve or edit every claim before the deterministic model uses it.

## Workflow

1. Open an analysis from **Workspace** or create one with its name and purpose. In **Model**, set currency, horizon, seats, usage, and growth before approving the first term. Published baselines are locked to preserve historical versions; use **Comparison** for what-if scenarios. Add at least two vendors on Overview.
2. Upload each vendor's proposal on **Sources**. Review source passages and proposed claims. A manual claim can be created from an exact excerpt if Muse is unavailable or misses a term.
3. Approve, edit, or reject claims. Add explicit user inputs for costs that a proposal omits. Each approval publishes a new immutable model version.
4. Inspect and revise approved terms on **Assumptions**. **Model** shows category-by-year costs and a cumulative vendor chart. **Comparison** shows a firm lowest-cost ranking only when vendors have comparable known costs and currency. Run a scenario without changing the baseline.
5. Upload an amendment using **Revise** for the original document. Inspect changed passages, preview a claim's model impact, and approve the new term. **Revisions** shows the version bridge; old models remain selectable.
6. Use **Report** to export an XLSX with editable inputs, monthly and annual formulas, comparison totals, scenario results, and source references. On Windows with Excel, the server attempts an independent recalculation before marking an export verified. If Excel is unavailable or recalculation differs, it marks the export unverified.

## Model Intelligence

Open **Insights** from the project tabs, report, or a cost cell or chart point. The view binds to the selected immutable model version. It reconciles an annual result against rounded charge lines, displays rule and assumption dependencies, and links document-derived inputs to their original passage. Candidate findings identify missing costs and annual changes above 25% without calling them confirmed errors. The inspection and explanation views work without Muse. With Baseten access, Muse classifies a natural-language question into a fixed read-only intent; the server constructs the answer from stored results and deterministic tools. For an executive narrative, Muse selects from server-calculated evidence facts and the server renders the selected facts with links; arbitrary model-written numerical prose is not trusted. A what-if question returns a reviewable operation before the user runs the scenario.

The native-model implementation is covered by unit, HTTP, and Playwright tests. A live question probe against the fictional amendment model returned Baseten HTTP 403, so live Muse Q&A is **unverified** even though the earlier live extraction and scenario interpretation succeeded. The plan and separate research gate for arbitrary imported Excel models are in [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Verification and limits

`npm run build` and `npm test` pass. Tests include an HTTP workflow with two fictional vendors and an amendment, a Playwright workflow, arithmetic/property checks, source validation, and workbook structure. A live Muse run through `scripts/live-fixture.ts` extracted terms from two fictional PDFs and an amendment. After explicit fixture review, the model changed from CAD 61,000 vs CAD 62,000 to CAD 74,261.20 vs CAD 62,000. Muse marked two source-matched claims as ambiguous, which the review step preserved and resolved. A separate live scenario interpretation succeeded. The fictional amendment workbook was recalculated in Excel: CAD 74,261.20 and CAD 62,000, matching the server's two vendor totals. Run the repeatable fictional probe with `node --env-file=.env.local --import tsx scripts/live-fixture.ts` after placing a local Baseten key in the ignored `.env.local` file.

The supported input slice is text PDFs and ordinary XLSX cells. OCR, complex spreadsheets, production identity, multiuser access, cross-currency FX, and real proposal confidentiality controls are not implemented. ROI, NPV, and year-end payback appear in the report only when a vendor has explicit annual benefit coverage for every analysis year and one user-supplied discount rate. The model discounts year-end net cash flows; it does not infer benefits from proposals. Scenario rows in exported workbooks show saved results and delta formulas; changing baseline Inputs does not recompute those saved scenario results. Benefit metrics are reported in the app and are not included in the Excel cost workbook.

The eight files in [`docs/`](docs/) contain the approved product and engineering specification. Implementation details that differ from the initial library and directory suggestions are recorded in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
