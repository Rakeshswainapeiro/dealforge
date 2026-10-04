import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultTemplateLibraryConfig,
  validateTemplateLibraryConfig,
  resolveTemplateLibraryConfig,
  diffTemplateLibraryConfig,
  buildTemplateLibraryConfig,
  templateCatalogue,
  TEMPLATE_LIBRARY_CONFIG_KEY,
} from '../config/templateLibrary.js';
import { TEMPLATE_LIBRARY_IDS, findTemplate } from '../config/templateLibraryData.js';
import { renderTemplate } from '../templateRender.js';

describe('document template library (W5-05 / DOC-06)', () => {
  test('the shipped default lists one entry per template, all enabled', () => {
    const cfg = defaultTemplateLibraryConfig();
    assert.equal(cfg.version, 'TPL-01.1');
    assert.equal(cfg.revision, 1);
    assert.equal(cfg.source, 'default');
    assert.deepEqual(cfg.templates.map((t) => t.id), TEMPLATE_LIBRARY_IDS);
    assert.ok(cfg.templates.every((t) => t.enabled === true));
    assert.equal(TEMPLATE_LIBRARY_CONFIG_KEY, 'template_library_config');
  });

  test('the four acceptance templates exist with the right formats', () => {
    assert.equal(findTemplate('opportunity_overview').format, 'docx');
    assert.equal(findTemplate('financial_model').format, 'csv');
    assert.equal(findTemplate('risk_register').format, 'csv');
    assert.equal(findTemplate('gate_checklist').format, 'csv');
  });

  test('validation rejects an unknown template id', () => {
    const { ok, errors } = validateTemplateLibraryConfig({ templates: [{ id: 'nope' }] });
    assert.equal(ok, false);
    assert.match(errors[0].message, /Unknown template id/);
  });

  test('validation rejects a blank label or owner', () => {
    assert.equal(validateTemplateLibraryConfig({ templates: [{ id: 'risk_register', label: '  ' }] }).ok, false);
    assert.equal(validateTemplateLibraryConfig({ templates: [{ id: 'risk_register', owner: '' }] }).ok, false);
  });

  test('resolve fills templates a partial store omits', () => {
    const resolved = resolveTemplateLibraryConfig({ templates: [{ id: 'risk_register', owner: 'Risk Office' }] });
    assert.equal(resolved.templates.length, TEMPLATE_LIBRARY_IDS.length);
    assert.equal(resolved.templates.find((t) => t.id === 'risk_register').owner, 'Risk Office');
    assert.equal(resolved.source, 'stored');
  });

  test('build mints the next revision and records the actor', () => {
    const next = buildTemplateLibraryConfig(
      { templates: [{ id: 'financial_model', label: 'Financial model v2' }] },
      { actor: { email: 'admin@dealforge.local' }, at: '2026-01-01T00:00:00.000Z' }
    );
    assert.equal(next.revision, 2);
    assert.equal(next.version, 'TPL-01.2');
    assert.equal(next.updated_by, 'admin@dealforge.local');
    assert.equal(next.templates.find((t) => t.id === 'financial_model').label, 'Financial model v2');
  });

  test('build rejects an unknown template id with a 400', () => {
    assert.throws(() => buildTemplateLibraryConfig({ templates: [{ id: 'ghost' }] }), (e) => e.status === 400);
  });

  test('diff reports only the changed fields', () => {
    const before = defaultTemplateLibraryConfig();
    const after = buildTemplateLibraryConfig({ templates: [{ id: 'risk_register', enabled: false }] }, { base: before });
    const changes = diffTemplateLibraryConfig(before, after);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].field, 'enabled');
    assert.equal(changes[0].id, 'risk_register');
  });

  test('the catalogue hides disabled templates and carries a download url', () => {
    const cfg = buildTemplateLibraryConfig({ templates: [{ id: 'risk_register', enabled: false }] });
    const cat = templateCatalogue(cfg);
    assert.equal(cat.length, TEMPLATE_LIBRARY_IDS.length - 1);
    assert.ok(!cat.some((t) => t.id === 'risk_register'));
    const row = cat.find((t) => t.id === 'opportunity_overview');
    assert.equal(row.download_url, '/api/templates/opportunity_overview/download');
    assert.equal(row.maintained, true);
  });

  test('renderTemplate returns a docx buffer for the Opportunity Overview', async () => {
    const out = await renderTemplate('opportunity_overview');
    assert.match(out.contentType, /wordprocessingml/);
    assert.match(out.filename, /\.docx$/);
    assert.ok(out.buffer.length > 2000);
  });

  test('renderTemplate returns CSV with the right header for each csv template', async () => {
    const fin = await renderTemplate('financial_model');
    assert.match(fin.buffer.toString('utf8'), /Line item,Kind,Unit,FY-3 A/);
    const risk = await renderTemplate('risk_register');
    assert.match(risk.buffer.toString('utf8'), /Risk ID,Risk description/);
    assert.match(risk.buffer.toString('utf8'), /R-01/);
    const gate = await renderTemplate('gate_checklist');
    const txt = gate.buffer.toString('utf8');
    assert.match(txt, /Gate #,Gate,Question/);
    assert.match(txt, /Right size/);
  });

  test('renderTemplate rejects an unknown id with a 404', async () => {
    await assert.rejects(() => renderTemplate('ghost'), (e) => e.status === 404);
  });
});
