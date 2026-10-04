// ---------------------------------------------------------------------------
// Pre-form self-screen configuration (W1-01 / BRD INT-02, REQ-RULE-02/03/04/05).
//
// Before a preparer opens the six-section capture form, the opportunity is
// screened against six questions (type, commitment, sector, geography, in-plan,
// related party). Two of them are hard stops that halt the flow with an
// explicit reason:
//
//   * outside-appetite type          -> stop (REQ-RULE-04)
//   * commitment below the AED 10mn  -> stop, unless a below-floor exception is
//     floor                             chosen (REQ-RULE-02, handed to W1-02)
//
// The remaining answers do not stop the flow; they raise flags the later steps
// consume (portfolio conflict / theme alignment in W3, related-party overlay in
// W6-03, off-plan budget justification in W2-07). Every rule, option and stop
// message lives here so the form, the gate and the tests read the same source
// and nothing is hard-coded at a call site (REQ-RULE-10).
// ---------------------------------------------------------------------------

import {
  ELIGIBLE_TYPES, OUTSIDE_APPETITE_TYPES, SOURCING_CHANNELS,
  MIN_COMMITMENT_AED_MN, BELOW_FLOOR_EXCEPTION_IRR,
  isOutsideAppetite, clearsFloor,
} from './intakeConfig.js';
import { SECTORS } from './natureOfBusiness.js';
import { evaluateBelowFloor } from './belowFloor.js';

export const SELF_SCREEN_DECISIONS = ['pass', 'pass_with_flags', 'stop'];

// Hard-stop reason codes. Persisted on the record and asserted in the tests.
export const SELF_SCREEN_STOPS = {
  outside_appetite: 'outside_appetite',
  below_floor: 'below_floor',
};

// Advisory flag codes (non-blocking).
export const SELF_SCREEN_FLAGS = {
  below_floor_exception: 'below_floor_exception',
  not_in_plan: 'not_in_plan',
  related_party: 'related_party',
  out_of_scope_geography: 'out_of_scope_geography',
  theme_mismatch: 'theme_mismatch',
};


// Exact operator-facing stop messages, kept in configuration.
export const SELF_SCREEN_MESSAGES = {
  outside_appetite:
    "Outside appetite: this opportunity type is not one Sirius invests in without a new mandate. The submission has been halted.",
  below_floor:
    "Below the AED " + MIN_COMMITMENT_AED_MN + "mn floor: the ticket is too small for the standard route. Halt, or continue on the below-floor exception route (portfolio-synergy statement plus IRR of at least " + BELOW_FLOOR_EXCEPTION_IRR + "%).",
  not_in_plan:
    "Not in the approved annual plan or budget. Continue, but the funding step will require a budget variance justification.",
  related_party:
    "Related-party / affiliate involvement declared. Continue, but an independent reviewer must sign off before any decision.",
  out_of_scope_geography:
    "Outside the core UAE / GCC footprint. Continue, but expect a scope justification at screening.",
  theme_mismatch:
    "Sector does not match the owning subsidiary's approved theme. Continue, but alignment will be assessed at screening.",
};

// Geography options: the GCC core (in scope by default) plus the wider markets
// the group already operates in. A non-core choice raises an advisory flag.
export const CORE_GEOGRAPHIES = ['UAE', 'GCC', 'Saudi Arabia', 'Qatar', 'Oman', 'Bahrain'];

// The select controls render {value,label} options (the shadcn Select needs a
// value). The evaluator still reads the plain string answer, which is the value.
const asOptions = (values) => values.map((value) => ({ value, label: value }));

export const SELF_SCREEN_GEOGRAPHIES = asOptions([
  'UAE', 'GCC', 'Saudi Arabia', 'Qatar', 'Oman', 'Bahrain',
  'Egypt', 'India', 'UK', 'Europe', 'Kenya', 'Zambia', 'Uzbekistan',
  'Azerbaijan', 'USA', 'Romania', 'Indonesia', 'Other',
]);

export const SELF_SCREEN_SECTORS = asOptions(SECTORS);

// Approved-plan answer options.
export const PLAN_OPTIONS = [
  { value: 'yes', label: 'Yes - in the approved annual plan / budget' },
  { value: 'no', label: 'No - off-plan / new budget required' },
];

