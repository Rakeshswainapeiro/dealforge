# Per-TODO screenshot evidence

Backlog task **W1-13** makes evidence a condition of Done. A tracker row is only marked `Done` once its evidence exists here. Anything without evidence stays `In progress`.

## Layout

```
docs/evidence/
  <TODO-ID>/                 e.g. W1-03
    <persona>_<feature>.png  e.g. preparer_six_section_form.png
    notes.md                 optional: how to reproduce, commit, test command
```

`<TODO-ID>` matches the tracker Backlog column A. `<persona>` is one of the journey personas in `docs/UAT_Validation_DealForge.docx` (`preparer`, `ceo`, `cfo`, `analyst`, `vertical_head`, `reviewer`, `cio`, `admin`, `leadership`). `<feature>` is the acceptance criterion the shot proves.

## Capture convention

Take shots against the demo stack (`docker compose -f docker-compose.demo.yml up`, `http://localhost:34010`) using the seeded fixtures in `docs/sample-data/MVP_Sample_Data_Map.md`, so a screenshot always points at a known record. Log in as the persona named in the file rather than as admin, so the shot shows the role's real view. Name the file after the persona and feature, not the date, so re-captures overwrite cleanly.

## What a shot must show

The screen that proves the acceptance criterion, with the persona's identity and the fixture visible — for example the six-section form with the section progress indicator for W1-03, or the block message for a below-floor submission. A screenshot that only shows a green test run belongs in the commit message, not here.

## Status

W1-01 to W1-13, W2-01 to W2-10, W3-01 to W3-13, W4-01 to W4-04, W5-01 to W5-05 and W6-01 to W6-05 carry shots and are marked **Done** in the tracker. Every Done row in the backlog currently has evidence; new rows stay **In progress** until their shots exist.

Capture with `scripts/capture_evidence.mjs` (against the demo stack, `BASE=http://localhost:34010`) and render the contact sheet with `scripts/generate_evidence_index.mjs`.
