// Usability UAT harness (W9-07 / BRD NFR-07).
//
// Scores recorded pilot sessions against the NFR-07 gate. The pilot proof is a
// human session, so this script does not invent one: it reads a sessions file
// (docs/evidence/W9-07/sessions.json) produced from a real UAT session and
// reports the verdict. With no recorded sessions it reports the gate as pending
// and exits 0 (nothing to fail yet); with recorded sessions that miss the
// criteria it exits non-zero so the release gate blocks until they are fixed.
//
//   node scripts/usability_uat.mjs [--sessions=path]
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { evaluateUsabilityUat, PILOT_TASKS } from '../server/config/usability.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT = path.join(ROOT, 'docs', 'evidence', 'W9-07', 'sessions.json');

function loadSessions(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function run({ file = DEFAULT } = {}) {
  const data = loadSessions(file);
  if (!data) {
    console.log('Usability UAT (NFR-07): no pilot sessions recorded yet.');
    console.log('Gate PENDING — awaiting pilot session(s) at', path.relative(ROOT, file));
    console.log('Gate tasks:', PILOT_TASKS.filter((t) => t.unaided).map((t) => t.id).join(', '));
    return { pending: true, pass: false };
  }
  const result = evaluateUsabilityUat(data);
  console.log('Usability UAT (NFR-07):', result.pilots, 'pilot session(s)');
  console.log('  unaided rate :', result.unaided_rate, '(min', result.criteria.min_unaided_rate + ')');
  console.log('  critical     :', result.critical_issues);
  console.log('  SUS mean     :', result.sus_mean);
  console.log('  verdict      :', result.pass ? 'PASS' : 'FAIL');
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv.find((a) => a.startsWith('--sessions='));
  const file = arg ? path.resolve(arg.slice('--sessions='.length)) : DEFAULT;
  const result = run({ file });
  if (!result.pending && !result.pass) process.exit(1);
}
