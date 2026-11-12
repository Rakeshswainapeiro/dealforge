// ---------------------------------------------------------------------------
// Risk register quality (advisory).
//
// The intake asks for "5-8 risks with named owners", and the memo asks for a
// mitigation against every risk, but the platform only ever checked that the
// field was not blank. This module reads the register and reports how many
// risks it lists and which are missing an owner, a severity or a mitigation.
//
// Pure: no database, no network, no model. It is advisory. It never blocks
// submission and it feeds nothing in the Go / No-Go logic. A register it cannot
// read is reported as `not_checkable`, never as a pass.
//
// The register arrives in one of three shapes, tried in this order:
//   1. data.risks          - an array of { risk, owner, severity | likelihood+impact, mitigation }
//   2. data.risk_register  - an array of the same, or free text such as
//        "1. Customer concentration (owner: Deal Lead). 2. FX - Owner: CFO - Mitigant: hedge - Severity: High"
// ---------------------------------------------------------------------------

export const RISK_REGISTER_MIN = 5;
export const RISK_REGISTER_MAX = 8;

const PLACEHOLDERS = new Set([
  '', '-', '--', '?', 'tbd', 'tba', 'tbc', 'n/a', 'na', 'none', 'nil', 'unknown', 'unassigned', 'pending',
  'to be confirmed', 'to be decided', 'to be assigned', 'not applicable', 'x',
]);

const SEVERITY_WORDS = new Set(['critical', 'high', 'medium', 'med', 'moderate', 'low', 'h', 'm', 'l']);

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').replace(/^[\s:;,\-–.]+|[\s:;,\-–.]+$/g, '').trim();
const isPlaceholder = (v) => PLACEHOLDERS.has(clean(v).toLowerCase());

// A named owner: not blank, not a placeholder, at least two characters.
export function hasNamedOwner(v) {
  const s = clean(v);
  return s.length >= 2 && !isPlaceholder(s);
}

export function hasMitigation(v) {
  const s = clean(v);
  return s.length >= 3 && !isPlaceholder(s);
}

// A severity word or a 1-5 score.
function validRating(v) {
  const s = clean(v).toLowerCase();
  if (SEVERITY_WORDS.has(s)) return true;
  return /^[1-5]$/.test(s);
}

// Severity is given directly, or derived from a likelihood and an impact.
export function hasSeverity({ severity, likelihood, impact } = {}) {
  if (validRating(severity)) return true;
  return validRating(likelihood) && validRating(impact);
}

const LABEL_WORDS = '(?:owner|severity|mitigation|mitigant|control|likelihood|impact|rating)';
const labelRe = (words) => new RegExp(
  `\\b(?:${words})\\s*(?:\\/\\s*control)?\\s*[:=]\\s*(.+?)(?=\\s*[\\-\\u2013;|,.(]?\\s*\\b${LABEL_WORDS}\\s*(?:\\/\\s*control)?\\s*[:=]|\\s*[;|\\n)]|$)`, 'i',
);
const OWNER_RE = labelRe('owner');
const SEVERITY_RE = labelRe('severity|rating');
const MITIGATION_RE = labelRe('mitigation|mitigant|control');
const LIKELIHOOD_RE = labelRe('likelihood');
const IMPACT_RE = labelRe('impact');
const pick = (re, s) => { const m = re.exec(s); return m ? clean(m[1]) : null; };

// Split free text into one chunk per risk. Numbered markers ("1." / "2)") win,
// even inline; otherwise one risk per non-empty line, bullets stripped.
function splitText(text) {
  const t = String(text).replace(/\r/g, '').trim();
  const numbered = t.split(/(?:^|\s)(?=\d{1,2}[.)]\s)/).map((s) => s.trim()).filter(Boolean);
  if (numbered.length >= 2) return numbered.map((s) => s.replace(/^\d{1,2}[.)]\s*/, ''));
  const lines = t.split('\n').map((s) => s.replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s*/, '').trim()).filter(Boolean);
  return lines;
}

