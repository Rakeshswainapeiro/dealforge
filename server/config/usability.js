// ---------------------------------------------------------------------------
// Usability UAT policy (W9-07 / BRD NFR-07).
//
// NFR-07 asks a pilot user to complete a submission unaided, with no help from
// the delivery team. A code change cannot prove that on its own: the proof is a
// recorded pilot session. This module holds the task catalog the pilot works
// through, the acceptance thresholds, and a pure gate so recorded sessions can
// be scored objectively (and unit-tested without a person in the room).
// ---------------------------------------------------------------------------

export const USABILITY_VERSION = 'NFR-07.1';

// The tasks a pilot must complete without assistance. 'unaided' marks the tasks
// that decide the gate; the rest are warm-up / orientation steps.
export const PILOT_TASKS = [
  { id: 'login', label: 'Sign in and land on the dashboard', unaided: false },
  { id: 'self_screen', label: 'Run the pre-form self-screen for a real idea', unaided: false },
  { id: 'capture', label: 'Capture the opportunity header from the self-screen answers', unaided: true },
  { id: 'documents', label: 'Upload the required business plan, financials and cap table', unaided: true },
  { id: 'draft', label: 'Save the submission as a draft and find it again', unaided: true },
  { id: 'sign', label: 'Sign as CEO/CFO and submit the opportunity', unaided: true },
  { id: 'status', label: 'Find the submitted opportunity and read its status', unaided: true },
];

// Acceptance thresholds for the UAT session.
export const USABILITY_CRITERIA = {
  min_pilots: 3,
  min_unaided_rate: 0.8,
  critical_issues_max: 0,
  sus_target: 68,
};

// Score a single task observation. `assisted` is true when the facilitator had
// to step in; `success` is true when the pilot reached the expected end state.
export function scoreTask(observation = {}) {
  const assisted = observation.assisted === true;
  const success = observation.success !== false;
  return { id: observation.id, assisted, success, unaided: success && !assisted };
}

// Score one pilot: the gate-relevant tasks are the ones marked unaided in the
// catalog. A pilot counts as unaided only when every gate task was completed
// without assistance and without a failure.
export function scorePilot(session = {}) {
  const observations = Array.isArray(session.tasks) ? session.tasks : [];
  const scored = observations.map(scoreTask);
  const gateIds = PILOT_TASKS.filter((t) => t.unaided).map((t) => t.id);
  const gateScored = scored.filter((s) => gateIds.includes(s.id));
  const unaided = gateScored.length === gateIds.length && gateScored.every((s) => s.unaided);
  return {
    pilot: session.pilot || 'unknown',
    tasks: scored,
    gate_tasks: gateIds.length,
    gate_tasks_unaided: gateScored.filter((s) => s.unaided).length,
    unaided,
    sus: typeof session.sus === 'number' ? session.sus : null,
    issues: Array.isArray(session.issues) ? session.issues : [],
  };
}

// Evaluate a whole recorded session set against the criteria.
export function evaluateUsabilityUat({ pilots = [], issues = [] } = {}) {
  const scored = pilots.map(scorePilot);
  const unaidedCount = scored.filter((p) => p.unaided).length;
  const rate = scored.length ? unaidedCount / scored.length : 0;
  const allIssues = [].concat(issues, ...scored.map((p) => p.issues));
  const critical = allIssues.filter((i) => (i && i.severity) === 'critical');
  const susValues = scored.map((p) => p.sus).filter((v) => typeof v === 'number');
  const susMean = susValues.length ? susValues.reduce((a, b) => a + b, 0) / susValues.length : null;
  const enoughPilots = scored.length >= USABILITY_CRITERIA.min_pilots;
  const rateOk = rate >= USABILITY_CRITERIA.min_unaided_rate;
  const noCritical = critical.length <= USABILITY_CRITERIA.critical_issues_max;
  const susOk = susMean === null ? true : susMean >= USABILITY_CRITERIA.sus_target;
  return {
    pilots: scored.length,
    unaided: unaidedCount,
    unaided_rate: Math.round(rate * 1000) / 1000,
    critical_issues: critical.length,
    sus_mean: susMean === null ? null : Math.round(susMean * 10) / 10,
    pass: enoughPilots && rateOk && noCritical && susOk,
    criteria: USABILITY_CRITERIA,
    blocked_reason: !enoughPilots ? 'fewer than ' + USABILITY_CRITERIA.min_pilots + ' pilot sessions recorded' : null,
    results: scored,
    policy: 'A pilot completes the submission tasks unaided when every gate task is done with no assistance and no failure, across at least ' + USABILITY_CRITERIA.min_pilots + ' pilots, with no critical usability issue.',
  };
}
