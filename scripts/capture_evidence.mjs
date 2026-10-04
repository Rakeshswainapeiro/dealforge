// DealForge evidence capture harness (W1-13).
//
// Drives a real Chrome against the demo stack and writes screenshots into
// docs/evidence/<TODO-ID>/<persona>_<feature>.png. It is an operator tool, not
// a runtime dependency: kept out of the app build and the test suite.
//
//   node scripts/capture_evidence.mjs --only=W1-11,W1-12
//   BASE=http://localhost:34010 node scripts/capture_evidence.mjs
//
// playwright-core is resolved from a repo/global install or an npx cache (see
// resolvePlaywright) so the repo does not take a browser-automation dependency.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.BASE_URL_PW || process.env.BASE || 'http://localhost:34010').replace(/[/]+$/, '');
const PASSWORD = process.env.DEFAULT_USER_PASSWORD || 'DealForge!2026';

const require = createRequire(import.meta.url);

// Resolve playwright-core from the repo, a global install, or an npx cache.
function resolvePlaywright() {
  try { return require('playwright-core'); } catch { /* not a repo dep */ }
  const home = process.env.HOME || '';
  const cache = path.join(home, '.npm', '_npx');
  const candidates = [];
  if (fs.existsSync(cache)) {
    for (const entry of fs.readdirSync(cache)) {
      candidates.push(path.join(cache, entry, 'node_modules', 'playwright-core'));
    }
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return require(c);
  }
  throw new Error('playwright-core not found; install it or run once via npx playwright');
}

// Each persona uses its real seeded account so the shot shows the role view.
export const PERSONAS = {
  admin: 'admin@dealforge.local',
  preparer: 'deal.lead@infinia.local',
  analyst: 'cio@sirius.local',
  reviewer: 'reviewer@sirius.local',
  cfo: 'cfo@infinia.local',
  ceo: 'ceo@infinia.local',
  leadership: 'fahad@sirius.local',
  vertical_head: 'vertical.head@sirius.local',
};

// Some persona journeys are owned by a specific subsidiary's seat (the
// refinement fixture belongs to Finstreet), so a shot may log in as the
// persona's account for that entity while still being filed under the journey
// persona's name.
const PERSONA_EMAIL_OVERRIDE = {
  finstreet_preparer: 'deal.lead@finstreet.local',
};

async function login(page, email) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('#email', email);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    // Give the client time to exchange the session and route away from /login.
    try {
      await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 15000 });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(1200);
      return;
    } catch {
      if (attempt === 3) throw new Error('login did not leave /login for ' + email);
      await page.waitForTimeout(1500);
    }
  }
}

// Open the opportunity named `name` from the intake list so a journey shot
// points at the exact fixture rather than a blank form.
async function openOpportunity(page, name) {
  await page.goto(BASE + '/SubmitOpportunity', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  // The list rows are buttons; match those directly so the click selects the
  // fixture rather than landing on a wrapping card element.
  const card = page.locator('button', { hasText: name }).first();
  try {
    await card.click({ timeout: 5000 });
    // Selecting a fixture resolves the gate, which is what paints the
    // per-section completion indicators.
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid^="section-progress-"]').length > 0,
      { timeout: 10000 }
    );
    await page.waitForTimeout(800);
    return true;
  } catch {
    return false;
  }
}

// Radix Select is not a native <select>: open the trigger, then click the
// portalled option whose accessible name matches. Used by the W1-01 shots.
async function setScreenSelect(page, key, matcher) {
  await page.click('#screen-' + key);
  await page.getByRole('option', { name: matcher }).first().click({ timeout: 5000 });
  await page.waitForTimeout(150);
}


// Open the ScreeningBoard and click the board card whose title matches, so a
// board shot points at a specific submitted fixture (W1-09 / W1-10).
async function openBoardCard(page, name) {
  await page.goto(BASE + '/ScreeningBoard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  const card = page.locator('button', { hasText: name }).first();
  await card.click({ timeout: 8000 });
  await page.waitForTimeout(1200);
}

// API helpers for shots that need server state set before the screen is opened.
// They act as the owning subsidiary's deal lead (the fixture preparer).
async function apiJson(path, { method = 'GET', body, user = 'user-deal-lead' } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-user-id': user },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, data: text }; }
}

// Find a board fixture by its opportunity name so a shot can act on the exact
// record rather than the first card in a column.
async function findOpportunityByName(name) {
  const { data } = await apiJson('/api/pipeline/board');
  const items = (data.columns || []).flatMap((c) => c.items || []);
  return items.find((o) => o.opportunity_name === name)
    || items.find((o) => (o.opportunity_name || '').includes(name));
}

async function setDataroomLink(id, payload) {
  await apiJson('/api/pipeline/opportunities/' + id + '/dataroom-link', { method: 'PUT', body: payload });
}

async function clearDataroomLink(id) {
  await apiJson('/api/pipeline/opportunities/' + id + '/dataroom-link', { method: 'DELETE' });
}

// The W8-06 lifecycle shot needs a deactivated account that is visibly one of
// the console's own users. The admin console only answers to a real Better Auth
// session, so the setup calls are made from inside the logged-in page (cookies
// included) rather than the header-based Node helper.
const DEACTIVATED_EMAIL = 'w8-06-fixture@dealforge.local';

async function ensureDeactivatedFixture(page) {
  const result = await page.evaluate(async (email) => {
    const call = async (path, opts = {}) => {
      const res = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        ...opts,
      });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data };
    };
    // Create the fixture account (ignore a conflict from a previous run).
    const list = await call('/api/admin/users');
    let user = (list.data.users || []).find((u) => u.email === email);
    if (!user) {
      const orgs = await call('/api/admin/organizations');
      const orgId = orgs.data[0] && orgs.data[0].id;
      const created = await call('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ full_name: 'W8-06 Lifecycle Fixture', email, password: 'Fixture!2026', org_id: orgId, roles: ['analyst'] }),
      });
      user = created.data;
    }
    // Deactivate it (idempotent: comes back active after a reactivation run).
    const detail = await call('/api/admin/users/' + user.id);
    if (detail.data.is_active !== false) {
      await call('/api/admin/users/' + user.id, { method: 'DELETE' });
    }
    return { id: user.id };
  }, DEACTIVATED_EMAIL);
  return result;
}

