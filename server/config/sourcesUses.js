// ---------------------------------------------------------------------------
// Funding sources and uses (W2-06 / FIN-06, REQ-FIN-06).
//
// Source of truth: the Phase-1 BRD, Financials & Returns — "Funding sources and
// uses". Sources (internal accruals, subsidiary debt, partner / co-investor,
// Sirius capital) carry an amount, a percentage and a status (secured /
// committed / indicative); uses (purchase price / capex, transaction costs,
// working capital, contingency). Accept criteria: "Sources must equal uses.
// Sirius capital shown as the ask. Warning if Sirius capital is used ahead of
// cheaper sources (funding hierarchy)."
//
// The capture is a nested `funding_plan` block on the opportunity
// ({ sources: [{key,aed,pct,status}], uses: [{key,aed}] }) so it renders as a
// two-column table rather than a long list of flat fields. This module is the
// single place that turns that block into the totals, the balance check and the
// hierarchy signal the gate, the form and the Sirius memo all read.
//
// Pure functions only — no database, no network. See evaluateSourcesUses().
// ---------------------------------------------------------------------------

// The three statuses a source may carry, strongest last. A source that is not
// yet secured may not be counted as funded.
export const FUNDING_STATUSES = [
  { value: 'secured', label: 'Secured', rank: 3 },
  { value: 'committed', label: 'Committed', rank: 2 },
  { value: 'indicative', label: 'Indicative', rank: 1 },
];

export const FUNDING_STATUS_VALUES = FUNDING_STATUSES.map((s) => s.value);

// Funding-hierarchy rank: cheaper sources are exhausted before more expensive
// money is drawn, so Sirius capital (the ask) is last. `rank` orders the
// hierarchy; `cost` is a human label used in the warning.
export const SOURCE_ROWS = [
  { key: 'subsidiary_accruals', label: 'Subsidiary internal accruals', rank: 1, cost: 'internal accruals' },
  { key: 'subsidiary_debt', label: 'Subsidiary debt', rank: 2, cost: 'subsidiary debt' },
  { key: 'partner_co_investor', label: 'Partner / co-investor', rank: 3, cost: 'partner capital' },
  { key: 'sirius_capital', label: 'Sirius capital (the ask)', rank: 4, cost: 'Sirius capital' },
];

export const SOURCE_KEYS = SOURCE_ROWS.map((s) => s.key);

export const USE_ROWS = [
  { key: 'purchase_price', label: 'Purchase price / capex' },
  { key: 'transaction_costs', label: 'Transaction costs' },
  { key: 'working_capital', label: 'Working capital' },
  { key: 'contingency', label: 'Contingency' },
];

export const USE_KEYS = USE_ROWS.map((u) => u.key);

// Sources and uses must reconcile to within this percentage of the larger side;
// small rounding in the underlying model should not read as an imbalance.
export const BALANCE_TOLERANCE_PCT = Number(process.env.SOURCES_USES_TOLERANCE_PCT || 1);

export const SOURCES_NOT_USES_MESSAGE =
  'Sources do not equal uses: the funding plan must reconcile before it is submitted.';
export const SIRIUS_HIERARCHY_MESSAGE =
  'Sirius capital is drawn ahead of cheaper sources: exhaust internal accruals, subsidiary debt and partner capital first.';

function num(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// Index a captured list ({ key, aed, pct, status }) by its row key.
function indexRows(list) {
  const map = new Map();
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (entry && entry.key) map.set(entry.key, entry);
    }
  } else if (list && typeof list === 'object') {
    for (const [key, entry] of Object.entries(list)) {
      map.set(key, { key, ...(entry && typeof entry === 'object' ? entry : { aed: entry }) });
    }
  }
  return map;
}

