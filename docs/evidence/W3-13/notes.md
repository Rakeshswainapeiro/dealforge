# W3-13 - Per-dimension theme alignment with cited strategy passage (SCR-02)

## What this delivers

Theme alignment is no longer a single pass/fail. Each screening now grades the
four mandate dimensions - **Sector**, **Geography**, **Focus areas** (theme
keywords) and **Size band** - as **Aligned**, **Partly** or **Not aligned**, and
each verdict carries a rationale. Where the owning entity has an indexed strategy
corpus, the matched dimensions quote the source passage the verdict rests on
(document name plus the passage text), so a reviewer can audit why the call was
made. The screening panel's alignment check surfaces those citations as evidence
refs and appends the first source quote to its rationale.

## Evidence

| Persona | Feature | Screenshot | What it shows |
| --- | --- | --- | --- |
| Analyst (Sirius CIO) | Alignment passage citations | analyst_alignment_passage_citations.png | The screening panel for Vision Care Imaging Platform: the **Theme alignment by dimension** block grading Sector / Geography / Focus areas / Size band, each with its verdict chip and the **Source:** line quoting the Infinia Technology Strategy 2026 passage. |

## How it works

1. server/config/strategyIndex.js - the passage ranker now carries `document_id`
   and `document_name` through from the tagged passages so a ranked hit can name
   its document.
2. server/themes.js - `evaluateAlignment(opportunity, { orgId, strategy })`
   builds a `dimensions` array (keys `sector`, `geography`, `keywords`, `size`);
   each entry is `{ key, label, verdict, rationale, citation }` where `citation`
   quotes the top-ranked strategy passage for that dimension (a local `cite`
   helper over `strategy.passages`). It also returns `dimension_summary`
   (aligned / partly / not_aligned / cited counts).
3. server/pipeline.js - the `/alignment` route loads `loadStrategyCorpus` for the
   owning org and passes `strategy` into `evaluateAlignment`.
4. server/config/screeningPanel.js - `alignmentCheck` adds a `strategy_citation`
   evidence ref per cited dimension and appends `Source: <document> - "<passage>"`
   to the check rationale.
5. src/pages/ScreeningBoard.jsx - renders the **Theme alignment by dimension**
   block (data-testid="alignment-dimensions", "alignment-dimension-<key>",
   "alignment-dimension-verdict-<key>", "alignment-dimension-citation-<key>").

## Validation

- BASE_URL=http://localhost:34099 npm run test:server - 564 pass / 131 suites,
  including four W3-13 integration cases: alignment returns a graded verdict and
  rationale for every dimension plus the summary buckets; an in-theme deal cites
  the Infinia strategy document on its matched dimensions; an off-theme deal
  grades the mismatched dimensions as partly / not aligned; and the screening
  panel alignment check quotes a source passage and surfaces the citations as
  evidence refs.
- npm run build and eslint clean on the touched files.
- Live check: GET /api/pipeline/opportunities/:id/alignment for an in-theme deal
  returns dimension_summary { aligned: 4, cited: 3 } with three citations naming
  "Infinia Technology Strategy 2026.txt".

## Notes

Fixtures: the seeded Infinia strategy corpus (Infinia Technology Strategy 2026,
6 passages) backs the citations. Evidence captured against the demo stack at
http://localhost:34010 from the mvp seed profile.
