# W9-06 — Browser / device SIT (BRD NFR-06)

Requirement: **NFR-06** — the SPA works on the latest two versions of Chrome,
Edge and Safari plus a tablet.

## What was done

- **Reproducible SIT.** `scripts/browser_sit.mjs` signs in, then drives the core
  journeys (Dashboard, Deal Pipeline, Screening Board, Settings) through real
  Playwright browsers at each device profile, capturing page errors and console
  errors. It writes a per-profile report and **exits non-zero when any tested
  profile fails to render a journey or throws a page error**, so the SIT can gate
  a release. It can also save a screenshot per profile as visual evidence
  (`--shots=<dir>`).
- **Shared matrix.** `server/config/browserSupport.js` holds the NFR-06 support
  matrix (Chrome, Edge, Safari, together with the desktop and tablet viewport
  profiles) and the pure `evaluateBrowserSit` gate, unit-tested independently of
  any browser.

## Result

| Profile | Engine | Viewport | Verdict |
|---|---|---|---|
| chrome_desktop | Chromium | 1440×900 | PASS |
| edge_desktop | Chromium | 1280×800 | PASS |
| tablet_ipad | Chromium | 820×1180 (mobile, touch) | PASS |
| safari_desktop | WebKit | 1440×900 | **external** |

Every tested profile rendered all four journeys with no page errors.

## Honest scope

- Chrome and Edge share the Chromium engine, so the two Chromium profiles cover
  both browsers' rendering. A second *current build* of each (the "latest 2"
  versions) is Chrome/Edge update-channel coverage and is recorded as external.
- **Safari / WebKit is not installable in this environment** (no WebKit browser
  binary is available and the network install is out of scope here). It is
  recorded as an **external gap**, not claimed as tested. Running this harness on
  a machine with the Playwright WebKit or Safari browser would close it.

## Evidence

- `docs/evidence/W9-06/browser_sit_report.json` — per-profile journey results
  and the gate verdict.
- `docs/evidence/W9-06/*_deal_pipeline.png` — the Deal Pipeline rendered at each
  tested profile (chrome, edge, tablet).

## Tests

- `server/tests/browserSupport.test.js` — 5 pass: the matrix, Safari recorded as
  external, an all-pass run, a failing run and an empty run.
