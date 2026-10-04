// Sirius investment memo template tests (REQ-MEMO-01).
//
// Pure functions only — these assert the generated memo reproduces the
// structure of the source template (docs/Sirius_Investment_Framework_
// Subsidiaries_Final.pdf, slides 6-11) and that missing data falls back to the
// template's placeholder instead of breaking the document.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSiriusMemo, missingMemoFields, MEMO_PAGE_TITLES, FINANCIAL_PERIODS,
  RETURN_HURDLES, SIRIUS_CONFIDENTIALITY,
} from '../config/siriusMemo.js';

const FULL_OPPORTUNITY = {
  id: 'opp-test', owner_org_id: 'org-infinia',
  data: {
    opportunity_name: 'GulfPay Payments Platform',
    opportunity_type: 'acquisition',
    target_name: 'GulfPay Holdings',
    sector: 'Financial Services',
    geography: 'UAE',
    total_commitment_aed: 120,
    ask_aed: 60,
    funding_source: 'Balance sheet + subsidiary debt',
    in_approved_budget: 'yes',
    target_signing_close: '2027-06',
    narrative_what: 'Acquire a profitable payments platform.',
    narrative_why_now: 'The consolidation window is open.',
    narrative_why_us: 'We operate the adjacent merchant stack.',
    decision_sought: 'Approval to proceed to diligence.',
    status: 'screening',
  },
};

const ORG = { id: 'org-infinia', name: 'Infinia Technologies Limited' };

