// Config unit tests — memo evidence document list and the nature-of-business
// theme derivation (E4.1/E5, REQ-DOCGATE-01, REQ-THEME-01).
//
// Pure functions only; these do not need a running server.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  MEMO_SECTIONS, MEMO_DOCUMENT_LIST,
  gateDocumentRequirements, fullDocumentRequirements, documentsForSection, missingMemoEvidence,
} from '../config/memoDocumentList.js';
import { classifyNatureOfBusiness, deriveThemeForOrg, deriveThemesFromOrgs } from '../config/natureOfBusiness.js';
import { DEFAULT_DOCUMENT_REQUIREMENTS } from '../gate.js';
import { DERIVED_THEMES } from '../config/derivedThemes.js';

describe('memo evidence document list', () => {
  test('the gate tier is exactly the minimum set (REQ-DOCGATE-01)', () => {
    const keys = gateDocumentRequirements().map((d) => d.key);
    assert.deepEqual(keys, ['business_plan', 'financials', 'cap_table']);
  });

  test('the seeded requirement set is the full evidence catalogue', () => {
    assert.deepEqual(
      DEFAULT_DOCUMENT_REQUIREMENTS.map((d) => d.key).sort(),
      fullDocumentRequirements().map((d) => d.key).sort(),
    );
  });

  test('only the gate tier is required so evidence never blocks a submit', () => {
    assert.equal(DEFAULT_DOCUMENT_REQUIREMENTS.filter((d) => d.required).length, 3);
    assert.ok(DEFAULT_DOCUMENT_REQUIREMENTS.length > 3, 'expected evidence beyond the gate tier');
  });
  test('only the gate tier is required; evidence stays non-blocking', () => {
    const full = fullDocumentRequirements();
    assert.equal(full.filter((d) => d.required).length, 3);
    assert.ok(full.length > 3, 'expected evidence beyond the gate tier');
  });

  test('every memo section maps to at least one document', () => {
    for (const section of MEMO_SECTIONS) {
      assert.ok(documentsForSection(section.key).length > 0, 'no evidence for ' + section.key);
    }
  });

  test('every catalogue entry feeds a known memo section', () => {
    const known = new Set(MEMO_SECTIONS.map((s) => s.key));
    for (const doc of MEMO_DOCUMENT_LIST) {
      assert.ok(doc.sections.length > 0, doc.key + ' has no section');
      for (const s of doc.sections) assert.ok(known.has(s), doc.key + ' references unknown ' + s);
    }
  });

  test('missing evidence is reported for sections with no uploaded document', () => {
    const missing = missingMemoEvidence(['business_plan']);
    assert.ok(missing.some((s) => s.key === 'company_overview'));
    assert.ok(!missing.some((s) => s.key === 'strategy'));
  });
});

describe('nature-of-business theme derivation', () => {
  test('known registrations classify to the expected sector', () => {
    assert.equal(classifyNatureOfBusiness('Financial services.').sector, 'Financial Services');
    assert.equal(classifyNatureOfBusiness('Smart utilities and energy efficiency solutions.').sector, 'Energy');
    assert.equal(classifyNatureOfBusiness('Computer programming activities.').sector, 'Technology');
    assert.equal(classifyNatureOfBusiness('Specialised dental clinic.').sector, 'Healthcare');
    assert.equal(classifyNatureOfBusiness('Holding company.').sector, 'Holding');
  });

  test('a holding SPV owning property stays a shell, not Real Estate', () => {
    const s = classifyNatureOfBusiness('Holding ownership of equity and non-equity assets, real estate property and intellectual property.');
    assert.equal(s.sector, 'Holding');
  });

  test('a derived theme carries sector, keywords and geography tags', () => {
    const theme = deriveThemeForOrg({
      id: 'org-x', name: 'X', geography: 'United Arab Emirates',
      principal_activities: 'Providing electricity and energy related services.',
    });
    assert.equal(theme.sector, 'Energy');
    assert.ok(theme.keywords.length > 0);
    assert.deepEqual(theme.geographies, ['UAE', 'GCC']);
  });

  test('pure shells are not given a mandate', () => {
    const themes = deriveThemesFromOrgs([
      { id: 'org-shell', name: 'Shell', level: 2, type: 'holding', principal_activities: 'Holding company.' },
      { id: 'org-real', name: 'Real', level: 2, type: 'subsidiary', principal_activities: 'Computer programming activities.' },
    ]);
    assert.deepEqual(themes.map((t) => t.org_id), ['org-real']);
  });

  test('the generated config is non-empty and well formed', () => {
    assert.ok(DERIVED_THEMES.length > 20, 'expected a broad derived set');
    for (const t of DERIVED_THEMES) {
      assert.ok(t.org_id && t.sector, 'each derived theme needs org_id and sector');
      assert.notEqual(t.sector, 'Holding', 'shells must be excluded');
      assert.ok(Array.isArray(t.keywords) && Array.isArray(t.geographies));
    }
  });
});
