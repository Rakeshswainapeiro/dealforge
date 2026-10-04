// ---------------------------------------------------------------------------
// Sourcing-channel side-effects (W1-08 / BRD INT-05, REQ-GATE-08).
//
// The preparer records how the opportunity was sourced. The channel is
// mandatory, and two channels carry automatic side-effects the rest of the app
// must surface:
//
//   * IHC / affiliate referral -> the related-party flag is set automatically
//     for confirmation (handed to the E9.5 governance overlay).
//   * banker / advisor-led     -> a compressed-timeline indicator is set,
//     because an intermediary is running a process to a deadline.
//
// Every rule, tag and message lives here so the capture form, the gate, the
// memo and the tests read one source and nothing is hard-coded at a call site
// (REQ-RULE-10).
// ---------------------------------------------------------------------------

import { SOURCING_CHANNELS } from './intakeConfig.js';

// The capture-model key the channel is written to.
export const SOURCING_CHANNEL_FIELD = 'sourcing_channel';

// The channel that raises the compressed-timeline indicator, and the channel
// class (related_by_default) that auto-sets the related-party flag.
export const COMPRESSED_TIMELINE_CHANNEL = 'banker_advisor';
export const COMPRESSED_TIMELINE_TAG = 'compressed_timeline';
export const RELATED_PARTY_TAG = 'related_party_flag';

export const SOURCING_CHANNEL_MESSAGES = {
  required:
    'Record the sourcing channel before submission: IHC / affiliate referral, banker / advisor-led, proprietary, portfolio bolt-on or government / DGE-adjacent. The channel is mandatory (INT-05).',
  unknown:
    'The sourcing channel is not one of the recognised channels. Pick one of the listed channels.',
  related_party:
    'Sourced through an IHC / affiliate referral: the related-party flag is set automatically and an independent reviewer must sign off before any decision.',
  compressed_timeline:
    'Banker / advisor-led process: a compressed-timeline indicator is set. Expect an accelerated diligence and decision window.',
};

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

// Look up a channel spec by its stored value.
export function findSourcingChannel(value) {
  if (blank(value)) return null;
  const wanted = String(value).trim().toLowerCase();
  return SOURCING_CHANNELS.find((c) => c.value === wanted) || null;
}

/**
 * Evaluate the sourcing-channel side-effects for an opportunity's data. Pure:
 * no DB, no request.
 *
 *   applies                 - true, the channel is always evaluated
 *   required                - true, the channel is mandatory (INT-05)
 *   satisfied               - a recognised channel was recorded
 *   value / label           - the recorded channel and its display label
 *   related_party_auto_flag - an IHC / affiliate referral auto-sets the flag
 *   compressed_timeline     - a banker / advisor-led process sets the indicator
 *   flags                   - advisory side-effects to surface (with messages)
 *   tags                    - the tags to persist on the record
 *   stops                   - reasons the channel is not yet valid, each with a
 *                             message
 */
export function evaluateSourcingChannel(data = {}) {
  const value = data[SOURCING_CHANNEL_FIELD];
  const channel = findSourcingChannel(value);

  const stops = [];
  if (blank(value)) {
    stops.push({ code: 'sourcing_channel_required', message: SOURCING_CHANNEL_MESSAGES.required });
  } else if (!channel) {
    stops.push({ code: 'sourcing_channel_unknown', message: SOURCING_CHANNEL_MESSAGES.unknown });
  }

  const relatedPartyAutoFlag = Boolean(channel && channel.related_by_default);
  const compressedTimeline = Boolean(channel && channel.value === COMPRESSED_TIMELINE_CHANNEL);

  const flags = [];
  if (relatedPartyAutoFlag) {
    flags.push({ code: RELATED_PARTY_TAG, message: SOURCING_CHANNEL_MESSAGES.related_party });
  }
  if (compressedTimeline) {
    flags.push({ code: COMPRESSED_TIMELINE_TAG, message: SOURCING_CHANNEL_MESSAGES.compressed_timeline });
  }

  const tags = [];
  if (relatedPartyAutoFlag) tags.push(RELATED_PARTY_TAG);
  if (compressedTimeline) tags.push(COMPRESSED_TIMELINE_TAG);

  return {
    applies: true,
    required: true,
    satisfied: stops.length === 0,
    value: blank(value) ? null : String(value),
    label: channel ? channel.label : null,
    related_party_auto_flag: relatedPartyAutoFlag,
    compressed_timeline: compressedTimeline,
    flags,
    tags,
    stops,
  };
}

export default {
  SOURCING_CHANNEL_FIELD, COMPRESSED_TIMELINE_CHANNEL, COMPRESSED_TIMELINE_TAG,
  RELATED_PARTY_TAG, SOURCING_CHANNEL_MESSAGES, findSourcingChannel, evaluateSourcingChannel,
};