// Evaluate the funding plan: the source and use rows with their amounts and
// percentage of total sources, the sources = uses balance, and the funding-
// hierarchy signal. Advisory — an imbalance raises a flag and a message rather
// than discarding the capture (the financials workstream's flag-don't-discard
// pattern).
export function evaluateSourcesUses(data = {}, { tolerancePct = BALANCE_TOLERANCE_PCT } = {}) {
  const plan = data.funding_plan || {};
  const sourceMap = indexRows(plan.sources);
  const useMap = indexRows(plan.uses);

  const sourceAmounts = SOURCE_ROWS.map((s) => num(sourceMap.get(s.key)?.aed));
  const totalSources = sourceAmounts.reduce((sum, v) => sum + (v || 0), 0);
  const anySource = sourceAmounts.some((v) => v !== null && v !== 0);

  const sources = SOURCE_ROWS.map((s, i) => {
    const entry = sourceMap.get(s.key) || {};
    const amount = sourceAmounts[i];
    const explicitPct = num(entry.pct);
    const pct = explicitPct !== null
      ? explicitPct
      : amount !== null && totalSources > 0 ? round((amount / totalSources) * 100, 1) : null;
    const status = entry.status || '';
    return {
      key: s.key, label: s.label, rank: s.rank, cost: s.cost,
      aed: amount, pct,
      status: FUNDING_STATUS_VALUES.includes(status) ? status : status || '',
      status_valid: status === '' || FUNDING_STATUS_VALUES.includes(status),
      present: amount !== null && amount !== 0,
    };
  });

  const useAmounts = USE_ROWS.map((u) => num(useMap.get(u.key)?.aed));
  const totalUses = useAmounts.reduce((sum, v) => sum + (v || 0), 0);
  const anyUse = useAmounts.some((v) => v !== null && v !== 0);

  const uses = USE_ROWS.map((u, i) => ({
    key: u.key, label: u.label, aed: useAmounts[i], present: useAmounts[i] !== null && useAmounts[i] !== 0,
  }));

  const difference = round(totalSources - totalUses, 2);
  const larger = Math.max(Math.abs(totalSources), Math.abs(totalUses));
  const differencePct = larger > 0 ? round((Math.abs(difference) / larger) * 100, 2) : 0;
  const balanced = (anySource || anyUse) && differencePct <= tolerancePct;

  // Funding hierarchy: warn when Sirius capital is secured or committed while a
  // cheaper source is still only indicative or not yet captured, i.e. the ask is
  // drawn ahead of cheaper money.
  const sirius = sources.find((s) => s.key === 'sirius_capital');
  const siriusStatusRank = FUNDING_STATUSES.find((s) => s.value === sirius?.status)?.rank || 0;
  const cheaper = sources.filter((s) => s.rank < (sirius?.rank ?? 4));
  const cheaperAhead = [];
  if (sirius?.present && siriusStatusRank >= 2) {
    for (const c of cheaper) {
      const rank = FUNDING_STATUSES.find((s) => s.value === c.status)?.rank || 0;
      // Only a cheaper source that is actually drawn (present) but not yet
      // secured counts as being skipped; an unused source category is not.
      if (c.present && rank < 2) cheaperAhead.push(c.key);
    }
  }
  const hierarchyViolation = cheaperAhead.length > 0;

  const flags = [];
  if ((anySource || anyUse) && !balanced) {
    flags.push({
      reason: 'sources_not_uses', key: 'funding_plan',
      message: SOURCES_NOT_USES_MESSAGE,
      difference, difference_pct: differencePct,
    });
  }
  if (hierarchyViolation) {
    flags.push({
      reason: 'funding_hierarchy', key: 'funding_plan',
      ahead_of: cheaperAhead,
      message: SIRIUS_HIERARCHY_MESSAGE,
    });
  }
  for (const s of sources) {
    if (!s.status_valid) {
      flags.push({ reason: 'invalid_status', key: s.key, message: s.label + ' has an unknown funding status.' });
    }
  }

  const captured = anySource || anyUse;
  const messages = [];
  if (!captured) messages.push('Funding plan not captured.');
  else if (balanced) messages.push('Sources equal uses.');
  else messages.push(SOURCES_NOT_USES_MESSAGE);
  if (hierarchyViolation) messages.push(SIRIUS_HIERARCHY_MESSAGE);

  return {
    applies: true,
    captured,
    sources,
    uses,
    statuses: FUNDING_STATUSES.map((s) => ({ value: s.value, label: s.label })),
    total_sources: round(totalSources, 2),
    total_uses: round(totalUses, 2),
    difference,
    difference_pct: differencePct,
    tolerance_pct: tolerancePct,
    balanced,
    sirius_ask_aed: sirius?.present ? sirius.aed : null,
    hierarchy: {
      order: SOURCE_ROWS.map((s) => s.key),
      violation: hierarchyViolation,
      ahead_of: cheaperAhead,
      message: hierarchyViolation ? SIRIUS_HIERARCHY_MESSAGE : null,
    },
    flags,
    message: messages.join(' '),
  };
}

export default {
  FUNDING_STATUSES, FUNDING_STATUS_VALUES, SOURCE_ROWS, SOURCE_KEYS, USE_ROWS, USE_KEYS,
  BALANCE_TOLERANCE_PCT, SOURCES_NOT_USES_MESSAGE, SIRIUS_HIERARCHY_MESSAGE,
  evaluateSourcesUses,
};
