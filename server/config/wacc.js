// ---------------------------------------------------------------------------
// Weighted average cost of capital (W2-05 / FIN-05).
//
// Source of truth: the Phase-1 BRD, Financials & Returns — "WACC input per
// entity (Sirius-set) plus per-opportunity override with reason", accept
// criterion "Default by entity; override requires reason."
//
// The entity default is held on the mandate threshold row for the owning org
// (mandate_threshold.wacc_pct, falling back to the global row and then the
// shipped default) so Sirius sets the cost of capital once per entity and every
// opportunity inherits it. A preparer may override it for a specific deal, but
// only with a reason: an override without a reason is flagged rather than
// applied silently. The ROIC hurdle is expressed as WACC + a spread (FIN-04);
// this module supplies the WACC side of that comparison.
//
// Pure functions only — no database, no network. See resolveWacc().
// ---------------------------------------------------------------------------

// The shipped default cost of capital, used when no entity value is configured.
// Environment-overridable so a deployment can set the house rate without a
// code change (REQ-RULE-10).
export const WACC_DEFAULT_PCT = (() => {
  const raw = Number(process.env.WACC_DEFAULT_PCT);
  return Number.isFinite(raw) && raw >= 0 ? raw : 8;
})();

export const WACC_OVERRIDE_FIELD = 'wacc_override_pct';
export const WACC_OVERRIDE_REASON_FIELD = 'wacc_override_reason';
export const WACC_OVERRIDE_REASON_MESSAGE =
  'A WACC override requires a reason: explain why the cost of capital differs from the entity default.';

function num(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function blank(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

// Resolve the effective WACC for an opportunity. `orgWacc` is the owning
// entity's configured value (or null when none is set). Returns the effective
// rate, its source, and whether an override was applied with a reason.
export function resolveWacc(data = {}, { orgWacc = null } = {}) {
  const entityWacc = num(orgWacc);
  const defaultWacc = entityWacc !== null ? entityWacc : WACC_DEFAULT_PCT;
  const override = num(data[WACC_OVERRIDE_FIELD]);
  const reason = blank(data[WACC_OVERRIDE_REASON_FIELD]) ? null : String(data[WACC_OVERRIDE_REASON_FIELD]).trim();
  const hasOverride = override !== null;
  const overrideReasonPresent = reason !== null;
  const overrideValid = !hasOverride || overrideReasonPresent;
  const effective = hasOverride ? override : defaultWacc;
  const source = hasOverride ? 'opportunity_override' : (entityWacc !== null ? 'entity_default' : 'system_default');

  let message;
  if (hasOverride && !overrideReasonPresent) message = WACC_OVERRIDE_REASON_MESSAGE;
  else if (hasOverride) message = 'WACC override of ' + effective + '% applied (' + reason + ').';
  else message = 'Using the entity WACC of ' + effective + '% (' + source + ').';

  return {
    applies: true,
    entity_wacc: entityWacc,
    system_default: WACC_DEFAULT_PCT,
    default_wacc: defaultWacc,
    override_wacc: override,
    override_reason: reason,
    has_override: hasOverride,
    override_reason_present: overrideReasonPresent,
    override_valid: overrideValid,
    effective_wacc: effective,
    source,
    message,
  };
}

// Compare a return (e.g. base-case ROIC) against WACC + the configured spread.
// Returns null when either input is missing, so a caller can show a placeholder
// rather than a fabricated verdict.
export function meetsWaccSpread(roicPct, waccPct, spreadPpts) {
  const roic = num(roicPct);
  const wacc = num(waccPct);
  const spread = num(spreadPpts);
  if (roic === null || wacc === null || spread === null) return null;
  const hurdle = wacc + spread;
  return { hurdle, meets: roic >= hurdle, roic, wacc, spread };
}

export default {
  WACC_DEFAULT_PCT, WACC_OVERRIDE_FIELD, WACC_OVERRIDE_REASON_FIELD,
  WACC_OVERRIDE_REASON_MESSAGE, resolveWacc, meetsWaccSpread,
};