// Related-party declaration options.
export const RELATED_PARTY_OPTIONS = [
  { value: 'no', label: 'No affiliate involvement' },
  { value: 'yes', label: 'Yes - affiliate / related party involved' },
];


// The six ordered self-screen questions. 'field' is the capture-model key each
// answer seeds, so a passing screen prefills the form instead of asking twice.
export const SELF_SCREEN_QUESTIONS = [
  {
    key: 'opportunity_type', field: 'opportunity_type', control: 'select', required: true,
    label: 'Opportunity type',
    help: 'What kind of investment is this?',
    options: [...ELIGIBLE_TYPES, ...OUTSIDE_APPETITE_TYPES],
    stop: SELF_SCREEN_STOPS.outside_appetite,
  },
  {
    key: 'total_commitment_aed', field: 'total_commitment_aed', control: 'number', required: true,
    label: 'Total commitment (AED mn)',
    help: 'The full ticket size, whether funded by the subsidiary or by Sirius.',
    min: MIN_COMMITMENT_AED_MN, stop: SELF_SCREEN_STOPS.below_floor,
  },
  {
    key: 'sector', field: 'sector', control: 'select', required: true,
    label: 'Sector',
    help: 'The primary sector of the target.',
    options: SELF_SCREEN_SECTORS,
  },
  {
    key: 'geography', field: 'geography', control: 'select', required: true,
    label: 'Geography',
    help: "The target's principal market.",
    options: SELF_SCREEN_GEOGRAPHIES,
  },
  {
    key: 'in_approved_budget', field: 'in_approved_budget', control: 'select', required: true,
    label: 'In the approved plan / budget?',
    help: 'Is this already provided for in the annual plan?',
    options: PLAN_OPTIONS,
  },
  {
    key: 'related_party', field: 'related_party_disclosure', control: 'select', required: false,
    label: 'Related party / affiliate involvement',
    help: 'Would any affiliate of the group be a counterparty or beneficiary?',
    options: RELATED_PARTY_OPTIONS,
  },
];


const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function truthy(value) {
  if (value === true) return true;
  if (typeof value === 'string') return ['true', 'yes', 'y', '1'].includes(value.trim().toLowerCase());
  return false;
}

// A themed owning org raises theme_mismatch when its approved theme names a
// different sector. 'theme' is the effective theme from server/themes.js.
export function themeSectorMismatch(sector, theme) {
  if (blank(sector) || !theme || !theme.sector) return false;
  return String(theme.sector).toLowerCase() !== String(sector).toLowerCase();
}

/**
 * Evaluate the six-question self-screen. Pure: no DB, no request. 'theme' is an
 * optional effective theme used for the advisory sector-alignment flag.
 *
 * Returns decision 'stop' when any hard rule fires and no exception applies,
 * 'pass_with_flags' when only advisory flags remain, otherwise 'pass'.
 */
