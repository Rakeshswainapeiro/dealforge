# W1-03 — Six-section Opportunity Overview with per-section progress

**Persona:** preparer (Infinia Deal Lead, `deal.lead@infinia.local`)
**Feature covered:** the six-section capture form and its per-section completion
indicator, driven entirely by `server/config/intakeConfig.js`.

## Shot

| File | What it proves |
|------|----------------|
| `preparer_six_section_form.png` | The selected fixture shows the ordered sections (Header §3.1, 1. Executive summary …) each with a completion indicator — Header 12/12 (100%), Executive summary 3/3 (100%) — plus the field-level present indicators. |

## How it works

`GET /api/gate/fields` serves `sectionsWithFields()` (config order + fields). The
form renders each section header with `sectionProgress` from the gate status, so the
indicator tracks the model rather than a hard-coded list. `GET
/api/gate/opportunities/:id/status` returns `gate.sections` (present/total/progress).

## Fix captured with this row

The form read a non-existent `group.section` (the model exposes `key`), so the
section titles fell back to labels and the progress lookup was always empty. Now
`group.key` is used, which also restores the checklist grouping by section.

## Reproduce

```
BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W1-03
```

## Tests

`server/tests/intake.test.js` (9 pass) covers the model; commit `064caee`.
