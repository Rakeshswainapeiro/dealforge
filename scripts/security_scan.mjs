#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Security scan harness (W9-02 / BRD NFR-02).
//
// Reproduces the go-live security review in one command: a dependency advisory
// audit (production and full tree), a syntax check of the server sources, and a
// scan for the classic injection sinks. It prints a summary and writes a JSON
// report next to the evidence so a reviewer can diff two runs.
//
//   node scripts/security_scan.mjs
//   node scripts/security_scan.mjs --out docs/evidence/W9-02/security_scan_report.json
//
// Exit code is non-zero when a CRITICAL or HIGH advisory is open, so the scan
// can gate a release. This is a complement to, not a substitute for, an
// independent penetration test (which remains with Sirius IT).
// ---------------------------------------------------------------------------
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function out(name) {
  const arg = process.argv.find((a) => a.startsWith('--out='));
  if (arg && name === 'report') return arg.slice('--out='.length);
  return null;
}

function run(cmd) {
  try {
    return { ok: true, out: execSync(cmd, { cwd: ROOT, maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }).toString() };
  } catch (err) {
    // npm audit exits non-zero when advisories exist; the JSON is still on stdout.
    return { ok: false, out: (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : '') };
  }
}

function audit(omit, cwd) {
  const cmd = 'npm audit --json' + (omit ? ' --omit=dev' : '');
  const raw = cwd ? runIn(cmd, cwd) : run(cmd);
  let json;
  try { json = JSON.parse(raw.out); } catch { return { error: 'audit output was not JSON', vulnerabilities: { total: 0 } }; }
  const v = json.metadata?.vulnerabilities || {};
  const advisories = Object.entries(json.vulnerabilities || {}).map(([name, a]) => ({
    name,
    severity: a.severity,
    titles: (a.via || []).map((x) => (typeof x === 'string' ? x : x.title)).filter(Boolean),
    fix_available: Boolean(a.fixAvailable),
  }));
  return { counts: v, advisories };
}

// Injection / unsafe-API sinks. Comment-only matches are filtered so a doc
// mention of `eval` does not raise a finding.
const SINKS = [
  { id: 'eval', re: /\beval\s*\(/ },
  { id: 'new_function', re: /new\s+Function\s*\(/ },
  { id: 'child_process', re: /child_process/ },
  { id: 'exec_shell', re: /execSync\s*\(|exec\s*\(/ },
  { id: 'innerhtml', re: /dangerouslySetInnerHTML/ },
];

function scanSources() {
  const roots = ['server', 'src'];
  const findings = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(m?js|jsx)$/.test(entry.name)) continue;
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        for (const s of SINKS) {
          if (s.re.test(line)) findings.push({ sink: s.id, file: path.relative(ROOT, full), line: i + 1, text: trimmed.slice(0, 120) });
        }
      });
    }
  };
  for (const r of roots) walk(path.join(ROOT, r));
  return findings;
}

function syntaxCheck() {
  const files = fs.readdirSync(path.join(ROOT, 'server'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join('server', f));
  const failures = [];
  for (const f of files) {
    const abs = path.join(ROOT, f);
    try { execSync('node --check ' + JSON.stringify(abs)); } catch { failures.push(f); }
  }
  return { checked: files.length, failures };
}

function runIn(cmd, dir) {
  try {
    return { ok: true, out: execSync(cmd, { cwd: path.join(ROOT, dir), maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }).toString() };
  } catch (err) {
    return { ok: false, out: (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : '') };
  }
}

const prod = audit(true);
const all = audit(false);
// The Docker runtime image installs only server/ dependencies, so that tree is
// the true production surface even though the root tree carries the frontend.
const serverRuntime = audit(false, 'server');
const sinks = scanSources();
const syntax = syntaxCheck();

const openHigh = (all.counts.high || 0) + (all.counts.critical || 0);
const report = {
  generated_at: new Date().toISOString(),
  tool: 'scripts/security_scan.mjs',
  version: 'NFR-02.1',
  dependency_audit: { server_runtime: serverRuntime, frontend_build: prod, dev_tree: all },
  syntax_check: syntax,
  sink_scan: { findings: sinks, count: sinks.length },
  gate: {
    open_critical_or_high: openHigh,
    pass: openHigh === 0 && syntax.failures.length === 0,
    policy: 'No open critical or high advisories in the dependency tree at go-live.',
  },
};

console.log('DealForge security scan (NFR-02)');
console.log('  server runtime (docker):', JSON.stringify(serverRuntime.counts));
console.log('  frontend build (omit=dev):', JSON.stringify(prod.counts));
console.log('  full-tree advisories  :', JSON.stringify(all.counts));
console.log('  critical/high (full)  :', openHigh);
console.log('  server files checked  :', syntax.checked, 'syntax failures:', syntax.failures.length);
console.log('  injection-sink hits   :', sinks.length);
for (const a of all.advisories.filter((x) => x.severity === 'critical' || x.severity === 'high')) {
  console.log('    ! ' + a.severity + ' ' + a.name + ' - ' + a.titles[0]);
}

const dest = out('report');
if (dest) {
  fs.mkdirSync(path.dirname(path.resolve(ROOT, dest)), { recursive: true });
  fs.writeFileSync(path.resolve(ROOT, dest), JSON.stringify(report, null, 2));
  console.log('  report written to     :', dest);
}

process.exit(report.gate.pass ? 0 : 1);
