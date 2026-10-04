// ---------------------------------------------------------------------------
// Unit tests for the portfolio conflict / concentration and synergy analysis
// (W3-10 / BRD SCR-07, W3-11 / BRD SCR-06).
//
//   node --test server/tests/portfolioAnalysis.test.js
//
// Pure module: the tests pass the register by hand and assert the synergy
// ranking and sign-off marker, the conflict flags naming the affected company,
// the concentration figure against the ceiling and the advisory posture. No
// server.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PORTFOLIO_ANALYSIS_VERSION, CONCENTRATION_MAX_SECTOR_PCT, SYNERGY_MAX_RESULTS,
  SYNERGY_SIGNOFF_MARKER,
  evaluatePortfolioSynergy, evaluatePortfolioConcentration, evaluatePortfolioConflict,
} from '../config/portfolioAnalysis.js';

const register = [
  { id: 'pf-saif', name: 'SAIF', cluster: 'technology_digital', sector: 'Technology', geography: 'UAE', geographies: ['UAE', 'GCC'], capabilities: ['software', 'cloud'] },
  { id: 'pf-coredge', name: 'Coredge', cluster: 'technology_digital', sector: 'Technology', geography: 'UAE', geographies: ['UAE'], capabilities: ['technology'] },
  { id: 'pf-infinia', name: 'Infinia', cluster: 'technology_digital', sector: 'Technology', geography: 'UAE', geographies: ['UAE'], capabilities: ['data'] },
  { id: 'pf-esyasoft', name: 'Esyasoft', cluster: 'energy_utilities', sector: 'Energy', geography: 'UAE', geographies: ['UAE'], capabilities: ['energy'] },
  { id: 'pf-cmc', name: 'CMC', cluster: 'healthcare_life_sciences', sector: 'Healthcare', geography: 'UAE', geographies: ['UAE'], capabilities: ['healthcare'] },
];

const techTarget = {
  target_name: 'DigitalCo LLC', sector: 'Technology', geography: 'UAE', capabilities: ['software'],
  total_commitment_aed: 100,
};

describe('portfolio analysis - synergy (W3-11 / SCR-06)', () => {
  test('lists the synergies ranked by overlap strength', () => {
    const s = evaluatePortfolioSynergy(techTarget, { portfolio: register });
    assert.equal(s.version, PORTFOLIO_ANALYSIS_VERSION);
    assert.ok(s.synergy_count > 0);
    assert.equal(s.synergies[0].company, 'SAIF', 'the shared sector + geography + capability ranks first');
    assert.ok(s.synergies[0].weight >= s.synergies[1].weight);
  });

  test('every synergy carries the operating-company sign-off marker', () => {
    const s = evaluatePortfolioSynergy(techTarget, { portfolio: register });
    for (const row of s.synergies) {
      assert.equal(row.signoff, SYNERGY_SIGNOFF_MARKER);
      assert.equal(row.requires_operating_company_signoff, true);
      assert.ok(row.company && row.rationale);
    }
    assert.ok(s.message.includes(SYNERGY_SIGNOFF_MARKER));
  });

  test('caps the list at the configured maximum', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: 'pf-' + i, name: 'Co' + i, sector: 'Technology', geography: 'UAE', capabilities: [] }));
    const s = evaluatePortfolioSynergy(techTarget, { portfolio: many, thresholds: { synergy_max_results: 3 } });
    assert.equal(s.synergy_count, 3);
    assert.equal(s.total_matches, 10);
    assert.equal(SYNERGY_MAX_RESULTS, 5);
  });

  test('an unrelated target yields no synergy', () => {
    const s = evaluatePortfolioSynergy({ target_name: 'X', sector: 'Real Estate', geography: 'KSA', capabilities: ['property'] }, { portfolio: register });
    assert.equal(s.synergy_count, 0);
    assert.ok(s.message.toLowerCase().includes('no portfolio company'));
  });

  test('a declared related party is captured as a synergy kind', () => {
    const s = evaluatePortfolioSynergy({ ...techTarget, related_party: 'Coredge' }, { portfolio: register });
    const row = s.synergies.find((x) => x.company === 'Coredge');
    assert.ok(row.kinds.includes('related_party'));
  });
});

describe('portfolio analysis - conflict & concentration (W3-10 / SCR-07)', () => {
  test('the sector concentration is measured against the ceiling', () => {
    const c = evaluatePortfolioConcentration(techTarget, { portfolio: register });
    assert.equal(c.sector, 'Technology');
    assert.equal(c.basis, 'count');
    assert.equal(c.max_pct, CONCENTRATION_MAX_SECTOR_PCT);
    assert.equal(c.sector_holdings, 3);
    assert.equal(c.post_deal_pct, 66.7);
    assert.equal(c.breach, true);
  });

  test('a sector with no holdings is within the ceiling', () => {
    const c = evaluatePortfolioConcentration({ sector: 'Real Estate' }, { portfolio: register });
    assert.equal(c.post_deal_pct, 16.7);
    assert.equal(c.breach, false, 'a single-deal 16.7% is under the 35% ceiling');
  });

  test('concentration falls back to capital when the register carries figures', () => {
    const cap = [
      { id: 'a', name: 'A', sector: 'Technology', geography: 'UAE', capital_aed: 300, capabilities: [] },
      { id: 'b', name: 'B', sector: 'Energy', geography: 'UAE', capital_aed: 100, capabilities: [] },
    ];
    const c = evaluatePortfolioConcentration({ sector: 'Technology', total_commitment_aed: 100 }, { portfolio: cap });
    assert.equal(c.basis, 'capital');
    assert.equal(c.post_deal_pct, 80);
  });

  test('flags each overlap with the affected portfolio company', () => {
    const cf = evaluatePortfolioConflict(techTarget, { portfolio: register });
    assert.ok(cf.flag_count >= 1);
    for (const f of cf.flags) {
      assert.ok(f.company && f.reason);
      assert.ok(f.kinds.length >= 1);
    }
    // A same-sector-and-geography overlap is a material flag, not an automatic
    // un-mitigable conflict; only a target that IS a portfolio company is.
    assert.ok(cf.flags.some((f) => f.kinds.includes('sector_geography_overlap')));
    assert.equal(cf.unmitigable_count, 0);
  });

  test('a named target already in the portfolio is a high-severity un-mitigable conflict', () => {
    const cf = evaluatePortfolioConflict({ target_name: 'Esyasoft', sector: 'Technology', geography: 'UAE' }, { portfolio: register });
    const hit = cf.flags.find((f) => f.company === 'Esyasoft');
    assert.equal(hit.severity, 'high');
    assert.ok(hit.kinds.includes('name_overlap'));
    assert.equal(hit.unmitigable, true);
  });

  test('an unrelated target raises no conflict and carries a concentration figure', () => {
    const cf = evaluatePortfolioConflict({ target_name: 'Coastal Wind', sector: 'Real Estate', geography: 'KSA', capabilities: ['property management'] }, { portfolio: register });
    assert.equal(cf.flag_count, 0);
    assert.ok(cf.message.toLowerCase().includes('no overlap'));
    assert.ok(cf.concentration.post_deal_pct !== null);
  });

  test('the analysis is advisory and carries no rejection', () => {
    const cf = evaluatePortfolioConflict(techTarget, { portfolio: register });
    assert.ok(cf.message.toLowerCase().includes('advisory'));
    assert.equal('rejected' in cf, false);
  });
});