// Open the Q&A inbox and select a thread whose subject matches, so a
// visibility shot points at the exact thread (W6-04 / AUD-03).
async function openQaThread(page, subject) {
  await page.goto(BASE + '/QandA', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const card = page.locator('button', { hasText: subject }).first();
  await card.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  await card.click({ timeout: 8000 });
  await page.waitForTimeout(1400);
}

// Open the Opportunity Route page and pick the fixture named `name` from the
// Radix opportunity select, so an on-route shot points at the exact record.
async function openOpportunityRoute(page, name) {
  await page.goto(BASE + '/OpportunityRoute', { waitUntil: 'networkidle' });
  await page.waitForSelector('#opportunity-select', { timeout: 12000 });
  await page.click('#opportunity-select');
  await page.getByRole('option', { name: new RegExp(name, 'i') }).first().click({ timeout: 8000 });
  await page.waitForTimeout(1500);
}

// Perform a state move from the detail sheet: click the target-state button,
// type the reason and confirm. commentRequired states gate the confirm button.
async function moveOpportunity(page, stateLabel, comment) {
  await page.getByRole('button', { name: new RegExp('^' + stateLabel + '$', 'i') }).first().click({ timeout: 8000 });
  await page.waitForSelector('[data-testid="transition-comment"]', { timeout: 8000 });
  if (comment) await page.fill('[data-testid="transition-comment"]', comment);
  await page.getByRole('button', { name: /confirm/i }).first().click({ timeout: 8000 });
  await page.waitForTimeout(1800);
}

const SHOTS = [
  {
    id: 'W1-01', persona: 'preparer', feature: 'self_screen_stop',
    // The pre-form self-screen halts an outside-appetite type with an explicit
    // reason before any drafting effort (INT-02 / REQ-RULE-04).
    async run(page) {
      await page.goto(BASE + '/SubmitOpportunity', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      await setScreenSelect(page, 'opportunity_type', /Passive, non-strategic punt/i);
      await page.fill('#screen-total_commitment_aed', '25');
      await setScreenSelect(page, 'sector', /^Industrials$/);
      await setScreenSelect(page, 'geography', /^UAE$/);
      await setScreenSelect(page, 'in_approved_budget', /^Yes/);
      await page.getByRole('button', { name: /Run self-screen/i }).click();
      await page.waitForSelector('[data-testid="self-screen-stop"]', { timeout: 10000 });
      await page.waitForTimeout(600);
    },
  },
  {
    id: 'W1-01', persona: 'preparer', feature: 'self_screen_pass',
    // A clean in-appetite, above-floor case passes and opens the capture form;
    // the answers seeded the header so the preparer answers nothing twice.
    async run(page) {
      await page.goto(BASE + '/SubmitOpportunity', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      await setScreenSelect(page, 'opportunity_type', /Strategic acquisition/i);
      await page.fill('#screen-total_commitment_aed', '120');
      await setScreenSelect(page, 'sector', /^Technology$/);
      await setScreenSelect(page, 'geography', /^UAE$/);
      await setScreenSelect(page, 'in_approved_budget', /^Yes/);
      await page.getByRole('button', { name: /Run self-screen/i }).click();
      await page.waitForSelector('[data-testid="self-screen-pass"]', { timeout: 10000 });
      await page.waitForTimeout(600);
    },
  },
  {
    id: 'W1-03', persona: 'preparer', feature: 'six_section_form',
    // Select a loaded fixture so the gate resolves and every section header
    // shows the per-section completion indicator (INT-06).
    async run(page) {
      await openOpportunity(page, 'Vision Care Imaging Platform');
      // Stay near the top so the header section and its completion indicator
      // sit next to the section titles that prove the six-section model.
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);
    },
  },
  {
    id: 'W1-04', persona: 'preparer', feature: 'accretion_statement',
    // Scroll the Accretion form section (§3.3) into view so its structured
    // fields sit next to the section heading on the selected fixture.
    async run(page) {
      await openOpportunity(page, 'Vision Care Imaging Platform');
      const anchor = page.locator('[data-testid="section-progress-accretion"]');
      await anchor.scrollIntoViewIfNeeded().catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -260));
      await page.waitForTimeout(600);
    },
  },
  {
    id: 'W1-02', persona: 'preparer', feature: 'below_floor_tagged',
    // The seeded sub-floor fixture that carries the portfolio-synergy statement
    // and a base IRR of 35% shows the route satisfied: tagged as a below-floor
    // exception and escalated to Sirius (INT-03).
    async run(page) {
      await openOpportunity(page, 'Small Bolt-on with Portfolio Synergy');
      const anchor = page.locator('[data-testid="below-floor-tagged"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(600);
    },
  },
  {
    id: 'W1-02', persona: 'preparer', feature: 'below_floor_route_incomplete',
    // A sub-floor ticket that took the exception but has no synergy statement
    // and an IRR below the 35% bar: the form lists exactly what the route still
    // needs before it can be submitted.
    async run(page) {
      await openOpportunity(page, 'Sub-floor Ticket (exception incomplete)');
      const anchor = page.locator('[data-testid="below-floor-route"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(600);
    },
  },
  {
    id: 'W1-02', persona: 'preparer', feature: 'below_floor_submit_blocked',
    // The submit route refuses the incomplete exception with 422 and the form
    // shows the block message, so the case cannot leave subsidiary level.
    async run(page) {
      await openOpportunity(page, 'Sub-floor Ticket (exception incomplete)');
      await page.getByRole('button', { name: /submit for screening/i }).first().click();
      await page.waitForSelector('[data-testid="submit-blocked"]', { timeout: 10000 });
      const anchor = page.locator('[data-testid="submit-blocked"]');
      await anchor.scrollIntoViewIfNeeded().catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -180));
      await page.waitForTimeout(600);
    },
  },
  {
    id: 'W1-05', persona: 'preparer', feature: 'qualifying_gates_all_ready',
    // The ten qualifying gates (INT-08) on a completed fixture: every gate is
    // answered YES with its evidence linked, so the checklist reads "All ten ready".
    async run(page) {
      await openOpportunity(page, 'Vision Care Imaging Platform');
      const anchor = page.locator('[data-testid="qualifying-gates"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(600);
    },
  },
  {
    id: 'W1-05', persona: 'preparer', feature: 'qualifying_gate_no_blocked',
    // A complete draft with the "Accretive" gate answered NO: the checklist names
    // the blocking gate and shows the not-ready message (INT-08).
    async run(page) {
      await openOpportunity(page, 'Bolt-on (not accretive)');
      const anchor = page.locator('[data-testid="qualifying-gates-blocked"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(600);
    },
  },
  {
    id: 'W1-05', persona: 'preparer', feature: 'qualifying_gate_submit_blocked',
    // Submitting the NO-answer draft is refused: the form shows the blocking
    // result rather than a success (INT-08 acceptance).
    async run(page) {
      await openOpportunity(page, 'Bolt-on (not accretive)');
      await page.getByRole('button', { name: /submit for screening/i }).first().click();
      await page.waitForSelector('[data-testid="qualifying-gates-blocked"]', { timeout: 10000 });
      const anchor = page.locator('[data-testid="submit-blocked"], [data-testid="qualifying-gates-blocked"]').first();
      await anchor.scrollIntoViewIfNeeded().catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(600);
    },
  },
  {
    id: 'W1-06', persona: 'preparer', feature: 'attestations_all_ready',
    // The CEO + CFO attestation card (INT-09) on a completed fixture: both
    // named attestations are recorded, each showing signer, time and IP.
    async run(page) {
      await openOpportunity(page, 'Vision Care Imaging Platform');
      const anchor = page.locator('[data-testid="attestations"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, 470));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W1-06', persona: 'ceo', feature: 'attestation_one_signed',
    // A complete draft with neither attestation: the CEO signs their own
    // attestation, leaving only the CFO outstanding (INT-09).
    async run(page) {
      await openOpportunity(page, 'Complete Draft Awaiting CEO/CFO Sign-off');
      await page.locator('[data-testid="attestation-ceo-sign"]').click({ timeout: 8000 });
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="attestation-ceo-meta"]');
          return !!el;
        },
        { timeout: 12000 }
      ).catch(() => {});
      const anchor = page.locator('[data-testid="attestations"]');
      await anchor.scrollIntoViewIfNeeded().catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -140));
      await page.waitForTimeout(800);
    },
  },
  {
    id: 'W1-06', persona: 'preparer', feature: 'attestation_submit_blocked',
    // Submitting while an attestation is outstanding is refused: the form
    // shows the block rather than a success (INT-09 acceptance).
    async run(page) {
      await openOpportunity(page, 'Complete Draft Awaiting CEO/CFO Sign-off');
      await page.getByRole('button', { name: /submit for screening/i }).first().click();
      await page.waitForSelector('[data-testid="attestations-blocked"]', { timeout: 10000 }).catch(() => {});
      const anchor = page.locator('[data-testid="submit-blocked"], [data-testid="attestations-blocked"]').first();
      await anchor.scrollIntoViewIfNeeded().catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -160));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W1-07', persona: 'preparer', feature: 'greenfield_tests_incomplete',
    // A Feasibility-stage greenfield with unsecured funding: the card names
    // every extra test still open (INT-10).
    async run(page) {
      await openOpportunity(page, 'Greenfield Sustainable Fuels Venture');
      const anchor = page.locator('[data-testid="greenfield-tests"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -180));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W1-07', persona: 'preparer', feature: 'greenfield_tests_ready',
    // A Concept-stage greenfield that clears the extra tests: funding secured
    // and the Concept 2-page note rule shown (INT-10 positive case).
    async run(page) {
      await openOpportunity(page, 'Greenfield Smart-Energy Venture');
      const anchor = page.locator('[data-testid="greenfield-tests-ready"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -180));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W1-07', persona: 'preparer', feature: 'greenfield_submit_blocked',
    // Submitting the unsecured feasibility entry is refused: the form shows
    // the block rather than a success (INT-10 acceptance).
    async run(page) {
      await openOpportunity(page, 'Greenfield Sustainable Fuels Venture');
      await page.getByRole('button', { name: /submit for screening/i }).first().click();
      await page.waitForSelector('[data-testid="submit-blocked"], [data-testid="greenfield-tests"]', { timeout: 10000 }).catch(() => {});
      const anchor = page.locator('[data-testid="submit-blocked"], [data-testid="greenfield-tests"]').first();
      await anchor.scrollIntoViewIfNeeded().catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -160));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W1-08', persona: 'preparer', feature: 'sourcing_affiliate_related_party',
    // An IHC / affiliate referral auto-sets the related-party flag; the card
    // names the side-effect and the self-screen raises the related-party flag
    // (INT-05).
    async run(page) {
      await openOpportunity(page, 'Affiliate Referral \u2014 Digital Assets Custody');
      const anchor = page.locator('[data-testid="sourcing-channel-effects"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -180));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W1-08', persona: 'preparer', feature: 'sourcing_banker_compressed_timeline',
    // A banker / advisor-led channel sets the compressed-timeline indicator,
    // shown on the sourcing card (INT-05).
    async run(page) {
      await openOpportunity(page, 'Accelerated Data Centre Platform');
      const anchor = page.locator('[data-testid="sourcing-channel-effects"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -180));
      await page.waitForTimeout(700);
    },
  },

  {
    id: 'W1-09', persona: 'preparer', feature: 'withdraw_reason_dialog',
    // The preparer withdraws a live submission and must give a reason; the
    // confirm button is disabled until the reason is typed (INT-13).
    async run(page) {
      await openBoardCard(page, 'Withdraw Demo Opportunity');
      await page.getByRole('button', { name: /^Withdrawn$/i }).first().click({ timeout: 8000 });
      await page.waitForSelector('[data-testid="transition-comment"]', { timeout: 8000 });
      await page.waitForTimeout(500);
    },
  },
  {
    id: 'W1-09', persona: 'preparer', feature: 'withdrawn_in_history',
    // After the withdrawal the item sits in the Withdrawn column with the
    // reason carried on the transition history (visible in reports) (INT-13).
    async run(page) {
      await openBoardCard(page, 'Withdraw Demo Opportunity');
      await page.getByRole('button', { name: /^Withdrawn$/i }).first().click({ timeout: 8000 });
      await page.waitForSelector('[data-testid="transition-comment"]', { timeout: 8000 });
      await page.fill('[data-testid="transition-comment"]', 'Budget reallocated for the quarter');
      await page.getByRole('button', { name: /confirm/i }).first().click({ timeout: 8000 });
      await page.waitForTimeout(2200);
    },
  },
  {
    id: 'W1-10', persona: 'analyst', feature: 'duplicate_warning',
    // The Investment Team sees the cross-group duplicate warning on the item
    // and can link or dismiss it; the subsidiary never sees this (INT-12).
    async run(page) {
      await openBoardCard(page, 'Cloud Platforms Consolidation');
      const panel = page.locator('[data-testid="duplicate-panel"]');
      await panel.waitFor({ timeout: 12000 });
      await panel.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -140));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W1-10', persona: 'analyst', feature: 'duplicate_dismissed',
    // Dismissing a pair records the Investment Team decision and drops the
    // warning from the live list while keeping it on the audit trail (INT-12).
    async run(page) {
      await openBoardCard(page, 'Cloud Platforms Consolidation');
      const panel = page.locator('[data-testid="duplicate-panel"]');
      await panel.waitFor({ timeout: 12000 });
      await page.getByRole('button', { name: /^Dismiss$/i }).first().click({ timeout: 8000 });
      await page.waitForTimeout(2200);
    },
  },

  {
    id: 'W1-11', persona: 'admin', feature: 'sample_data_console',
    // Operator view: resolved seed profile, live inventory and the clean/load
    // controls that implement REQ-SEED-02.
    async run(page) {
      await page.goto(BASE + '/SuperAdmin', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      await page.getByRole('tab', { name: /Sample Data/i }).click();
      await page.waitForTimeout(1800);
    },
  },
  {
    id: 'W1-11', persona: 'admin', feature: 'seed_audit_trail',
    async run(page) {
      await page.goto(BASE + '/SuperAdmin', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      await page.getByRole('tab', { name: /Audit/i }).click();
      await page.waitForTimeout(1500);
    },
  },
  {
    id: 'W1-12', persona: 'admin', feature: 'sample_inventory',
    async run(page) {
      await page.goto(BASE + '/SuperAdmin', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      await page.getByRole('tab', { name: /Sample Data/i }).click();
      await page.waitForTimeout(1800);
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(800);
    },
  },
  {
    id: 'W1-12', persona: 'preparer', feature: 'intake_fixtures',
    // Persona-owned fixtures across the states, on the intake list.
    async run(page) {
      await page.goto(BASE + '/SubmitOpportunity', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1800);
    },
  },
  {
    id: 'W1-12', persona: 'analyst', feature: 'screening_fixtures',
    // The theme-aligned, conflict and related-party cases on the board.
    async run(page) {
      await page.goto(BASE + '/ScreeningBoard', { waitUntil: 'networkidle' });
      await page.waitForTimeout(2200);
    },
  },
  {
    id: 'W1-12', persona: 'preparer', email: 'finstreet_preparer', feature: 'fixture_state_refinement',
    // The Finstreet-owned fixture sits in refinement, so its own preparer's
    // intake list proves the loader walked real transitions and not just drafts.
    async run(page) {
      await page.goto(BASE + '/SubmitOpportunity', { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
    },
  },
  {
    id: 'W2-01', persona: 'preparer', feature: 'financial_summary_grid',
    // The eight-row Part B page-4 financial summary on a going-concern fixture:
    // captured inputs next to the derived growth %, EBITDA margin %, free cash
    // flow and net debt / EBITDA (FIN-01).
    async run(page) {
      await openOpportunity(page, 'Vision Care Imaging Platform');
      const anchor = page.locator('[data-testid="financial-grid"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-01', persona: 'analyst', feature: 'memo_financial_summary',
    // The same matrix renders in the generated Sirius Part B memo (page 4),
    // with the derived ratios filled — the target-format acceptance check.
    async run(page) {
      await openBoardCard(page, 'Vision Care Imaging Platform');
      await page.getByRole('button', { name: /Create Sirius memo/i }).first().click({ timeout: 8000 });
      await page.waitForSelector('[data-testid="memo-fin-table"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="memo-fin-table"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -140));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-01', persona: 'preparer', feature: 'financial_greenfield_blank_actuals',
    // A greenfield new venture may leave the audited actuals blank; only the
    // Y1–Y5 projection columns carry values (FIN-01).
    async run(page) {
      await openOpportunity(page, 'Greenfield Smart-Energy Venture');
      const anchor = page.locator('[data-testid="financial-grid"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-02', persona: 'preparer', feature: 'statement_model_balanced',
    // The three-statement check on a going-concern fixture: the linked P&L,
    // balance sheet and cash flow are all present, the balance sheet balances
    // in every period and the model is the Sirius template — accepted, not
    // flagged (FIN-02).
    async run(page) {
      await openOpportunity(page, 'Vision Care Imaging Platform');
      const anchor = page.locator('[data-testid="statement-model-card"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-02', persona: 'preparer', feature: 'statement_model_greenfield',
    // A new venture's projections-only model still balances and counts as
    // complete, so FIN-01's blank actuals and FIN-02's presence check agree.
    async run(page) {
      await openOpportunity(page, 'Greenfield Sustainable Fuels Venture');
      const anchor = page.locator('[data-testid="statement-model-card"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-02', persona: 'preparer', feature: 'statement_model_flagged_unbalanced',
    // The advisory flag in action: an in-review submission whose balance sheet
    // does not balance is accepted but flagged for manual review, never
    // silently discarded (FIN-02 accept criterion).
    async run(page) {
      await openOpportunity(page, 'Cloud Platforms Consolidation');
      const anchor = page.locator('[data-testid="statement-model-card"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-03', persona: 'preparer', feature: 'returns_three_scenarios',
    // The three-scenario returns card on a going-concern fixture: Equity IRR,
    // ROIC, payback and MOIC captured for base, upside and downside, with the
    // downside present — all scenarios captured (FIN-03).
    async run(page) {
      await openOpportunity(page, 'Vision Care Imaging Platform');
      const anchor = page.locator('[data-testid="returns-scenarios-card"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-03', persona: 'preparer', feature: 'returns_downside_missing',
    // A draft that captured only a base IRR: the advisory flag names the
    // mandatory downside as the gap and never blocks the draft (FIN-03 accept
    // criterion: 'Downside case must be present').
    async run(page) {
      await openOpportunity(page, 'Small Bolt-on with Portfolio Synergy');
      const anchor = page.locator('[data-testid="returns-scenarios-card"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-03', persona: 'analyst', feature: 'memo_returns_scenarios',
    // The captured returns flow through to the generated Sirius Part B memo
    // (page 4) returns table, base / upside / downside per metric (FIN-03).
    async run(page) {
      await openBoardCard(page, 'Vision Care Imaging Platform');
      await page.getByRole('button', { name: /Create Sirius memo/i }).first().click({ timeout: 8000 });
      await page.waitForSelector('[data-testid="memo-returns-table"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="memo-returns-table"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -160));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-05', persona: 'preparer', feature: 'wacc_entity_default',
    // An opportunity with no override inherits the cost of capital Sirius set
    // for the owning entity: the card reads 'Entity default' and shows the
    // effective rate and its source (FIN-05: default by entity).
    async run(page) {
      await openOpportunity(page, 'Vision Care Imaging Platform');
      const anchor = page.locator('[data-testid="wacc-card"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-05', persona: 'preparer', feature: 'wacc_override_with_reason',
    // The reasoned-override fixture belongs to Finstreet, so sign in as that
    // subsidiary's deal lead while keeping the shot filed under the preparer
    // journey persona.
    email: 'finstreet_preparer',
    // A defensible per-deal override: the preparer raised WACC above the entity
    // default and supplied a reason, so the card reads 'Per-deal override' and
    // prints the rationale (FIN-05: override requires reason).
    async run(page) {
      await openOpportunity(page, 'Industrial Logistics Adjacency');
      const anchor = page.locator('[data-testid="wacc-card"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-05', persona: 'preparer', feature: 'wacc_override_missing_reason',
    // The guardrail: an override with no reason is flagged, not applied
    // silently (FIN-05 accept criterion 'override requires reason').
    async run(page) {
      await openOpportunity(page, 'Telecom Fibre Roll-up');
      const anchor = page.locator('[data-testid="wacc-card"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForSelector('[data-testid="wacc-flag"]', { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },

  {
    id: 'W2-04', persona: 'preparer', feature: 'hurdle_table_per_scenario',
    // The automatic hurdle test on a going-concern fixture: every hurdle is
    // judged per captured case, so the base and upside columns meet while the
    // downside falls short and is flagged amber — never blocked (FIN-04).
    async run(page) {
      await openOpportunity(page, 'Vision Care Imaging Platform');
      const anchor = page.locator('[data-testid="hurdle-table-card"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-04', persona: 'preparer', feature: 'hurdle_table_all_met',
    // A captured case that clears every hurdle shows the green 'All hurdles
    // met' state and the pass count per scenario (FIN-04 accept criterion).
    async run(page) {
      await openOpportunity(page, 'Small Bolt-on with Portfolio Synergy');
      const anchor = page.locator('[data-testid="hurdle-table-card"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForSelector('[data-testid="hurdle-table-ok"]', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-04', persona: 'analyst', feature: 'memo_hurdle_table',
    // The computed hurdle verdicts flow through to the generated Sirius Part B
    // memo (page 4): six hurdle rows with live thresholds, a per-scenario
    // Meets? verdict and the policy-version note (FIN-04, values versioned).
    async run(page) {
      await openBoardCard(page, 'Vision Care Imaging Platform');
      await page.getByRole('button', { name: /Create Sirius memo/i }).first().click({ timeout: 8000 });
      await page.waitForSelector('[data-testid="memo-returns-table"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="memo-returns-table"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -160));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-06', persona: 'preparer', feature: 'sources_uses_balanced',
    // A reconciled funding plan that exhausts the cheaper sources before the
    // Sirius ask: sources equal uses and no hierarchy warning fires (FIN-06).
    async run(page) {
      await openOpportunity(page, 'Vision Care Imaging Platform');
      const anchor = page.locator('[data-testid="sources-uses-card"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForSelector('[data-testid="sources-uses-ok"]', { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-06', persona: 'preparer', feature: 'sources_uses_hierarchy_flag',
    // Sirius capital secured while a cheaper source is still only indicative:
    // the advisory funding-hierarchy warning fires but the plan still submits
    // (FIN-06 accept criterion).
    async run(page) {
      await openOpportunity(page, 'Small Bolt-on with Portfolio Synergy');
      const anchor = page.locator('[data-testid="sources-uses-card"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForSelector('[data-testid="sources-uses-hierarchy-flag"]', { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-06', persona: 'analyst', feature: 'memo_sources_uses',
    // The captured sources-and-uses flow through to the generated Sirius Part B
    // memo: the funding tables carry the sources with % and status, the uses,
    // and the note that sources equal uses (FIN-06).
    async run(page) {
      await openBoardCard(page, 'Vision Care Imaging Platform');
      await page.getByRole('button', { name: /Create Sirius memo/i }).first().click({ timeout: 8000 });
      await page.waitForSelector('[data-testid="memo-funding-tables"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="memo-funding-tables"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -160));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-07', persona: 'preparer', feature: 'budget_status_in_budget',
    // An in-budget opportunity with the budget line reference recorded: the
    // card reads 'In approved budget' and shows the green confirmed state with
    // no block (FIN-07 in-budget case).
    async run(page) {
      await openOpportunity(page, 'Vision Care Imaging Platform');
      const anchor = page.locator('[data-testid="budget-status-card"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForSelector('[data-testid="budget-status-ok"]', { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-07', persona: 'preparer', feature: 'budget_status_off_budget',
    // An off-budget opportunity with a variance justification but no variance
    // memo yet: the card reads 'Off-budget' and the red block makes the
    // variance-memo upload mandatory before submission (FIN-07 accept
    // criterion: if 'No', a variance memo upload becomes mandatory).
    async run(page) {
      await openOpportunity(page, 'Greenfield Sustainable Fuels Venture');
      const anchor = page.locator('[data-testid="budget-status-card"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForSelector('[data-testid="budget-status-flag"]', { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-07', persona: 'analyst', feature: 'memo_budget_status',
    // The captured budget status flows through to the generated Sirius Part B
    // memo: the funding note carries the budget status and the line reference
    // (or the variance justification) (FIN-07).
    async run(page) {
      await openBoardCard(page, 'Vision Care Imaging Platform');
      await page.getByRole('button', { name: /Create Sirius memo/i }).first().click({ timeout: 8000 });
      await page.waitForSelector('[data-testid="memo-funding-tables"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="memo-funding-tables"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -160));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-08', persona: 'preparer', feature: 'valuation_complete',
    // A complete structured entry valuation — EV basis, amount, multiple and
    // method — with a three-name comparable set and the exit route / timing:
    // the card reads complete with no advisory flags (FIN-09 accept criterion).
    async run(page) {
      await openOpportunity(page, 'Vision Care Imaging Platform');
      const anchor = page.locator('[data-testid="valuation-card"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForSelector('[data-testid="valuation-ok"]', { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-08', persona: 'preparer', feature: 'valuation_incomplete_flag',
    // A partial capture — an amount and multiple but no basis or method, and
    // only two comparables — raises advisory flags without blocking (FIN-09:
    // a partial capture is flagged, never discarded).
    async run(page) {
      await openOpportunity(page, 'Small Bolt-on with Portfolio Synergy');
      const anchor = page.locator('[data-testid="valuation-card"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForSelector('[data-testid="valuation-flag"]', { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-08', persona: 'analyst', feature: 'memo_valuation_table',
    // The captured entry valuation and comparable set flow through to the
    // generated Sirius Part B memo as their own table, with the exit route and
    // timing beneath it (FIN-09).
    async run(page) {
      await openBoardCard(page, 'Vision Care Imaging Platform');
      await page.getByRole('button', { name: /Create Sirius memo/i }).first().click({ timeout: 8000 });
      await page.waitForSelector('[data-testid="memo-valuation-table"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="memo-valuation-table"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -160));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-09', persona: 'preparer', feature: 'cross_border_complete',
    // A cross-border deal — an India target owned by a UAE subsidiary — with all
    // four considerations captured: the card appears and reads complete with no
    // advisory flags (FIN-08 accept criterion: fields appear when the target
    // geography differs from the subsidiary's home country).
    async run(page) {
      await openOpportunity(page, 'India Diagnostics Expansion');
      const anchor = page.locator('[data-testid="cross-border-card"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForSelector('[data-testid="cross-border-ok"]', { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-09', persona: 'preparer', feature: 'cross_border_not_applicable',
    // A same-country deal — a UAE target owned by a UAE subsidiary — shows no
    // cross-border card at all: the block is conditional on geography (FIN-08).
    async run(page) {
      await openOpportunity(page, 'Vision Care Imaging Platform');
      const card = page.locator('[data-testid="cross-border-card"]');
      const present = await card.count();
      if (present !== 0) throw new Error('expected no cross-border card for a same-country deal');
      // Frame the tail of the valuation card and the start of the funding
      // section so the absence of a 4c block between them is visible.
      const anchor = page.locator('[data-testid="valuation-ok"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -40));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-09', persona: 'analyst', feature: 'memo_cross_border',
    // The captured cross-border considerations flow through to the generated
    // Sirius Part B memo as their own table, with the target-vs-home note
    // beneath it (FIN-08).
    async run(page) {
      await openBoardCard(page, 'India Diagnostics Expansion');
      await page.getByRole('button', { name: /Create Sirius memo/i }).first().click({ timeout: 8000 });
      await page.waitForSelector('[data-testid="memo-cross-border"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="memo-cross-border"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -160));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-10', persona: 'preparer', feature: 'currency_complete_usd',
    // A USD-reported deal with the FX rate recorded (AED per USD): the
    // currency / FX card reads complete and names the rate used, so every
    // figure is reproducible against the AED base (NFR-08 accept criterion:
    // currency and unit shown on every financial field; FX rate recorded).
    async run(page) {
      await openOpportunity(page, 'US Water Infrastructure Platform');
      const anchor = page.locator('[data-testid="currency-card"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForSelector('[data-testid="currency-ok"]', { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-10', persona: 'preparer', feature: 'currency_default_aed',
    // The default AED base: no FX rate is asked for or needed, the unit note
    // reads 'AED mn' and the card is complete with no advisory flags (NFR-08).
    async run(page) {
      await openOpportunity(page, 'Vision Care Imaging Platform');
      const anchor = page.locator('[data-testid="currency-card"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      const note = page.locator('[data-testid="currency-unit-note"]');
      await note.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-10', persona: 'preparer', feature: 'currency_flag_missing_rate',
    // A USD-reported deal with no FX rate captured: the advisory flag asks for
    // the AED per USD rate and never blocks the draft (NFR-08).
    async run(page) {
      await openOpportunity(page, 'US Cold-chain Logistics Bolt-on');
      const anchor = page.locator('[data-testid="currency-card"]');
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForSelector('[data-testid="currency-flag"]', { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W2-10', persona: 'analyst', feature: 'memo_currency_label',
    // The USD-reported deal flows into the generated Sirius Part B memo: the
    // page-4 financial matrix is headed 'USD mn' and every figure is labelled
    // in USD mn (NFR-08: currency and unit shown on every financial field).
    async run(page) {
      await openBoardCard(page, 'US Water Infrastructure Platform');
      await page.getByRole('button', { name: /Create Sirius memo/i }).first().click({ timeout: 8000 });
      await page.waitForSelector('[data-testid="memo-fin-table"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="memo-fin-table"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -160));
      await page.waitForTimeout(700);
    },
  },

  {
    id: 'W3-01', persona: 'analyst', feature: 'screening_panel_overview',
    // The single screening panel on a submitted opportunity: the six BRD checks
    // - eligibility, hard filters, hurdle tests, alignment, synergy & conflict
    // and completeness - each with a result, a rationale and evidence chips, and
    // a recommendation the person acts on (SCR-01; SCR-09 advisory).
    async run(page) {
      await openBoardCard(page, 'Vision Care Imaging Platform');
      await page.waitForSelector('[data-testid="screening-panel"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="screening-panel"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -160));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W3-01', persona: 'analyst', feature: 'screening_panel_alignment_flag',
    // A theme-exception opportunity: the alignment check flags against the
    // subsidiary mandate while the remaining checks stay independent, so the
    // panel shows the whole screen on one view (SCR-01).
    async run(page) {
      await openBoardCard(page, 'Industrial Logistics Adjacency');
      await page.waitForSelector('[data-testid="screening-check-alignment"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="screening-panel"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -160));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W3-01', persona: 'analyst', feature: 'screening_panel_conflict_signals',
    // An affiliate-referral opportunity: the synergy & conflict check surfaces
    // the related-party signal as evidence while the panel stays advisory
    // (SCR-01; SCR-09 keeps a person in the decision).
    async run(page) {
      await openBoardCard(page, 'Affiliate Referral');
      await page.waitForSelector('[data-testid="screening-check-synergy_conflict"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="screening-check-synergy_conflict"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },

  {
    id: 'W3-02', persona: 'preparer', feature: 'hard_filters_form',
    // The capture form's "6a. Gate 1 hard filters" card: the five Standing
    // filters with their live verdicts (designated vertical and check size
    // derived, the two compliance confirmations and the portfolio-conflict
    // verdict manual) plus the six confirmation inputs (SCR-03).
    async run(page) {
      await openOpportunity(page, 'Vision Care Imaging Platform');
      await page.waitForSelector('[data-testid="hard-filters-card"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="hard-filters-card"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -140));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W3-02', persona: 'analyst', feature: 'hard_filters_recommended_decline',
    // An off-theme opportunity fails the designated-vertical filter, so the
    // screening panel shows the failed filter and the "Recommended decline"
    // outcome that the system raises without rejecting on its own (SCR-03;
    // SCR-09 advisory).
    async run(page) {
      await openBoardCard(page, 'Industrial Logistics Adjacency');
      await page.waitForSelector('[data-testid="hard-filter-review"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="screening-check-hard_filters"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W3-02', persona: 'reviewer', feature: 'hard_filters_review_override',
    // The reviewer's confirm/override control on a recommended decline: a
    // written reason is mandatory, the decision is recorded against the
    // opportunity and audited, and the effective outcome flips only on an
    // explicit override (SCR-03; SCR-09).
    async run(page) {
      await openBoardCard(page, 'Industrial Logistics Adjacency');
      await page.waitForSelector('[data-testid="hard-filter-review"]', { timeout: 12000 });
      await page.click('[data-testid="hard-filter-decision-overridden"]');
      await page.fill('[data-testid="hard-filter-reason"]', 'The investment committee approved the vertical exception by written resolution.');
      const anchor = page.locator('[data-testid="hard-filter-review"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(700);
    },
  },

  {
    id: 'W3-03', persona: 'preparer', feature: 'soft_filters_form',
    // The capture form's "6b. Gate 1 soft filters" card: the three scored soft
    // filters (portfolio adjacency, UAE national priorities, management
    // openness) with their proposed 1-5 scores and the inputs that feed them
    // (SCR-04).
    async run(page) {
      await openOpportunity(page, 'Vision Care Imaging Platform');
      await page.waitForSelector('[data-testid="soft-filters-card"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="soft-filters-card"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -140));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W3-03', persona: 'analyst', feature: 'soft_filters_scored_not_declined',
    // On the analyst board the soft filters are shown as three scored items with
    // their proposed scores and rationale. They inform the reviewer but never
    // kill the deal on their own, so no recommended-decline outcome is raised
    // (SCR-04).
    async run(page) {
      await openBoardCard(page, 'Industrial Logistics Adjacency');
      await page.waitForSelector('[data-testid="soft-filter-review"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="soft-filter-review"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W3-03', persona: 'reviewer', feature: 'soft_filters_review_adjust',
    // The reviewer confirms or adjusts each proposed score with a written
    // rationale. Here the reviewer adjusts management openness down to 2 and
    // records the reason before submitting the soft-filter review (SCR-04).
    async run(page) {
      await openBoardCard(page, 'Industrial Logistics Adjacency');
      await page.waitForSelector('[data-testid="soft-filter-review"]', { timeout: 12000 });
      await page.click('[data-testid="soft-filter-score-management_openness-2"]');
      await page.fill('[data-testid="soft-filter-rationale-management_openness"]', 'Management signalled a preference to stay independent rather than accept an active investor.');
      const anchor = page.locator('[data-testid="soft-filter-review"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(700);
    },
  },

  {
    id: 'W3-04', persona: 'preparer', feature: 'disqualifiers_form',
    // The capture form's "6c. Automatic disqualifier flags" card: the five
    // automatic disqualifiers with their verdicts and the inputs that feed them
    // (SCR-05).
    async run(page) {
      await openOpportunity(page, 'Vision Care Imaging Platform');
      await page.waitForSelector('[data-testid="disqualifiers-card"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="disqualifiers-card"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -140));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W3-04', persona: 'analyst', feature: 'disqualifiers_flagged',
    // Legacy Metals Restructuring on the analyst board: two automatic
    // disqualifiers are flagged (sanctions / PEP exposure and an undisclosed
    // related party). A flag is prominent on the record and never cleared by the
    // system on its own (SCR-05).
    async run(page) {
      await openBoardCard(page, 'Legacy Metals Restructuring');
      await page.waitForSelector('[data-testid="disqualifiers-review"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="disqualifiers-review"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W3-04', persona: 'reviewer', feature: 'disqualifiers_clear',
    // The reviewer clearing a disqualifier flag: a named reviewer and a reason
    // of at least 10 characters are required before the Clear flag action is
    // enabled. The clear is recorded on the audit trail (SCR-05).
    async run(page) {
      await openBoardCard(page, 'Legacy Metals Restructuring');
      await page.waitForSelector('[data-testid="disqualifiers-review"]', { timeout: 12000 });
      await page.fill('[data-testid="disqualifier-clear-reason-sanctions_pep"]', 'Independent sanctions screening returned clear; the PEP match was a false positive.');
      await page.fill('[data-testid="disqualifier-clear-reviewer-sanctions_pep"]', 'reviewer@sirius.local');
      const anchor = page.locator('[data-testid="disqualifiers-review"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(700);
    },
  },

  {
    id: 'W3-05', persona: 'analyst', feature: 'scorecard_weighted_summary',
    // The Gate 2 weighted scorecard on the analyst board for a scored fixture:
    // the seven 1-5 criteria with their weights, the weighted total and the
    // pass-bar outcome. Weights sum to 100% and are validated by the system
    // (SCO-02).
    async run(page) {
      await openBoardCard(page, 'Regional Cold-chain Platform');
      await page.waitForSelector('[data-testid="scorecard-review"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="scorecard-review"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W3-05', persona: 'analyst', feature: 'scorecard_criteria_scoring',
    // The analyst scoring the seven Gate 2 criteria. Each criterion shows its
    // weight and threshold and a 1-5 control; the weighted total updates as the
    // scores are entered. An unscored criterion keeps the total provisional
    // (SCO-02).
    async run(page) {
      await openBoardCard(page, 'Mature Packaging Roll-up');
      await page.waitForSelector('[data-testid="scorecard-review"]', { timeout: 12000 });
      await page.click('[data-testid="scorecard-score-growth_rate-3"]');
      await page.fill('[data-testid="scorecard-note-growth_rate"]', 'Forward order book supports a return to sector-average growth.');
      const anchor = page.locator('[data-testid="scorecard-review"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W3-05', persona: 'analyst', feature: 'scorecard_cioreview_below_bar',
    // A below-bar weighted total: the scorecard shows the override-required
    // outcome and the explicit CIO override memo control (a named CIO and a
    // written reason) that must be filed before the deal can proceed to Gate 3
    // (SCO-02 / REQ-GATE-02).
    async run(page) {
      await openBoardCard(page, 'Mature Packaging Roll-up');
      await page.waitForSelector('[data-testid="scorecard-override"]', { timeout: 12000 });
      await page.fill('[data-testid="scorecard-override-by"]', 'cio@sirius.local');
      await page.fill('[data-testid="scorecard-override-reason"]', 'Strategic entry into a national priority sector approved by the IC despite the below-bar quant score.');
      const anchor = page.locator('[data-testid="scorecard-review"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(700);
    },
  },

  {
    id: 'W3-06', persona: 'analyst', feature: 'two_lens_subtotals',
    // The two-lens floor on the analyst board (SCO-04): the seven criteria
    // group into a strategic lens and a financial lens, each with its own
    // weighted sub-total and a shared 3.0 floor. A deal must clear both floors
    // as well as the 3.5 overall bar.
    async run(page) {
      await openBoardCard(page, 'Regional Cold-chain Platform');
      await page.waitForSelector('[data-testid="scorecard-lenses"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="scorecard-lenses"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -240));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W3-06', persona: 'analyst', feature: 'lens_below_floor_override',
    // A strong-strategic, weak-financial deal (SCO-04): the strategic lens
    // reads 5.0 so the weighted total clears the 3.5 bar, but the financial
    // lens sits at 2.0 - below the 3.0 floor - so the deal is flagged and the
    // CIO override memo control is shown. A strong strategic case cannot mask
    // a weak financial one.
    async run(page) {
      await openBoardCard(page, 'Digital Health Growth Platform');
      await page.waitForSelector('[data-testid="scorecard-lenses"]', { timeout: 12000 });
      await page.fill('[data-testid="scorecard-override-by"]', 'cio@sirius.local');
      await page.fill('[data-testid="scorecard-override-reason"]', 'Strategic platform entry approved; the financial case will be de-risked after close.');
      const anchor = page.locator('[data-testid="scorecard-lenses"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(700);
    },
  },

  {
    id: 'W3-07', persona: 'analyst', feature: 'system_proposed_scores',
    // The system proposes a 1-5 score for every Gate 2 criterion from the data
    // on the record (SCO-03). Each row shows the proposal and its band; nothing
    // counts toward the total until the reviewer confirms, so the outcome reads
    // 'Not scored' with an awaiting-review message.
    async run(page) {
      await openBoardCard(page, 'US Water Infrastructure Platform');
      await page.waitForSelector('[data-testid="scorecard-proposed-revenue_scale"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="scorecard-review"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W3-07', persona: 'analyst', feature: 'adjustment_comment_required',
    // An adjustment away from the proposal (SCO-03). Choosing a score other
    // than the proposed one reveals an Adjusted badge and a comment box; the
    // record button stays disabled until a written comment is entered, so every
    // deviation from the system proposal is explained on the record.
    async run(page) {
      await openBoardCard(page, 'US Water Infrastructure Platform');
      await page.waitForSelector('[data-testid="scorecard-proposed-revenue_scale"]', { timeout: 12000 });
      await page.click('[data-testid="scorecard-score-revenue_scale-5"]');
      await page.waitForSelector('[data-testid="scorecard-comment-revenue_scale"]', { timeout: 8000 });
      const anchor = page.locator('[data-testid="scorecard-review"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(700);
    },
  },

  {
    id: 'W3-08', persona: 'admin', feature: 'scorecard_config_admin',
    // The admin Scorecard Config tab (SCO-05): the seven criteria with their
    // weights and a live 100% total, the pass bar, the lens floor and the two
    // lenses, under the revision currently in force.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Scorecard Config/i }).click();
      await page.waitForSelector('[data-testid="scorecard-config-weight-total"]', { timeout: 12000 });
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W3-08', persona: 'admin', feature: 'scorecard_config_save_revision',
    // Publishing a recalibration (SCO-05). Raising the pass bar enables Save as
    // new revision; the saved confirmation and the advanced revision badge show
    // the change was minted as a new revision rather than rewriting history.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Scorecard Config/i }).click();
      await page.waitForSelector('[data-testid="scorecard-config-pass-bar"]', { timeout: 12000 });
      const bar = page.locator('[data-testid="scorecard-config-pass-bar"]');
      await bar.fill('3.6');
      await page.click('[data-testid="scorecard-config-save"]');
      await page.waitForTimeout(1500);
    },
  },

  {
    id: 'W3-09', persona: 'analyst', feature: 'quality_score_breakdown',
    // The overall pre-screening quality score (SCO-01): a single advisory 0-100%
    // score with its band and a per-component breakdown (eligibility, hard
    // filters, soft filters, hurdles, alignment, scorecard).
    async run(page) {
      await openBoardCard(page, 'US Water Infrastructure Platform');
      await page.waitForSelector('[data-testid="quality-score"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="quality-score"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -160));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W3-09', persona: 'admin', feature: 'quality_config_admin',
    // The admin Quality Score tab (SCO-01): the six component weights with a
    // live 100% total, the three-band thresholds and the revision badge.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Quality Score/i }).click();
      await page.waitForSelector('[data-testid="quality-config-weight-total"]', { timeout: 12000 });
      await page.waitForTimeout(700);
    },
  },

  {
    id: 'W4-01', persona: 'admin', feature: 'portfolio_register_admin',
    // The Portfolio Register tab (ENT-04): the existing portfolio companies
    // with their cluster, sector, geography and capability tags, the revision
    // badge and the load template. Saving mints a new revision.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Portfolio Register/i }).click();
      await page.waitForSelector('[data-testid="portfolio-register-table"]', { timeout: 12000 });
      await page.waitForTimeout(800);
    },
  },
  {
    id: 'W4-01', persona: 'admin', feature: 'portfolio_register_template_import',
    // Loading the register from the template (ENT-04): the CSV template
    // download and the import panel that reads the register back in.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Portfolio Register/i }).click();
      await page.waitForSelector('[data-testid="portfolio-register-import-text"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="portfolio-register-import"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(700);
    },
  },

  {
    id: 'W3-11', persona: 'analyst', feature: 'portfolio_synergy_list',
    // Portfolio synergy identification (SCR-06): the top synergies against the
    // register, each naming the company, its rationale and the operating-company
    // sign-off marker.
    async run(page) {
      await openBoardCard(page, 'Vision Care Imaging Platform');
      await page.waitForSelector('[data-testid="portfolio-synergy"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="portfolio-synergy"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W3-10', persona: 'analyst', feature: 'portfolio_conflict_concentration',
    // Portfolio conflict & concentration (SCR-07): the overlap flags naming the
    // affected portfolio company and the post-deal sector concentration against
    // the ceiling.
    async run(page) {
      await openBoardCard(page, 'Vision Care Imaging Platform');
      await page.waitForSelector('[data-testid="portfolio-conflict"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="portfolio-conflict"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -260));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W3-12', persona: 'analyst', feature: 'analyst_adverse_media_confirmation',
    // Sanctions / adverse-media manual confirmation (SCR-08): the advisory
    // card on the screening panel carries the verdict, the screening source,
    // the supporting note and the evidence held on the record.
    async run(page) {
      await openBoardCard(page, 'Vision Care Imaging Platform');
      await page.waitForSelector('[data-testid="adverse-media"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="adverse-media"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W3-12', persona: 'preparer', feature: 'preparer_adverse_media_form',
    // The CONFIRMATION FIELD with its evidence on record (SCR-08): the preparer
    // records the verdict, the screening source, the reviewer and the supporting
    // evidence reference, and attaches the screening output as evidence.
    async run(page) {
      await openOpportunity(page, 'Vision Care Imaging Platform');
      await page.waitForSelector('[data-testid="adverse-media-card"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="adverse-media-card"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -140));
      await page.waitForTimeout(700);
    },
  },


  {
    id: 'W4-02', persona: 'admin', feature: 'strategy_library_documents',
    // Entity strategy library (ENT-02): the uploaded strategy documents for a
    // chosen entity with their format, index status and passage count, plus the
    // indexer version badge.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Strategy Library/i }).click();
      await page.waitForSelector('[data-testid="strategy-document-table"]', { timeout: 12000 });
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid^="strategy-row-"]').length > 0,
        { timeout: 12000 }
      );
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W4-02', persona: 'admin', feature: 'strategy_citation_search',
    // The alignment engine's citation (ENT-02): a query against the indexed
    // corpus returns the exact source passage the engine would quote, with its
    // score and matched terms.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Strategy Library/i }).click();
      await page.waitForSelector('[data-testid="strategy-search-input"]', { timeout: 12000 });
      await page.fill('[data-testid="strategy-search-input"]', 'technology UAE recurring revenue');
      await page.click('[data-testid="strategy-search-button"]');
      await page.waitForSelector('[data-testid="strategy-citations"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="strategy-citations"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W4-02', persona: 'admin', feature: 'strategy_versioned_profile',
    // The versioned strategy profile (ENT-01/ENT-02): the structured mandate
    // derived from the entity's theme and thresholds, the published version
    // badge and the publish action that mints a new version.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Strategy Library/i }).click();
      await page.waitForSelector('[data-testid="strategy-profile-derived"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="strategy-publish-button"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },


  {
    id: 'W4-03', persona: 'preparer', feature: 'strategy_profile_in_force',
    // The versioned strategy profile recorded per screening (ENT-01): the
    // screening panel names the published profile version in force and the
    // source documents behind it, so the retained record is self-explanatory.
    async run(page) {
      await openBoardCard(page, 'Vision Care Imaging Platform');
      await page.waitForSelector('[data-testid="strategy-profile-in-force"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="strategy-profile-in-force"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -260));
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W3-13', persona: 'analyst', feature: 'alignment_passage_citations',
    // Per-dimension theme alignment with a cited strategy passage (SCR-02):
    // each dimension is graded Aligned / Partly / Not aligned and names the
    // source document the verdict quotes, so the reviewer can audit the call.
    async run(page) {
      await openBoardCard(page, 'Vision Care Imaging Platform');
      await page.waitForSelector('[data-testid="alignment-dimensions"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="alignment-dimensions"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(700);
    },
  },

  {
    id: 'W4-04', persona: 'admin', feature: 'sirius_mandate_admin',
    // The Group Mandate tab (ENT-03): the versioned Sirius investment mandate -
    // sectors in scope, geographic posture, stage / instrument policy, ticket
    // band and the 1bn-people objective - with the revision badge. Saving mints
    // a new revision, so the mandate a screening ran against is reconstructable.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Group Mandate/i }).click();
      await page.waitForSelector('[data-testid="sirius-mandate-revision"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="sirius-mandate-sectors"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(800);
    },
  },

  {
    id: 'W5-01', persona: 'admin', feature: 'document_checklist_admin',
    // The Document Checklist tab (DOC-01): the checklist a submission carries,
    // generated from the opportunity type, stage and flags - each item mandatory,
    // conditional or optional, admin-editable without code, with the revision
    // badge. Saving mints a new revision, so the checklist a gate ran against is
    // reconstructable.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Document Checklist/i }).click();
      await page.waitForSelector('[data-testid="document-checklist-revision"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="document-checklist-item-business_plan"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(800);
    },
  },

  {
    id: 'W5-02', persona: 'admin', feature: 'document_policy_admin',
    // The Upload Policy tab (DOC-02): the 50 MB size cap, the accepted-type
    // allow-list (PDF/DOCX/XLSX/PPTX core plus the legacy set) and the upload
    // virus-scan settings, with the revision badge. Every upload is scanned and
    // the previous version is retained.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Upload Policy/i }).click();
      await page.waitForSelector('[data-testid="document-policy-revision"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="document-policy-types"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(800);
    },
  },

  {
    id: 'W5-03', persona: 'preparer', feature: 'sufficiency_flags_pre_submit',
    // The content sufficiency check on a draft (DOC-04): the advisory flags a
    // preparer sees before submitting - a missing cash flow, fewer years of
    // history than the policy expects and no downside case - each with its
    // observed and expected value. A flag never blocks; the preparer addresses
    // it or a reviewer overrides it with a reason.
    async run(page) {
      await openOpportunity(page, 'Small Bolt-on with Portfolio Synergy');
      await page.waitForSelector('[data-testid="sufficiency-card"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="sufficiency-card"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(700);
    },
  },

  {
    id: 'W5-03', persona: 'analyst', feature: 'sufficiency_flags_reviewer_post',
    // The reviewer-side half of the criterion: the content sufficiency flags
    // surface on the single screening panel's completeness check with a
    // reference each, so a reviewer sees thin content next to every other
    // check. Advisory throughout (SCR-09).
    async run(page) {
      await openBoardCard(page, 'Vision Care Imaging Platform');
      await page.waitForSelector('[data-testid="screening-check-completeness"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="screening-check-completeness"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(700);
    },
  },

  {
    id: 'W5-04', persona: 'admin', feature: 'data_source_mapping_admin',
    // The Source Mapping tab (DOC-05): every memo data point linked to the
    // artefact or captured field behind it, held in config so an administrator
    // can re-point a data point without a code change. Saving mints a revision.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Source Mapping/i }).click();
      await page.waitForSelector('[data-testid="data-source-revision"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="data-source-links"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(800);
    },
  },

  {
    id: 'W5-04', persona: 'reviewer', feature: 'memo_data_point_sources_reviewer',
    // The reviewer-side half of the criterion: the generated memo carries a
    // data-point source map, grouped by memo page, where each value shows the
    // source it came from and (for an attached document) an Open source link.
    async run(page) {
      await openBoardCard(page, 'Vision Care Imaging Platform');
      await page.getByRole('button', { name: /Create Sirius memo/i }).first().click({ timeout: 8000 });
      await page.waitForSelector('[data-testid="memo-source-map"]', { timeout: 15000 });
      const anchor = page.locator('[data-testid="memo-source-map"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -180));
      await page.waitForTimeout(700);
    },
  },

  {
    id: 'W5-05', persona: 'admin', feature: 'template_library_admin',
    // The Template Library tab (DOC-06): the standard submission templates the
    // Investment Team maintains, each with its current version and a download
    // button. Saving the maintained metadata mints a new revision.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Template Library/i }).click();
      await page.waitForSelector('[data-testid="template-revision"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="template-list"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(800);
    },
  },

  {
    id: 'W5-05', persona: 'preparer', feature: 'template_library_download_preparer',
    // The intake squad sees the same library and can download each template.
    // This is the readable half of "current versions downloadable": the row
    // names the file, its format, its owner and its version beside the button.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Template Library/i }).click();
      await page.waitForSelector('[data-testid="template-row-opportunity_overview"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="template-row-financial_model"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(700);
    },
  },

  {
    id: 'W6-01', persona: 'admin', feature: 'decision_reasons_admin',
    // The Decision Reasons tab (WF-05): the maintained catalogue of reason codes
    // for approve / return / decline / withdraw, each toggleable, with free-text
    // enforced on declines. Saving mints a new revision.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Decision Reasons/i }).click();
      await page.waitForSelector('[data-testid="decision-reason-revision"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="decision-class-decline"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -120));
      await page.waitForTimeout(800);
    },
  },

  {
    id: 'W6-01', persona: 'leadership', feature: 'decline_reason_required_reviewer',
    // A reviewer moving an item to Declined must pick a reason code (WF-05).
    // The code select lists the maintained decline codes; the free-text detail
    // beside it is what makes the decline comparable later.
    async run(page) {
      await openBoardCard(page, 'Mature Packaging Roll-up');
      await page.getByRole('button', { name: /^Declined$/i }).first().click({ timeout: 8000 });
      await page.waitForSelector('[data-testid="transition-reason-code"]', { timeout: 8000 });
      await page.locator('[data-testid="transition-reason-code"]').click({ timeout: 8000 });
      await page.getByRole('option', { name: /Returns below hurdle/i }).first().click({ timeout: 8000 });
      await page.fill('[data-testid="transition-comment"]', 'Projected IRR sits under the mandate hurdle.');
      await page.waitForTimeout(700);
    },
  },

  {
    id: 'W6-02', persona: 'admin', feature: 'doa_matrix_admin',
    // The Delegation of Authority tab (WF-08): the Gate-1 ticket bands, each with
    // its RACI row for the DoA parties and the roles delegated the decision.
    // Saving the matrix mints a new revision.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Delegation of Authority/i }).click();
      await page.waitForSelector('[data-testid="doa-revision"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="doa-tier-elevated"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -140));
      await page.waitForTimeout(800);
    },
  },

  {
    id: 'W6-02', persona: 'reviewer', feature: 'gate1_authority_not_delegated_reviewer',
    // An independent reviewer looking at an elevated ticket sees the band that
    // owns the Gate-1 decision; because the reviewer is not in that band the
    // move buttons to Refinement / Declined are disabled and explain why (WF-08).
    async run(page) {
      await openBoardCard(page, 'Digital Health Growth Platform');
      await page.waitForSelector('[data-testid="gate1-authority-panel"]', { timeout: 10000 });
      const anchor = page.locator('[data-testid="gate1-authority-panel"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -160));
      await page.waitForTimeout(800);
    },
  },

  {
    id: 'W6-02', persona: 'analyst', feature: 'gate1_authority_delegated_cio',
    // The CIO is delegated the Gate-1 decision for this band, so the same item
    // shows the delegation as theirs and the decision controls are enabled.
    async run(page) {
      await openBoardCard(page, 'Digital Health Growth Platform');
      await page.waitForSelector('[data-testid="gate1-authority-panel"]', { timeout: 10000 });
      const anchor = page.locator('[data-testid="gate1-authority-panel"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -160));
      await page.waitForTimeout(800);
    },
  },

  {
    id: 'W6-03', persona: 'admin', feature: 'related_party_overlay_admin',
    // The Related-Party Overlay tab (WF-06): the enforcement switches Group
    // Compliance maintains, the delegated sign-off roles and the accepted
    // arm's-length bases. Saving mints a new revision.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Related-Party Overlay/i }).click();
      await page.waitForSelector('[data-testid="rp-revision"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="rp-switch-require_independent_signoff"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -140));
      await page.waitForTimeout(800);
    },
  },

  {
    id: 'W6-03', persona: 'reviewer', feature: 'gate1_decision_blocked_no_signoff',
    // A flagged affiliate deal that has not yet been signed off cannot reach the
    // Screening Decision: the overlay banner explains the block (WF-06).
    async run(page) {
      await openBoardCard(page, 'Affiliate Referral');
      await page.waitForSelector('[data-testid="rp-overlay-panel"]', { timeout: 10000 });
      const anchor = page.locator('[data-testid="rp-overlay-panel"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -180));
      await page.waitForTimeout(800);
    },
  },

  {
    id: 'W6-03', persona: 'preparer', feature: 'arm_length_record_preparer',
    // On the opportunity route the preparer records the arm's-length basis and
    // evidence note; the overlay status shows what is still outstanding (WF-06).
    async run(page) {
      await openOpportunityRoute(page, 'Affiliate Referral');
      await page.waitForSelector('[data-testid="rp-overlay-status"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="rp-arm-length-basis"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -220));
      await page.waitForTimeout(800);
    },
  },

  {
    id: 'W6-03', persona: 'reviewer', feature: 'independent_signoff_reviewer',
    // The independent, non-conflicted reviewer records the sign-off that clears
    // the overlay for the Screening Decision (WF-06).
    async run(page) {
      await openOpportunityRoute(page, 'Affiliate Referral');
      await page.waitForSelector('[data-testid="rp-signoff"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="rp-signoff"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(800);
    },
  },

  {
    id: 'W6-04', persona: 'admin', feature: 'comment_visibility_policy_admin',
    // The Comment Visibility tab (AUD-03): the group-compliance switches that
    // decide whether internal comments are restricted to the group layer, the
    // subsidiary roles the restriction applies to, and the default visibility.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Comment Visibility/i }).click();
      await page.waitForSelector('[data-testid="cv-revision"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="cv-switch-restrict_internal_to_group"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -140));
      await page.waitForTimeout(800);
    },
  },

  {
    id: 'W6-04', persona: 'preparer', feature: 'internal_thread_hidden_subsidiary',
    // A subsidiary deal lead sees the shared clarification thread but the
    // internal thread does not appear at all in their inbox (AUD-03).
    async run(page) {
      await page.goto(BASE + '/QandA', { waitUntil: 'networkidle' });
      await page.waitForTimeout(2200);
      // Prove the internal thread is absent from a subsidiary view.
      const leaked = await page.locator('text=/INTERNAL: negotiating position/').count();
      if (leaked > 0) throw new Error('internal thread leaked into subsidiary inbox');
      await openQaThread(page, 'Clarify the custody licensing timeline');
      const anchor = page.locator('text=Conversation').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(600);
    },
  },

  {
    id: 'W6-05', persona: 'admin', feature: 'audit_chain_policy_admin',
    // The Audit Integrity tab (AUD-01): the hash-chain policy - chaining on,
    // the sha256 algorithm and the published genesis constant - with the
    // administrator-only verify action.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Audit Integrity/i }).click();
      await page.waitForSelector('[data-testid="ac-revision"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="ac-verify"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -140));
      await page.waitForTimeout(800);
    },
  },

  {
    id: 'W6-05', persona: 'admin', feature: 'audit_chain_verified_intact',
    // Running the verify action recomputes the whole chain server-side and
    // reports it intact, naming the row count checked (AUD-01).
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Audit Integrity/i }).click();
      await page.waitForSelector('[data-testid="ac-verify"]', { timeout: 12000 });
      await page.locator('[data-testid="ac-verify"]').click();
      await page.waitForSelector('[data-testid="ac-verify-result"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="ac-verify-result"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -160));
      await page.waitForTimeout(600);
    },
  },

  {
    id: 'W6-04', persona: 'analyst', feature: 'internal_thread_visible_group',
    // The group investment layer sees the internal thread, its Internal badge
    // and the internal-only replies (AUD-03).
    async run(page) {
      await openQaThread(page, 'INTERNAL: negotiating position');
      await page.getByText('Internal (group only)').first().waitFor({ timeout: 10000 });
      const anchor = page.locator('text=Conversation').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(600);
    },
  },

  {
    id: 'W6-06', persona: 'preparer', feature: 'presentation_capture_preparer',
    // The owning subsidiary deal lead schedules a presentation with the group:
    // the date, the attendees and the format are captured on the opportunity
    // record (WF-07).
    async run(page) {
      await openOpportunityRoute(page, 'Vision Care Imaging Platform');
      await page.waitForSelector('[data-testid="pr-scheduled-at"]', { timeout: 12000 });
      await page.fill('[data-testid="pr-scheduled-at"]', '2026-03-10T09:00');
      await page.fill('[data-testid="pr-attendees"]', 'analyst@sirius.local, ic.member@sirius.local');
      await page.locator('[data-testid="pr-save"]').click();
      await page.waitForSelector('[data-testid="pr-session"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="pr-session"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -120));
      await page.waitForTimeout(700);
    },
  },

  {
    id: 'W6-06', persona: 'analyst', feature: 'presentation_outcome_recorded',
    // The group layer records the outcome and next steps once the session has
    // been held, so the record shows what was discussed and agreed (WF-07).
    async run(page) {
      await openOpportunityRoute(page, 'Vision Care Imaging Platform');
      await page.waitForSelector('[data-testid="pr-session"]', { timeout: 12000 });
      const edit = page.locator('[data-testid="pr-edit"]').first();
      await edit.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await edit.click();
      await page.waitForSelector('[data-testid="pr-status"]', { timeout: 8000 });
      await page.selectOption('[data-testid="pr-status"]', 'completed');
      await page.fill('[data-testid="pr-outcome"]', 'Proceed to Gate 1 with the value-enhancement plan.');
      await page.fill('[data-testid="pr-next-steps"]', 'CIO to table the IC pack at the next monthly committee.');
      await page.locator('[data-testid="pr-save"]').click();
      await page.waitForTimeout(1400);
      const anchor = page.locator('text=Outcome:').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -120));
      await page.waitForTimeout(700);
    },
  },

  {
    id: 'W6-07', persona: 'preparer', feature: 'notification_frequency_user_choice',
    // A subsidiary deal lead chooses their own notification email frequency
    // (immediate or daily digest) from the Settings Notifications tab (NTF-01).
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Notifications/i }).click();
      await page.waitForSelector('[data-testid="nf-preference"]', { timeout: 12000 });
      await page.locator('[data-testid="nf-choice-daily_digest"]').click();
      await page.waitForTimeout(1000);
      const anchor = page.locator('[data-testid="nf-preference"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -140));
      await page.waitForTimeout(600);
    },
  },

  {
    id: 'W6-07', persona: 'admin', feature: 'notification_frequency_policy_admin',
    // The group policy: whether users may choose, the default frequency and the
    // advertised digest hour, with the per-user digest preview (NTF-01).
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Notifications/i }).click();
      await page.waitForSelector('[data-testid="nf-save"]', { timeout: 12000 });
      await page.locator('[data-testid="nf-preview-digest"]').click();
      await page.waitForSelector('[data-testid="nf-digest-result"]', { timeout: 12000 });
      const anchor = page.locator('[data-testid="nf-digest-result"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(600);
    },
  },

  {
    id: 'W7-01', persona: 'leadership', feature: 'ihc_weekly_tracker_leadership',
    // The group IHC view of the standing weekly tracker, generated from the live
    // pipeline with the agreed Friday columns (DSH-03).
    async run(page) {
      await page.goto(BASE + '/Reporting', { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="ihc-export-xlsx"]', { timeout: 15000 });
      await page.waitForTimeout(1200);
      const anchor = page.locator('[data-testid="ihc-weekly"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(400);
    },
  },

  {
    id: 'W7-01', persona: 'admin', feature: 'ihc_reporting_configuration_admin',
    // An admin retunes the tracker: the column set, the tracked stages and the
    // weekly schedule, versioned and audited (DSH-03).
    async run(page) {
      await page.goto(BASE + '/Reporting', { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="ihc-tab-config"]', { timeout: 15000 });
      await page.locator('[data-testid="ihc-tab-config"]').click();
      await page.waitForSelector('[data-testid="ihc-config-save"]', { timeout: 12000 });
      await page.waitForTimeout(800);
      const anchor = page.locator('[data-testid="ihc-config"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -120));
      await page.waitForTimeout(400);
    },
  },

  {
    id: 'W7-02', persona: 'leadership', feature: 'pipeline_dashboard_filters_leadership',
    // The Investment Team slices the live board by entity, cluster, sector,
    // stage, owner and date (DSH-01).
    async run(page) {
      await page.goto(BASE + '/PipelineDashboard', { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="pd-filters"]', { timeout: 15000 });
      await page.waitForSelector('[data-testid="pd-summary"]', { timeout: 12000 });
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
    },
  },

  {
    id: 'W7-02', persona: 'leadership', feature: 'pipeline_dashboard_drilldown_leadership',
    // A filter is applied and the pipeline is drilled down by entity, showing
    // the grouped counts for the selected cut (DSH-01).
    async run(page) {
      await page.goto(BASE + '/PipelineDashboard', { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="pd-drilldown"]', { timeout: 15000 });
      await page.locator('[data-testid="pd-drilldown"]').click();
      await page.waitForTimeout(300);
      await page.getByRole('option', { name: /entity/i }).first().click().catch(() => {});
      await page.waitForTimeout(1400);
      const anchor = page.locator('[data-testid="pd-group"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -160));
      await page.waitForTimeout(400);
    },
  },

  {
    id: 'W7-03', persona: 'leadership', feature: 'funnel_conversion_leadership',
    // The Investment Team view of the funnel: how many opportunities reach each
    // forward stage and the conversion from submission (DSH-04).
    async run(page) {
      await page.goto(BASE + '/PipelineMetrics', { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="pm-funnel"]', { timeout: 15000 });
      await page.waitForSelector('[data-testid="pm-stage"]', { timeout: 12000 });
      await page.waitForTimeout(1200);
      await page.evaluate(() => window.scrollTo(0, 260));
      await page.waitForTimeout(400);
    },
  },

  {
    id: 'W7-03', persona: 'leadership', feature: 'cycle_time_vs_sla_leadership',
    // The cycle-time table measured against the stage SLA, and the branch
    // reasons for the opportunities that left the funnel (DSH-04).
    async run(page) {
      await page.goto(BASE + '/PipelineMetrics', { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="pm-cycle"]', { timeout: 15000 });
      await page.waitForTimeout(1000);
      const anchor = page.locator('[data-testid="pm-cycle"]').first();
      await anchor.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -140));
      await page.waitForTimeout(400);
    },
  },

  {
    id: 'W7-04', persona: 'preparer', feature: 'export_overview_pack_button',
    // The memo dialog now offers a one-click export of the six-page Part B
    // Opportunity Overview pack (OUT-02), alongside the .docx download.
    async run(page) {
      await openBoardCard(page, 'Vision Care Imaging Platform');
      await page.getByRole('button', { name: /Create Sirius memo/i }).first().click({ timeout: 8000 });
      await page.waitForSelector('[data-testid="memo-pack-export"]', { timeout: 12000 });
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'W7-04', persona: 'preparer', feature: 'pack_six_page_part_b_order',
    // Clicking Export downloads the self-contained pack and the shot shows the
    // pack opened: the six-page running order with page 1 as the Executive
    // summary, matching the Part B template order.
    async run(page) {
      await openBoardCard(page, 'Vision Care Imaging Platform');
      await page.getByRole('button', { name: /Create Sirius memo/i }).first().click({ timeout: 8000 });
      await page.waitForSelector('[data-testid="memo-pack-export"]', { timeout: 12000 });
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.getByTestId('memo-pack-export').click({ timeout: 8000 }),
      ]);
      const file = await download.path();
      // Render the downloaded pack in the browser so the shot shows the six
      // pages as a reviewer sees them (a file:// open would show the source).
      const html = fs.readFileSync(file, 'utf8');
      await page.setContent(html, { waitUntil: 'load' });
      await page.waitForTimeout(600);
    },
  },
  {
    id: 'W7-05', persona: 'preparer', feature: 'verification_qr_panel',
    // Issuing the verification QR from the memo dialog: the panel shows the
    // record version and content hash the exported copy will be bound to, and
    // renders the signed QR a reviewer scans (OUT-03).
    async run(page) {
      await openBoardCard(page, 'Vision Care Imaging Platform');
      await page.getByRole('button', { name: /Create Sirius memo/i }).first().click({ timeout: 8000 });
      await page.waitForSelector('[data-testid="memo-verify-issue"]', { timeout: 12000 });
      await page.getByTestId('memo-verify-issue').click({ timeout: 8000 });
      await page.waitForSelector('[data-testid="memo-verify-qr"]', { timeout: 15000 });
      const anchor = page.locator('[data-testid="memo-verify-panel"]');
      await anchor.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(800);
    },
  },
  {
    id: 'W7-05', persona: 'preparer', feature: 'verify_page_match',
    // The public verify page a scan opens (no session): the live record still
    // fingerprints to the hash in the QR, so the copy reads Verified.
    async run(page) {
      await openBoardCard(page, 'Vision Care Imaging Platform');
      await page.getByRole('button', { name: /Create Sirius memo/i }).first().click({ timeout: 8000 });
      await page.waitForSelector('[data-testid="memo-verify-issue"]', { timeout: 12000 });
      await page.getByTestId('memo-verify-issue').click({ timeout: 8000 });
      const link = page.locator('a', { hasText: /Open verify page/i }).first();
      const href = await link.getAttribute('href', { timeout: 12000 });
      await page.goto(href, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="verify-memo-status"]', { timeout: 15000 });
      await page.waitForTimeout(600);
    },
  },
  {
    id: 'W7-05', persona: 'preparer', feature: 'verify_page_tampered',
    // The same QR with its hash altered (a tampered copy): the HMAC signature no
    // longer matches, so the page reports Unverified rather than the record.
    async run(page) {
      await openBoardCard(page, 'Vision Care Imaging Platform');
      await page.getByRole('button', { name: /Create Sirius memo/i }).first().click({ timeout: 8000 });
      await page.waitForSelector('[data-testid="memo-verify-issue"]', { timeout: 12000 });
      await page.getByTestId('memo-verify-issue').click({ timeout: 8000 });
      const link = page.locator('a', { hasText: /Open verify page/i }).first();
      const href = await link.getAttribute('href', { timeout: 12000 });
      const u = new URL(href);
      u.searchParams.set('h', 'f'.repeat(64));
      await page.goto(u.toString(), { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="verify-memo-status"]', { timeout: 15000 });
      await page.waitForTimeout(600);
    },
  },

  {
    id: 'W8-01', persona: 'admin', feature: 'auth_policy_mfa',
    // Unified authentication policy (PLT-04): the SuperAdmin Security tab shows
    // the MFA mode + enforcement switch, the signed-in viewer's own MFA
    // standing, and the local-account domain allowlist the sign-in gate reads.
    async run(page) {
      await page.goto(BASE + '/SuperAdmin', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1400);
      await page.getByRole('tab', { name: /Security/i }).click();
      await page.waitForSelector('[data-testid="auth-policy-viewer"]', { timeout: 12000 });
      await page.waitForTimeout(900);
    },
  },
  {
    id: 'W8-01', persona: 'admin', feature: 'sso_provider_registry',
    // An OIDC provider registered for a work domain: the registry row plus the
    // add form (issuer, endpoints, domain) an administrator uses to onboard an
    // internal IdP without a redeploy.
    async run(page) {
      await page.goto(BASE + '/SuperAdmin', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1400);
      await page.getByRole('tab', { name: /Security/i }).click();
      await page.waitForSelector('[data-testid="sso-add-provider"]', { timeout: 12000 });
      await page.locator('[data-testid="sso-add-provider"]').scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(800);
    },
  },
  {
    id: 'W8-01', persona: 'admin', feature: 'login_sso_button',
    // The sign-in screen's SSO entry point: entering a work email resolves the
    // registered provider and hands the browser to the IdP, while password
    // sign-in remains available for approved local and external accounts.
    async run(page) {
      await page.context().clearCookies();
      await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="login-sso"]', { timeout: 12000 });
      await page.fill('#email', 'deal.lead@infinia.local');
      await page.waitForTimeout(700);
    },
  },

  {
    id: 'W8-02', persona: 'admin', feature: 'dashboard_ltr',
    // The Dashboard in English (LTR): every caption is looked up through t(), so
    // the same screen re-renders in the selected locale (PLT-06).
    async run(page) {
      await page.goto(BASE + '/Dashboard', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1800);
    },
  },
  {
    id: 'W8-02', persona: 'admin', feature: 'dashboard_rtl',
    // The same Dashboard after switching to Arabic: document.documentElement is
    // flipped to dir=rtl and the whole screen mirrors right-to-left (PLT-06 RTL
    // demonstration target).
    async run(page) {
      await page.goto(BASE + '/Dashboard', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      await page.getByRole('button', { name: /Arabic|العربية/ }).first().click({ timeout: 8000 });
      await page.waitForTimeout(1500);
      const dir = await page.evaluate(() => document.documentElement.dir);
      if (dir !== 'rtl') throw new Error('document dir is ' + dir + ', expected rtl');
    },
  },

  {
    id: 'W8-03', persona: 'admin', feature: 'config_registry',
    // Unified admin configuration registry (ADM-01): every tunable that shapes a
    // screening - scorecard weights, hurdle rates, checklist, routing, SLAs,
    // reason codes and picklists - listed by group with the route that edits it
    // and whether it is versioned.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      await page.getByRole('tab', { name: /Config Registry/i }).click();
      await page.waitForSelector('[data-testid="admin-config-summary"]', { timeout: 15000 });
      await page.waitForSelector('[data-testid="admin-config-group"]', { timeout: 15000 });
      await page.locator('[data-testid="admin-config-card"]').scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(1400);
    },
  },
  {
    id: 'W8-03', persona: 'admin', feature: 'config_domain_history',
    // One area's audited change history, drawn from the immutable audit trail.
    // Publishing a change is a new revision and, per the scope note, applies to
    // new screenings only - in-flight work keeps the version it was screened on.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      await page.getByRole('tab', { name: /Config Registry/i }).click();
      await page.waitForSelector('[data-testid="admin-config-domain"]', { timeout: 15000 });
      const target = page.locator('[data-testid="admin-config-domain"][data-domain="scorecard"]').first();
      await target.scrollIntoViewIfNeeded().catch(() => {});
      await target.click();
      await page.waitForSelector('[data-testid="admin-config-history"]', { timeout: 12000 });
      await page.locator('[data-testid="admin-config-history"]').scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(1200);
    },
  },

  {
    id: 'W8-04', persona: 'preparer', feature: 'dataroom_link_set',
    // Data-room folder link on the opportunity record (INTG-01): the live room a
    // screening works from is stored on the record, so a reviewer opens it in one
    // click while the secure room stays the system of record for documents.
    async run(page) {
      const opp = await findOpportunityByName('Vision Care Imaging Platform');
      if (!opp) throw new Error('fixture opportunity not found');
      await setDataroomLink(opp.id, {
        url: 'https://app.coneshare.com/s/sirius-vision-deal-room',
        label: 'Vision Care deal room',
      });
      await openBoardCard(page, 'Vision Care Imaging Platform');
      await page.waitForSelector('[data-testid="dataroom-link-panel"]', { timeout: 15000 });
      await page.waitForSelector('[data-testid="dataroom-link-current"]', { timeout: 12000 });
      await page.locator('[data-testid="dataroom-link-panel"]').scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(1200);
    },
  },
  {
    id: 'W8-04', persona: 'preparer', feature: 'dataroom_link_editor',
    // The same record before a link is set: the empty state plus the editor an
    // owner uses to attach (or replace) the folder link, with the provider
    // vocabulary the deployment recognises.
    async run(page) {
      const opp = await findOpportunityByName('Vision Care Imaging Platform');
      if (opp) await clearDataroomLink(opp.id);
      await openBoardCard(page, 'Vision Care Imaging Platform');
      await page.waitForSelector('[data-testid="dataroom-link-empty"]', { timeout: 15000 });
      await page.locator('[data-testid="dataroom-link-url"]').scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(1200);
    },
  },

  {
    id: 'W8-05', persona: 'admin', feature: 'bulk_import_report',
    // Bulk import of in-flight opportunities (INTG-03): the operator uploads the
    // Sirius tracker export; every row is validated against the shipped capture
    // vocabulary and the org tree before anything is created, and the report
    // names each row that cannot be loaded and why.
    async run(page) {
      const header = 'Opportunity name,Opportunity type,Sector,Geography,Total commitment (AED mn),Ask from Sirius (AED mn),Owning org id,State,Mystery column';
      const lines = [
        header,
        'Sunrise Diagnostics Platform,strategic_acquisition,Healthcare,UAE,180,90,org-infinia-technologies-limited,submission,legacy-ref',
        'Gulf Cold Chain Logistics,bolt_on,Logistics,KSA,320,140,org-finstreet-limited,screening,sirius-2024',
        ',organic_expansion,Energy,UAE,60,30,org-sirius-international-holding-limited,draft,unused',
        'Falcon Renewables,crypto_punt,Energy,UAE,-5,10,org-does-not-exist,draft,stale',
      ];
      const file = path.join(os.tmpdir(), 'dealforge_w8_05_tracker.csv');
      fs.writeFileSync(file, lines.join('\n'));
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      await page.getByRole('tab', { name: /Bulk Import/i }).click();
      await page.waitForSelector('[data-testid="bulk-import-file"]', { timeout: 15000 });
      await page.setInputFiles('[data-testid="bulk-import-file"]', file);
      await page.click('[data-testid="bulk-import-validate"]');
      await page.waitForSelector('[data-testid="bulk-import-report"]', { timeout: 15000 });
      await page.waitForSelector('[data-testid="bulk-import-row-5"]', { timeout: 12000 });
      await page.locator('[data-testid="bulk-import-card"]').scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(1200);
    },
  },

  {
    id: 'W8-06', persona: 'admin', feature: 'users_status_list',
    // User-administration hardening (PLT-05): the console derives one lifecycle
    // status per account (active / deactivated / banned) and, for a deactivated
    // account, offers reactivation. The temp account is created and deactivated
    // in-page so the shot shows the real end state, not a mock.
    async run(page) {
      await ensureDeactivatedFixture(page);
      await page.goto(BASE + '/SuperAdmin', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      await page.getByRole('tab', { name: /Users/i }).first().click();
      await page.waitForSelector('[data-testid^="user-status-"]', { timeout: 15000 });
      await page.waitForTimeout(1200);
    },
  },
  {
    id: 'W8-06', persona: 'admin', feature: 'deactivation_reactivate',
    // The lifecycle effect on the record: deactivating an account revokes its
    // live sessions and refuses it on the next request; the console shows the
    // derived status and the reactivate control that restores access.
    async run(page) {
      await ensureDeactivatedFixture(page);
      await page.goto(BASE + '/SuperAdmin', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      await page.getByRole('tab', { name: /Users/i }).first().click();
      await page.waitForTimeout(1200);
      const row = page.locator('tr', { hasText: DEACTIVATED_EMAIL }).first();
      await row.getByRole('button', { name: /Manage/i }).click({ timeout: 8000 });
      await page.waitForTimeout(800);
      await page.getByRole('tab', { name: /Security/i }).click({ timeout: 8000 });
      await page.waitForSelector('[data-testid="user-reactivate"]', { timeout: 12000 });
      await page.locator('[data-testid="user-reactivate"]').scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(1000);
    },
  },

  {
    id: 'W9-01', persona: 'admin', feature: 'ai_governance_policy',
    // AI governance (NFR-03): the policy switches that log prompts and outputs
    // (with email and secret redaction), label model output, require provider
    // approval and set the retention window, alongside the provider approval
    // register with residency and approver per provider.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      await page.getByRole('tab', { name: /AI Governance/i }).click();
      await page.waitForSelector('[data-testid="ai-governance-policy"]', { timeout: 15000 });
      await page.waitForSelector('[data-testid="ai-governance-providers"]', { timeout: 12000 });
      await page.locator('[data-testid="ai-governance-card"]').scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(1400);
    },
  },
  {
    id: 'W9-01', persona: 'admin', feature: 'ai_governance_provider_approval',
    // The provider register after an approval: an administrator approves the
    // OpenAI provider, the save records the approver and date and bumps the
    // policy revision, and the approval roll-up updates.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      await page.getByRole('tab', { name: /AI Governance/i }).click();
      await page.waitForSelector('[data-testid="ai-provider-status-openai"]', { timeout: 15000 });
      await page.selectOption('[data-testid="ai-provider-status-openai"]', 'approved');
      await page.click('[data-testid="ai-governance-save"]');
      await page.waitForSelector('[data-testid="ai-governance-notice"]', { timeout: 12000 });
      await page.locator('[data-testid="ai-governance-providers"]').scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(1400);
    },
  },

  {
    id: 'W9-02', persona: 'admin', feature: 'security_posture_summary',
    // Security review (NFR-02): the go-live gate and the advisory summary. The
    // gate passes because there are zero open critical or high advisories across
    // the server runtime, frontend build and dev trees, shown alongside the
    // implemented-control and external-dependency counts.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      await page.getByRole('tab', { name: /AI Governance/i }).click();
      await page.waitForSelector('[data-testid="security-posture-summary"]', { timeout: 15000 });
      await page.locator('[data-testid="security-posture"]').scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(1400);
    },
  },
  {
    id: 'W9-02', persona: 'admin', feature: 'security_controls_register',
    // The control register behind the gate: every control with its status
    // (implemented / passing / external) and the evidence pointer a reviewer can
    // grep. The two external controls are the pen test and UAE residency, which
    // are Sirius IT activities tracked as open go-live dependencies.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      await page.getByRole('tab', { name: /AI Governance/i }).click();
      await page.waitForSelector('[data-testid="security-posture-controls"]', { timeout: 15000 });
      await page.locator('[data-testid="security-control-pen_test"]').scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(1400);
    },
  },
  {
    id: 'W9-03', persona: 'admin', feature: 'data_residency_posture',
    // UAE data residency posture: which dependency sits in-boundary, which is
    // pinned to a region, and which is unpinned. The sign-off itself is an
    // external Sirius IT/security activity tracked separately from the code.
    async run(page) {
      await page.goto(BASE + '/Settings', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      await page.getByRole('tab', { name: /AI Governance/i }).click();
      await page.waitForSelector('[data-testid="residency-dependencies"]', { timeout: 15000 });
      await page.locator('[data-testid="data-residency"]').scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(1400);
    },
  },
];

export async function capture({ only } = {}) {
  const pw = resolvePlaywright();
  const browser = await pw.chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  try {
    // Group by the account we actually sign in as, so two shots for the same
    // journey persona can come from different subsidiary seats when needed.
    const byLogin = new Map();
    for (const shot of SHOTS) {
      if (only && !only.includes(shot.id)) continue;
      const email = PERSONA_EMAIL_OVERRIDE[shot.email] || PERSONAS[shot.persona] || PERSONAS.admin;
      if (!byLogin.has(email)) byLogin.set(email, []);
      byLogin.get(email).push(shot);
    }
    for (const [email, shots] of byLogin) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await login(page, email);
      for (const shot of shots) {
        const persona = shot.persona;
        const dir = path.join(ROOT, 'docs', 'evidence', shot.id);
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, persona + '_' + shot.feature + '.png');
        try {
          await shot.run(page);
          await page.screenshot({ path: file, fullPage: false });
          results.push({ id: shot.id, persona, feature: shot.feature, file: path.relative(ROOT, file), ok: true });
          console.log('captured', shot.id, path.relative(ROOT, file));
        } catch (err) {
          results.push({ id: shot.id, persona, feature: shot.feature, file: path.relative(ROOT, file), ok: false, error: err.message });
          console.error('FAILED', shot.id, shot.feature, '-', err.message);
        }
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()) : null;
  capture({ only }).then((r) => {
    const failed = r.filter((x) => !x.ok);
    console.log(JSON.stringify({ captured: r.length - failed.length, failed: failed.length }));
    process.exit(failed.length ? 1 : 0);
  }).catch((err) => { console.error(err); process.exit(1); });
}