describe('Sirius memo template', () => {
  test('produces the six template pages in order', () => {
    const memo = buildSiriusMemo({ opportunity: FULL_OPPORTUNITY, org: ORG });
    assert.equal(memo.pages.length, 6);
    assert.deepEqual(
      memo.pages.map((p) => p.title),
      [
        MEMO_PAGE_TITLES.executive_summary,
        MEMO_PAGE_TITLES.overview,
        MEMO_PAGE_TITLES.rationale,
        MEMO_PAGE_TITLES.financials,
        MEMO_PAGE_TITLES.funding,
        MEMO_PAGE_TITLES.risks,
      ],
    );
    assert.deepEqual(memo.pages.map((p) => p.number), [1, 2, 3, 4, 5, 6]);
  });

  test('header carries the subsidiary and opportunity, with the template confidentiality line', () => {
    const memo = buildSiriusMemo({ opportunity: FULL_OPPORTUNITY, org: ORG });
    assert.equal(memo.header, 'Infinia Technologies Limited · GulfPay Payments Platform');
    assert.equal(memo.confidentiality, SIRIUS_CONFIDENTIALITY);
  });

  test('page 1 key facts come from the canonical header fields', () => {
    const memo = buildSiriusMemo({ opportunity: FULL_OPPORTUNITY, org: ORG });
    const keyFacts = memo.pages[0].sections.find((s) => s.type === 'fields');
    const byLabel = Object.fromEntries(keyFacts.rows.map((r) => [r.label, r.value]));
    assert.equal(byLabel['Subsidiary'], 'Infinia Technologies Limited');
    assert.equal(byLabel['Opportunity type'], 'Acquisition');
    assert.equal(byLabel['Target / counterparty'], 'GulfPay Holdings');
    assert.equal(byLabel['Sector & geography'], 'Financial Services · UAE');
    assert.equal(byLabel['Total commitment'], '120');
    assert.equal(byLabel['Ask from Sirius'], '60');
    assert.equal(byLabel['In approved budget?'], 'Yes');
    assert.equal(byLabel['Target signing / close'], '2027-06');
  });

  test('page 4 financials table uses the FY-3 A ... Y5 P columns', () => {
    const memo = buildSiriusMemo({ opportunity: FULL_OPPORTUNITY, org: ORG });
    const fin = memo.pages[3].sections.find((s) => s.type === 'finTable');
    assert.deepEqual(fin.periods, FINANCIAL_PERIODS);
    assert.equal(fin.periods[0], 'FY-3 A');
    assert.equal(fin.periods[fin.periods.length - 1], 'Y5 P');
    assert.equal(fin.rows.length, 8);
  });

  test('page 4 returns table lists the three Sirius hurdles', () => {
    const memo = buildSiriusMemo({ opportunity: FULL_OPPORTUNITY, org: ORG });
    const returns = memo.pages[3].sections.find((s) => s.type === 'returnsTable');
    assert.deepEqual(returns.rows.map((r) => r.label), RETURN_HURDLES.map((h) => h.label));
    // No returns data yet -> the template placeholder, never a broken value.
    assert.equal(returns.rows[0].base, '[ ]');
    assert.equal(returns.rows[0].meets, 'Y / N');
  });

  test('present returns data flows through to base / upside / downside and Meets?', () => {
    const opp = {
      ...FULL_OPPORTUNITY,
      data: {
        ...FULL_OPPORTUNITY.data,
        returns: {
          equity_irr: { base: 22, upside: 28, downside: 14, meets: true },
          roic: { base: 16, meets: false },
        },
      },
    };
    const memo = buildSiriusMemo({ opportunity: opp, org: ORG });
    const returns = memo.pages[3].sections.find((s) => s.type === 'returnsTable');
    const irr = returns.rows.find((r) => r.label === 'Equity IRR');
    assert.equal(irr.base, '22');
    assert.equal(irr.upside, '28');
    assert.equal(irr.downside, '14');
    assert.equal(irr.meets, 'Y');
    const roic = returns.rows.find((r) => r.label === 'ROIC');
    assert.equal(roic.meets, 'N');
  });

  test('flat FIN-03 capture fields populate the returns table without a returns block', () => {
    const opp = {
      ...FULL_OPPORTUNITY,
      data: {
        ...FULL_OPPORTUNITY.data,
        return_irr_base: 26, return_irr_upside: 34, return_irr_downside: 13,
        return_roic_base: 19, return_payback_years: 3.1,
      },
    };
    const memo = buildSiriusMemo({ opportunity: opp, org: ORG });
    const returns = memo.pages[3].sections.find((s) => s.type === 'returnsTable');
    const irr = returns.rows.find((r) => r.label === 'Equity IRR');
    assert.equal(irr.base, '26');
    assert.equal(irr.upside, '34');
    assert.equal(irr.downside, '13');
    const payback = returns.rows.find((r) => r.label === 'Payback period');
    assert.equal(payback.base, '3.1');
  });

  test('page 5 funding plan totals sources and uses, defaulting to the commitment', () => {
    const memo = buildSiriusMemo({ opportunity: FULL_OPPORTUNITY, org: ORG });
    const funding = memo.pages[5 - 1].sections.find((s) => s.type === 'fundingTables');
    assert.equal(funding.sourceRows.at(-1).label, 'Total sources');
    assert.equal(funding.sourceRows.at(-1).aed, '120'); // falls back to total commitment
    assert.equal(funding.sourceRows.at(-1).pct, '100%');
    assert.equal(funding.useRows.at(-1).label, 'Total uses');
    assert.equal(funding.useRows.at(-1).aed, '120');
  });

  test('page 6 always shows six risk rows and the three compliance screens', () => {
    const memo = buildSiriusMemo({ opportunity: FULL_OPPORTUNITY, org: ORG });
    const [riskTable, compliance] = memo.pages[5].sections;
    assert.equal(riskTable.type, 'table');
    assert.equal(riskTable.rows.length, 6);
    assert.deepEqual(riskTable.columns, ['#', 'Risk', 'Category', 'Likelihood', 'Impact', 'Mitigation', 'Owner']);
    assert.equal(compliance.rows.length, 3);
    assert.deepEqual(compliance.rows.map((r) => r[0]), ['Legal & regulatory', 'Related-party', 'ESG & reputational']);
  });

  test('related-party disclosure surfaces in the compliance screen', () => {
    const opp = {
      ...FULL_OPPORTUNITY,
      data: { ...FULL_OPPORTUNITY.data, related_party_disclosure: 'Referred by an IHC affiliate.' },
    };
    const memo = buildSiriusMemo({ opportunity: opp, org: ORG });
    const compliance = memo.pages[5].sections[1];
    const rp = compliance.rows.find((r) => r[0] === 'Related-party');
    assert.equal(rp[1], 'Open');
    assert.match(rp[2], /IHC affiliate/);
  });

  test('a sparse opportunity still yields a complete six-page memo of placeholders', () => {
    const memo = buildSiriusMemo({ opportunity: { id: 'opp-blank', owner_org_id: 'org-x', data: {} }, org: null });
    assert.equal(memo.pages.length, 6);
    assert.equal(memo.header, '[Subsidiary name] · (untitled opportunity)');
    for (const page of memo.pages) {
      assert.ok(page.sections.length > 0, 'page ' + page.number + ' has no sections');
    }
  });

  test('missingMemoFields flags template fields without values', () => {
    const missing = missingMemoFields({ data: { opportunity_name: 'Only a name' } });
    const keys = missing.map((f) => f.key);
    assert.ok(keys.includes('total_commitment_aed'));
    assert.ok(keys.includes('financials'));
    assert.ok(keys.includes('returns'));
    assert.ok(keys.includes('risks'));
    assert.ok(keys.includes('compliance'));
    assert.ok(!keys.includes('opportunity_name'));
  });

  test('attached submission documents are recorded as memo evidence', () => {
    const memo = buildSiriusMemo({
      opportunity: FULL_OPPORTUNITY, org: ORG,
      documents: [
        { requirement_key: 'business_plan', version: 2 },
        { requirement_key: 'financials', version: 1 },
      ],
    });
    assert.deepEqual(memo.evidence.present.sort(), ['business_plan', 'financials']);
    assert.equal(memo.evidence.items.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Sirius memo hurdle table (W2-04 / FIN-04). With entity thresholds available
// (passed as alignment), the page-4 returns table prints the live hurdle values
// and a per-scenario Meets? verdict, plus a policy-version note.
// ---------------------------------------------------------------------------
describe('Sirius memo hurdle table (FIN-04)', () => {
  const ALIGNMENT = {
    thresholds: {
      equity_irr_min: 20, greenfield_irr_min: 25, roic_wacc_spread: 5, wacc_pct: 9,
      payback_max_years: 3.5, concentration_max_pct: 35, leverage_max: 3,
    },
  };

  test('prints live thresholds and an N verdict when a case falls short', () => {
    const opp = {
      ...FULL_OPPORTUNITY,
      data: {
        ...FULL_OPPORTUNITY.data,
        return_irr_base: 24, return_irr_upside: 31, return_irr_downside: 12,
        return_roic_base: 18, return_roic_upside: 23, return_roic_downside: 8,
        return_payback_years: 3.2, return_payback_upside: 2.7, return_payback_downside: 4.1,
      },
    };
    const memo = buildSiriusMemo({ opportunity: opp, org: ORG, alignment: ALIGNMENT });
    const returns = memo.pages[3].sections.find((s) => s.type === 'returnsTable');
    assert.equal(returns.rows.length, 6);
    const irr = returns.rows.find((r) => r.label === 'Equity IRR');
    assert.equal(irr.hurdle, '≥ 20%');
    assert.equal(irr.meets, 'N');
    const roic = returns.rows.find((r) => r.label === 'ROIC');
    assert.equal(roic.hurdle, '≥ 14%');
    const note = memo.pages[3].sections.find((s) => s.type === 'note' && /policy v/.test(s.text || ''));
    assert.ok(note, 'expected a hurdle-policy note');
    assert.match(note.text, /policy v1/);
  });

  test('prints a Y verdict when every captured case meets its hurdle', () => {
    const opp = {
      ...FULL_OPPORTUNITY,
      data: {
        ...FULL_OPPORTUNITY.data,
        return_irr_base: 26, return_irr_upside: 34, return_irr_downside: 22,
        return_roic_base: 19, return_roic_upside: 24, return_roic_downside: 18,
        return_payback_years: 3.0, return_payback_upside: 2.6, return_payback_downside: 3.2,
        concentration_pct: 30,
      },
    };
    const memo = buildSiriusMemo({ opportunity: opp, org: ORG, alignment: ALIGNMENT });
    const returns = memo.pages[3].sections.find((s) => s.type === 'returnsTable');
    const irr = returns.rows.find((r) => r.label === 'Equity IRR');
    assert.equal(irr.hurdle, '≥ 20%');
    assert.equal(irr.meets, 'Y');
  });
});

