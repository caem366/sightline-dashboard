# SIGHTLINE reference-led interface

The attached UI reference is the primary visual specification for this iteration. The application now uses a warm white canvas, a compact light sidebar, understated sans-serif headings, fine grey dividers, small controls, charcoal primary actions, and restrained SIGHTLINE symbol use. The sidebar collapses on desktop and opens as a menu on mobile.

## Workflow

- Workspace opens to real analyses in a compact card grid. Search filters the list. New analysis asks only for identity and purpose.
- An analysis uses a compact title bar and eight working tabs: Overview, Sources, Assumptions, Model, Comparison, Insights, Revisions, and Report.
- Sources retains document versions, rendered passages, and the review queue. Assumptions isolates approved inputs and revisions from the model view.
- Model leads with category-by-year costs for the selected vendor and a cumulative vendor trend. The table uses server result lines; the trend accumulates server yearly totals with Decimal. Selecting a total or chart point opens the version-bound inspection view. Published configuration remains inspectable beneath the model.
- Comparison retains scenarios, switching values, and the detailed annual vendor table. Insights, revisions, and report retain their working data and actions.

The reference includes sharing controls and three-vendor example data. Those are absent from this local single-user application; this build does not present them as working features.

## Screenshot review

Playwright captured the running application at 1440 × 900 and 390 × 844 using fictional proposal data. Every captured mobile page passed a page-level horizontal overflow assertion. Tables scroll within their own regions.

| Screen | Desktop | Mobile |
|---|---|---|
| Workspace | [Desktop](screenshots/workspace-desktop.png) | [Mobile](screenshots/workspace-mobile.png) |
| New analysis | [Desktop](screenshots/create-desktop.png) | [Mobile](screenshots/create-mobile.png) |
| Overview | [Desktop](screenshots/overview-desktop.png) | [Mobile](screenshots/overview-mobile.png) |
| Sources | [Desktop](screenshots/documents-desktop.png) | [Mobile](screenshots/documents-mobile.png) |
| Assumptions | [Desktop](screenshots/assumptions-desktop.png) | [Mobile](screenshots/assumptions-mobile.png) |
| Model | [Desktop](screenshots/model-desktop.png) | [Mobile](screenshots/model-mobile.png) |
| Comparison | [Desktop](screenshots/comparison-desktop.png) | [Mobile](screenshots/comparison-mobile.png) |
| Scenario result | [Desktop](screenshots/scenario-desktop.png) | [Mobile](screenshots/scenario-mobile.png) |
| Insights | [Desktop](screenshots/intelligence-desktop.png) | [Mobile](screenshots/intelligence-mobile.png) |
| Revisions | [Desktop](screenshots/revisions-desktop.png) | [Mobile](screenshots/revisions-mobile.png) |
| Report | [Desktop](screenshots/report-desktop.png) | [Mobile](screenshots/report-mobile.png) |

## Verification and limits

`npm run build` passes. `npm test` passes 20 tests, including the browser workflow, sidebar collapse and mobile menu, source review, model cost category display, evidence navigation, scenario calculation, and report. The UI keeps keyboard focus styles and clickable chart points with keyboard activation. A full accessibility audit was not run.

The screenshot fixture contains two fictional vendors. It does not recreate the reference image's illustrative values. Muse-dependent questions still require provider access; the earlier live Model Intelligence probe returned HTTP 403.