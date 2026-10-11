/* ChordPath — shared plumbing for the end-to-end suites.
 * Launches the real desktop app against a throwaway data folder with sound
 * muted and Chromium's fake microphone, and keeps score.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.CHORDPATH_SHOTS || '';

let passed = 0, failed = 0;
const failures = [];

function check(label, cond) {
  if (cond) { passed++; console.log('  ok: ' + label); }
  else { failed++; failures.push(label); console.error('  FAIL: ' + label); }
}
function section(name) { console.log('\n== ' + name + ' =='); }

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chordpath-e2e-'));
}

async function launch(userData) {
  const app = await electron.launch({
    args: ['.'], cwd: ROOT,
    env: Object.assign({}, process.env, { CHORDPATH_USER_DATA: userData, CHORDPATH_E2E: '1' }),
  });
  const page = await app.firstWindow();
  const log = { errors: [], requests: [] };
  page.on('console', msg => { if (msg.type() === 'error') log.errors.push(msg.text()); });
  page.on('pageerror', err => log.errors.push(String(err)));
  page.on('request', req => log.requests.push(req.url()));
  await page.waitForSelector('#navTabs [data-nav="songs"].active');
  return { app, page, log };
}

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

function crashed(err) {
  failed++;
  failures.push('crashed: ' + err.message);
  console.error(err);
}

function finish() {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('\nFailed checks:');
    failures.forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}

module.exports = { ROOT, check, section, tempDataDir, launch, shot, crashed, finish, cleanup };