export function evaluateSelfScreen(input = {}, opts = {}) {
  const theme = opts.theme || null;
  const answers = {
    opportunity_type: input.opportunity_type ?? '',
    total_commitment_aed: input.total_commitment_aed ?? '',
    sector: input.sector ?? '',
    geography: input.geography ?? '',
    in_approved_budget: input.in_approved_budget ?? '',
    related_party: input.related_party ?? (blank(input.related_party_disclosure) ? '' : 'yes'),
  };

  const stops = [];
  const flags = [];
  const addStop = (code, message) => stops.push({ code, message });
  const addFlag = (code, message) => flags.push({ code, message });

  // 1. Type / appetite (REQ-RULE-03/04) - hard stop.
  if (blank(answers.opportunity_type)) {
    addStop('missing_opportunity_type', 'Select an opportunity type to run the self-screen.');
  } else if (isOutsideAppetite(answers.opportunity_type)) {
    addStop(SELF_SCREEN_STOPS.outside_appetite, SELF_SCREEN_MESSAGES.outside_appetite);
  }

  // 2. Commitment floor (REQ-RULE-02) - hard stop unless an exception is chosen.
  const exceptionChosen = truthy(input.below_floor_exception);
  if (blank(answers.total_commitment_aed)) {
    addStop('missing_total_commitment_aed', 'Enter the total commitment in AED mn to run the self-screen.');
  } else if (!clearsFloor(answers.total_commitment_aed)) {
    if (exceptionChosen) {
      addFlag(SELF_SCREEN_FLAGS.below_floor_exception, SELF_SCREEN_MESSAGES.below_floor);
    } else {
      addStop(SELF_SCREEN_STOPS.below_floor, SELF_SCREEN_MESSAGES.below_floor);
    }
  }

  // 3. Sector - advisory alignment flag against the owning org's theme.
  if (themeSectorMismatch(answers.sector, theme)) {
    addFlag(SELF_SCREEN_FLAGS.theme_mismatch, SELF_SCREEN_MESSAGES.theme_mismatch);
  }

  // 4. Geography - advisory scope flag outside the GCC core.
  if (!blank(answers.geography) && !CORE_GEOGRAPHIES.some((g) => g.toLowerCase() === String(answers.geography).toLowerCase())) {
    addFlag(SELF_SCREEN_FLAGS.out_of_scope_geography, SELF_SCREEN_MESSAGES.out_of_scope_geography);
  }

  // 5. In-plan - advisory; the funding step enforces the variance justification.
  if (String(answers.in_approved_budget).toLowerCase() === 'no') {
    addFlag(SELF_SCREEN_FLAGS.not_in_plan, SELF_SCREEN_MESSAGES.not_in_plan);
  }

  // 6. Related party - advisory; the overlay forces independent review.
  if (String(answers.related_party).toLowerCase() === 'yes') {
    addFlag(SELF_SCREEN_FLAGS.related_party, SELF_SCREEN_MESSAGES.related_party);
  }

  const requiredKeys = SELF_SCREEN_QUESTIONS.filter((q) => q.required).map((q) => q.key);
  // Any other required answer left blank is an incomplete screen, not a pass:
  // the pre-form step exists to collect all six before drafting begins.
  for (const key of requiredKeys) {
    if (stops.some((s) => s.code === 'missing_' + key)) continue;
    if (blank(answers[key])) {
      const question = SELF_SCREEN_QUESTIONS.find((q) => q.key === key);
      addStop('missing_' + key, 'Answer "' + (question ? question.label : key) + '" to run the self-screen.');
    }
  }
  const complete = requiredKeys.every((k) => !blank(answers[k]));
  const decision = stops.length > 0 ? 'stop' : (flags.length > 0 ? 'pass_with_flags' : 'pass');

  return {
    decision,
    complete,
    blocked: stops.length > 0,
    stops,
    flags,
    answers,
    below_floor_exception: exceptionChosen,
    // The stricter below-floor exception route (W1-02 / INT-03). At the pre-form
    // stage the synergy statement and IRR are not yet captured, so the route is
    // only enforced at submission; exposing it here lets the form explain what
    // the exception will require.
    below_floor: evaluateBelowFloor({ ...input, below_floor_exception: exceptionChosen }),
    floor_aed_mn: MIN_COMMITMENT_AED_MN,
    evaluated_at: new Date().toISOString(),
  };
}


// Related-party answer derived from the capture data / sourcing channel, so the
// screen agrees with the header the preparer filled in.
export function relatedPartyAnswerFromData(data = {}) {
  if (String(data.related_party ?? '').toLowerCase() === 'yes') return 'yes';
  const channel = data.sourcing_channel;
  if (channel && SOURCING_CHANNELS.some((c) => c.value === channel && c.related_by_default)) return 'yes';
  const disclosure = data.related_party_disclosure;
  if (typeof disclosure === 'string' && disclosure.trim() && /affiliate|related|ihc/i.test(disclosure)) return 'yes';
  return 'no';
}

export default {
  SELF_SCREEN_DECISIONS, SELF_SCREEN_STOPS, SELF_SCREEN_FLAGS, SELF_SCREEN_MESSAGES,
  SELF_SCREEN_QUESTIONS, SELF_SCREEN_SECTORS, SELF_SCREEN_GEOGRAPHIES, CORE_GEOGRAPHIES,
  PLAN_OPTIONS, RELATED_PARTY_OPTIONS,
  evaluateSelfScreen, themeSectorMismatch, relatedPartyAnswerFromData,
};
