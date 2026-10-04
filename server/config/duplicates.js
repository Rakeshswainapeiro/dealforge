// ---------------------------------------------------------------------------
// Duplicate detection (W1-10 / INT-12).
//
// The system warns the Investment Team when a new opportunity looks like an
// existing one across the group (same target / counterparty or a similar name).
// The warning is deliberately Investment-Team-only: the subsidiary preparer
// must never learn that a sibling is pursuing the same target, so the match is
// computed from a cross-group read while the producing layer only ever sees a
// plain submitted state.
//
// Detection is a pure function over opportunity records so it is unit-testable
// and the same logic serves the API, the fixture generator and the tests.
// ---------------------------------------------------------------------------

// Similar-name matching tolerates the noise that real deal names carry: legal
// suffixes (LLC, Ltd, Holding), country markers and punctuation. Words shorter
// than the threshold are dropped so short connector words and single letters do
// not create false matches.
export const STOP_WORDS = new Set([
  'the', 'and', 'of', 'for', 'a', 'an', 'to', 'in', 'on', 'group', 'holding',
  'holdings', 'co', 'company', 'llc', 'ltd', 'limited', 'inc', 'plc', 'fz',
  'fze', 'fzco', 'wll', 'pjsc', 'jsc', 'lp', 'llp', 'sa', 'saoc',
]);

export const DUPLICATE_MATCH_THRESHOLD = 2;

// Normalise a name to comparable tokens.
export function nameTokens(value) {
  if (!value) return [];
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

// A stable same-name key: the meaningful tokens sorted, so word order and
// punctuation do not matter (Cloud Platforms Consolidation equals Consolidation
// of Cloud Platforms).
export function nameKey(value) {
  return nameTokens(value).sort().join(' ');
}

// Score how alike two opportunities are. Returns a match when either the target
// / counterparty names normalise to the same key, or the meaningful-token
// overlap reaches the threshold. Names are compared on both the target and the
// opportunity title so the same target under a different deal name still matches.
export function compareOpportunities(a, b) {
  const ad = a?.data || a || {};
  const bd = b?.data || b || {};

  const targetA = nameKey(ad.target_name);
  const targetB = nameKey(bd.target_name);
  const oppA = nameKey(ad.opportunity_name);
  const oppB = nameKey(bd.opportunity_name);

  const reasons = [];
  let sameTarget = false;
  let sameName = false;

  if (targetA && targetA === targetB) { sameTarget = true; reasons.push('same target / counterparty'); }
  if (oppA && oppA === oppB) { sameName = true; reasons.push('similar opportunity name'); }

  const tokensA = new Set(nameTokens(ad.target_name).concat(nameTokens(ad.opportunity_name)));
  const tokensB = new Set(nameTokens(bd.target_name).concat(nameTokens(bd.opportunity_name)));
  let overlap = 0;
  for (const token of tokensA) if (tokensB.has(token)) overlap += 1;
  const similarName = !sameTarget && !sameName && overlap >= DUPLICATE_MATCH_THRESHOLD;
  if (similarName) reasons.push(overlap + ' shared name tokens');

  const isDuplicate = sameTarget || sameName || similarName;
  return { is_duplicate: isDuplicate, same_target: sameTarget, same_name: sameName, similar_name: similarName, overlap, reasons };
}

// Find the matches for one opportunity among a candidate set. Candidates are
// raw entity rows (with .id and .data); the subject is excluded, and a caller
// upstream has already filtered the set to what the actor may read.
export function findDuplicates(subject, candidates) {
  const subjectId = subject?.id ?? subject?.data?.id ?? null;
  const matches = [];
  for (const candidate of candidates || []) {
    if (!candidate) continue;
    if (subjectId && candidate.id === subjectId) continue;
    if (candidate.deleted) continue;
    const verdict = compareOpportunities(subject, candidate);
    if (!verdict.is_duplicate) continue;
    const d = candidate.data || {};
    matches.push({
      opportunity_id: candidate.id,
      owner_org_id: candidate.owner_org_id,
      opportunity_name: d.opportunity_name || '(untitled)',
      target_name: d.target_name || null,
      sector: d.sector || null,
      geography: d.geography || null,
      state: d.status || 'draft',
      reasons: verdict.reasons,
      same_target: verdict.same_target,
      shared_tokens: verdict.overlap,
    });
  }
  // Strongest first: a same-target hit outranks a token-overlap hit.
  matches.sort((x, y) => Number(y.same_target) - Number(x.same_target) || y.shared_tokens - x.shared_tokens);
  return matches;
}

export default { STOP_WORDS, DUPLICATE_MATCH_THRESHOLD, nameTokens, nameKey, compareOpportunities, findDuplicates };
