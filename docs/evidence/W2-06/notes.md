# W2-06 — Funding sources and uses (FIN-06)

**Personas:** preparer (Infinia Deal Lead), analyst (Sirius CIO)
**Feature covered:** the funding sources and uses table. Each source is captured
with an amount, its percentage of total sources and a status (secured /
committed / indicative); each use carries an amount. The plan must reconcile —
sources equal uses — and Sirius capital, the ask, is drawn last, after the
cheaper sources (internal accruals, subsidiary debt, partner / co-investor).
An imbalance and an early Sirius draw both raise an advisory flag with a message
rather than discarding the capture, matching the financials workstream's
flag-don't-block pattern. The same figures, percentages, statuses and the
balance note flow through to the generated Sirius Part B memo.

## Shots

| File | Persona | What it proves |
|------|---------|----------------|
| preparer_sources_uses_balanced.png | preparer (Infinia Deal Lead) | The 5a Funding sources and uses table on a reconciled fixture: two secured cheaper sources (internal accruals 35, subsidiary debt 40) plus the committed Sirius ask (70 AED mn, 48.3%), and four uses totalling 145. Sources = uses shows the green state and the card reads Total sources 145 / Total uses 145 / Difference 0 (FIN-06: sources = uses; Sirius shown as the ask). |
| preparer_sources_uses_hierarchy_flag.png | preparer (Infinia Deal Lead) | A plan where Sirius capital is secured while the cheaper subsidiary debt is still only indicative: the amber 'Sirius capital drawn early' warning fires with the funding-hierarchy message, yet the plan still reconciles (6 = 6) and submits — an advisory flag, not a block (FIN-06 accept criterion: warning if Sirius capital is used ahead of cheaper sources). |
| analyst_memo_sources_uses.png | analyst (Sirius CIO) | The captured plan flows into the generated Sirius Part B memo (section 5): the funding table lists each source with AED mn, % and status plus the totals row, the uses table lists the four uses with the total, and the note reads 'Sources equal uses' under the tables (FIN-06). |

## How it works

server/config/sourcesUses.js is the pure source of truth. FUNDING_STATUSES
orders the three statuses by strength (secured rank 3, committed rank 2,
indicative rank 1) so 'secured' is the only status that counts as funded.
SOURCE_ROWS fixes the funding-hierarchy order — subsidiary internal accruals
(rank 1) and subsidiary debt (rank 2) are cheaper than partner capital (rank 3)
and Sirius capital (rank 4) — and USE_ROWS fixes the four use categories.
evaluateSourcesUses() reads the nested funding_plan block, resolves each source
to a finite amount, a percentage (explicit or derived from the total sources)
and a validated status, resolves the uses, and computes the totals, the
difference and the difference as a percentage of the larger side. Because a
small rounding gap in the underlying model should not read as an imbalance, the
plan counts as balanced when the difference is within BALANCE_TOLERANCE_PCT
(default 1%, overridable with SOURCES_USES_TOLERANCE_PCT). The hierarchy check
warns only when Sirius capital is actually drawn (secured or committed) while a
cheaper source that is also drawn is still only indicative — an unused source
category is not a violation. The function returns the rows, totals, balance,
the Sirius ask and a flags list (sources_not_uses, funding_hierarchy,
invalid_status) with a human message. This module is the single place the gate,
the capture form and the Sirius memo all read, so a figure can never disagree
between them.

server/gate.js resolves sources_uses on evaluateGate and attaches it to the gate
result, and exposes the source rows, use rows, statuses and tolerance on
GET /api/gate/fields. server/config/siriusMemo.js builds the memo funding tables
from the same plan — each source row with AED mn, %, status, the totals row, the
uses table and a note that reads 'Sources equal uses' (or the first imbalance /
hierarchy message). src/pages/SubmitOpportunity.jsx renders the 5a card
(data-testid sources-uses-card; sources-uses-status, source-row-<k>,
source-aed-<k>, source-pct-<k>, source-status-<k>, use-row-<k>, use-aed-<k>,
sources-uses-total-sources, sources-uses-total-uses, sources-uses-difference,
sources-uses-flag, sources-uses-hierarchy-flag, sources-uses-ok) and writes the
nested funding_plan block back on save. src/components/pipeline/SiriusMemoDialog.jsx
renders the fundingTables section (data-testid memo-funding-tables).

## Reproduce

    docker compose -p dealforge-demo -f docker-compose.demo.yml up --build
    BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W2-06

Tests: server/tests/sourcesUses.test.js (10 pass) plus the FIN-06 integration
cases in server/tests/m2.test.js (config exposes the source/use/status options;
a balanced plan reconciles with no imbalance flag; an imbalanced plan flags
sources_not_uses without blocking; Sirius secured ahead of a cheaper indicative
source flags the hierarchy; no flag when cheaper sources are secured first) and
the memo funding cases in server/tests/siriusMemo.test.js.