function fromText(text) {
  const chunks = splitText(text);
  return chunks.map((chunk, i) => ({
    index: i + 1,
    text: clean(chunk.split(/\b(?:owner|severity|mitigation|mitigant|likelihood|impact)\s*[:=]/i)[0].replace(/\(\s*$/, '')) || clean(chunk),
    owner: pick(OWNER_RE, chunk),
    severity: pick(SEVERITY_RE, chunk),
    likelihood: pick(LIKELIHOOD_RE, chunk),
    impact: pick(IMPACT_RE, chunk),
    mitigation: pick(MITIGATION_RE, chunk),
  }));
}

function fromArray(list) {
  return list
    .filter((r) => r !== null && r !== undefined && !(typeof r === 'string' && r.trim() === ''))
    .map((r, i) => {
      if (typeof r === 'string') return fromText(r)[0] ? { ...fromText(r)[0], index: i + 1 } : { index: i + 1, text: clean(r) };
      return {
        index: i + 1,
        text: clean(r.risk ?? r.title ?? r.description ?? r.name ?? ''),
        owner: r.owner ?? r.risk_owner ?? null,
        severity: r.severity ?? r.rating ?? null,
        likelihood: r.likelihood ?? null,
        impact: r.impact ?? null,
        mitigation: r.mitigation ?? r.mitigant ?? r.control ?? null,
      };
    });
}

export function parseRiskRegister(data = {}) {
  if (Array.isArray(data.risks) && data.risks.some((r) => !blank(typeof r === 'string' ? r : JSON.stringify(r)))) {
    return { source: 'risks', risks: fromArray(data.risks) };
  }
  const reg = data.risk_register;
  if (Array.isArray(reg) && reg.length) return { source: 'risk_register', risks: fromArray(reg) };
  if (typeof reg === 'string' && reg.trim()) return { source: 'risk_register', risks: fromText(reg) };
  return { source: null, risks: [] };
}

const labelled = (r) => [r.owner, r.severity, r.likelihood, r.impact, r.mitigation].some((v) => !blank(v));

/**
 * Evaluate the register. Returns
 *   { status: 'pass' | 'review' | 'not_checkable', count, source, issues[], detail }
 * `issues` are short, specific sentences ("Risk 3: no named owner").
 */
export function evaluateRiskRegister(data = {}, { min = RISK_REGISTER_MIN, max = RISK_REGISTER_MAX } = {}) {
  const { source, risks } = parseRiskRegister(data);
  if (!source || risks.length === 0) {
    return { status: 'review', count: 0, source: null, issues: [], detail: 'No risk register is captured, so owners, severities and mitigations could not be checked.' };
  }
  // Free text with no recognisable structure: say so rather than guess.
  if (source === 'risk_register' && risks.length < 2 && !risks.some(labelled)) {
    return { status: 'not_checkable', count: risks.length, source, issues: [], detail: 'The risk register could not be read as a list of risks with owners, severities and mitigations, so it was not checked.' };
  }
  const issues = [];
  if (risks.length < min) issues.push(`${risks.length} risk${risks.length === 1 ? '' : 's'} listed; expected ${min}-${max}`);
  if (risks.length > max) issues.push(`${risks.length} risks listed; expected ${min}-${max}`);
  const missing = { owner: [], severity: [], mitigation: [] };
  for (const r of risks) {
    if (!hasNamedOwner(r.owner)) missing.owner.push(r.index);
    if (!hasSeverity(r)) missing.severity.push(r.index);
    if (!hasMitigation(r.mitigation)) missing.mitigation.push(r.index);
  }
  const list = (a) => a.slice(0, 8).join(', ') + (a.length > 8 ? ` and ${a.length - 8} more` : '');
  if (missing.owner.length) issues.push(`no named owner on risk ${list(missing.owner)}`);
  if (missing.severity.length) issues.push(`no severity (or likelihood and impact) on risk ${list(missing.severity)}`);
  if (missing.mitigation.length) issues.push(`no mitigation on risk ${list(missing.mitigation)}`);
  if (issues.length === 0) {
    return { status: 'pass', count: risks.length, source, issues, detail: `${risks.length} risks listed, each with a named owner, a severity and a mitigation.` };
  }
  return { status: 'review', count: risks.length, source, issues, detail: issues.join('; ') + '.' };
}

export default { RISK_REGISTER_MIN, RISK_REGISTER_MAX, hasNamedOwner, hasMitigation, hasSeverity, parseRiskRegister, evaluateRiskRegister };
