# Phase 1 AI evidence: extraction, research, comparison, calculations, recommendation

Sirius Investment Team only. Every route below sits behind the same guard as `/api/ai-review`
(`canSeeInternalAssessment`); a Preparer gets 403, and the stored rows are `AIReviewResult`
(kinds `extraction`, `financials`, `research`, `comparison`, `narrative`, tab `__opp__`), which the
entity API refuses to anyone but Sirius. The submission form, tabs, fields, uploads and workflow are unchanged.

## What was built

| Area | Where | Notes |
|---|---|---|
| PDF / DOCX / PPTX text and tables | `server/documentExtract.js` | PDF via `unpdf` (pdf.js); DOCX and PPTX via `jszip` + XML (tables, slide text, speaker notes). Never throws; returns a status (`ok`, `ocr`, `empty`, `unsupported`, `unreadable`, `ocr_unavailable`). |
| OCR | same file | Scanned PDF pages (no text layer) and images (png/jpg/tif/bmp/webp) via `tesseract.js`. Confidence recorded; under 60% is flagged. Language data is cached outside the repo (`OCR_CACHE_PATH`); `OCR_LANG_PATH` keeps it offline; `OCR_LANGS=eng+ara`. |
| Mapping to tabs | `server/config/documentFacts.js` | Labelled figures (revenue, EBITDA, employees, founded, IRR, ROIC, payback, MOIC, exit multiple, valuation, commitment, ask) are mapped to form fields and tabs with the verbatim line as evidence. Document slot -> tab. A document that reads like another slot is flagged. |
| Web research | `server/webResearch.js`, `server/config/researchParameters.js` | Tavily or Brave Search. Governed: provider approval gate (`tavily`, `brave_search` added to the AI governance register, pending), timeout, call log, key scrubbing. Only target name, sector and geography are put in a query. |
| Comparison | `server/config/comparison.js` | Documents vs form, unsupported claims (each figure checked as a whole number), missing information, risks, financial tie-outs; optional model pass that must cite real sources. Grouped per tab. |
| Financial engine | `server/config/financialEngine.js` | IRR, MOIC, payback, ROIC; base / upside / downside; survivable-downside test; P&L, balance sheet, cash-flow and cross-statement integrity; hurdles via the existing `computeHurdles` and mandate thresholds. |
| Recommendation | `enhanceRecommendation` in `server/config/aiRecommendation.js` | Rating still comes from the rules. Evidence can only add caution (Go -> Conditional Go) with cited reasons and conditions; it cannot raise a rating or create a No-Go. Optional model rationale is accepted only if it cites listed reasons. |
| Orchestration and API | `server/aiEvidence.js` | `GET /api/ai-review/opportunities/:id/evidence`, `POST .../evidence/run`, `GET/PUT /api/ai-review/engine-config` (PUT admin). Runs automatically after submission (extraction, financials, research, comparison); a re-run after the Preparer answers skips paid research. |
| UI | `src/components/review/EvidencePanel.jsx` | Per-tab evidence card, overview card, evidence reasons in the recommendation card. Each item is badged Verified / AI inference / Missing. |

## Evidence classes
- **Verified**: a quote found verbatim in a returned source or a submitted document, or a calculation from submitted numbers.
- **AI inference**: a model's reading of sources it was given. Cited, never presented as verified.
- **Missing**: nothing found, unreadable, or not researched. Listed so the gap is visible.
A finding that cites a source that was not returned is dropped. Without a provider or a model nothing is invented; the source excerpt itself is shown.

## Configuration
`RESEARCH_PROVIDER` (`tavily` | `brave`), `RESEARCH_API_KEY`, optional `RESEARCH_BASE_URL`, `RESEARCH_TIMEOUT_MS`;
`OCR_LANGS`, `OCR_LANG_PATH`, `OCR_CACHE_PATH`, `OCR_MAX_PAGES`, `EXTRACT_MAX_PAGES`, `EXTRACT_MAX_BYTES`.
The search provider must also be approved in Settings > AI Governance. Hurdles stay in the mandate thresholds;
scenario flexes, tax rate and ROIC year are stored via `PUT /api/ai-review/engine-config` (admin).

## Needs Sirius confirmation (not fabricated, but not known)
1. **Research search terms.** The nine parameters are the ones in the requirement (business and market, strategic fit, management, financial performance, quality of earnings, risks, governance, subsidiary value, synergies). Their search terms and tab placement are my proposal; Sirius should review them. Editable through `engine-config` (label, terms, on/off).
2. **Calculation basis.** IRR is deal-level on a 100% basis (cash out = total commitment; cash in = FCF Y1-Y5 + exit multiple x Y5 EBITDA). Sirius's stake, fees and financing are not modelled, so it approximates Equity IRR and often differs from the Preparer's typed figures (reported as discrepancies on the base case). Confirm or supply the preferred method.
3. **Scenario sensitivities.** Upside +10% EBITDA, downside -25% EBITDA and -1x exit multiple, tax 9%, ROIC at Y3 are starting values.

## Limits
- Web research and the model passes were verified with stand-in providers; no live Tavily/Brave key or approved model was available, so those two live calls are untested.
- PDF tables are recovered from text positions; complex layouts may be read as text only. Pictures inside DOCX/PPTX are not OCR'd.
- Statement integrity runs on a financials/returns file whose table headers use the model period names (FY-3 A ... Y5 P); other layouts are reported "not checkable", never passed.
- Search queries leave the platform to the search provider: approve it (and residency) before enabling.
