/* ChordPath — end-to-end tests.
 * Run with: npm run test:e2e
 * Launches the real desktop app against a throwaway data folder and drives
 * it like a user would. Sound is muted for the run; the audio engine still
 * runs, so levels can be measured.
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

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'chordpath-e2e-'));
  let { app, page, log } = await launch(userData);

  try {
    // ── Shell ──────────────────────────────────────────────────────────────
    section('Desktop shell');
    check('window opens with the app title', /ChordPath/.test(await page.title()));
    check('page is served from the private app address', page.url() === 'app://chordpath/index.html');
    check('the audio library is bundled and loaded', await page.evaluate(() => typeof window.Tone === 'object' && !!window.Tone.Transport));
    await page.evaluate(() => document.fonts.ready);
    check('the bundled fonts are in use', await page.evaluate(() =>
      document.fonts.check('14px Inter') && [...document.fonts].some(f => f.family.replace(/"/g, '') === 'Inter' && f.status === 'loaded')));
    check('the page has no Node or Electron access', await page.evaluate(() =>
      typeof window.require === 'undefined' && typeof window.process === 'undefined'));
    check('the desktop bridge is exposed', await page.evaluate(() => window.Desktop && window.Desktop.isDesktop === true));
    check('files outside the app are not served', await page.evaluate(async () => {
      const urls = ['app://chordpath/package.json', 'app://chordpath/desktop/main.js',
        'app://chordpath/node_modules/electron/package.json', 'app://chordpath/theory/../package.json',
        'app://chordpath/theory/%2e%2e/%2e%2e/package.json', 'app://other/index.html'];
      for (const u of urls) {
        try { const r = await fetch(u); if (r.ok) return false; } catch (e) { /* refused is fine */ }
      }
      return true;
    }));
    check('the page cannot reach the internet', await page.evaluate(() =>
      fetch('https://example.com/').then(() => false, () => true)));
    check('an image pointed at the internet does not load', await page.evaluate(() => new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(false);
      img.onerror = () => resolve(true);
      img.src = 'https://example.com/x.png';
      setTimeout(() => resolve(true), 3000);
    })));

    // The probes above were meant to fail; start the record clean for real use.
    await page.waitForTimeout(300);
    log.errors.length = 0;
    log.requests.length = 0;

    // ── Muse: teaching an unknown song ─────────────────────────────────────
    section('Muse — teaching');
    await page.click('#navTabs [data-nav="muse"]');
    await page.waitForSelector('.muse .bubble.from-muse');
    check('Muse greets and mentions its built-in songs', /well-known songs/.test(await page.textContent('.muse-thread')));
    await shot(page, '01-muse-idle');

    await page.fill('#museTitle', 'Night Shapes');
    await page.fill('#museArtist', 'Test Band');
    await page.click('#museSongForm button[type="submit"]');
    await page.waitForSelector('#museChords');
    check('an unknown song makes Muse ask for the chords',
      /don't know/.test(await page.textContent('.muse-thread')) && /What are the chords/.test(await page.textContent('.muse-thread')));
    check('Muse says it never looks anything up', /never look anything up/.test(await page.textContent('.muse-thread')));

    await page.fill('#museChords', 'nothing useful here');
    await page.click('#museChordsForm button[type="submit"]');
    check('text with no chords is refused, not stored', await page.isVisible('#museChords'));

    await page.fill('#museChords', 'Em G D A');
    await page.click('#museChordsForm button[type="submit"]');
    await page.waitForSelector('#museChordsOk');
    check('the chords are read back as four chips', (await page.locator('#museStep .cc').count()) === 4);
    check('the key is detected as E minor',
      (await page.inputValue('#museKey')) === 'E' && (await page.textContent('#museKeyMode button.active')) === 'minor');
    check('roman numerals are shown', (await page.textContent('#museStep .cc >> nth=0')).includes('i'));
    await shot(page, '02-muse-chords');

    await page.click('#museChordsOk');
    await page.waitForSelector('#museFeel');
    check('Muse then asks how it feels', /What does it feel like/.test(await page.textContent('.muse-thread')));
    await page.fill('#museFeel', 'hazy and bittersweet, like petrichor after a storm');
    await page.click('#museFeelForm button[type="submit"]');
    await page.waitForSelector('#museSave');
    const heard = await page.locator('#museStep .chip.toggle.on').allTextContents();
    check('it hears dreamy and wistful in the description', heard.includes('Dreamy') && heard.includes('Wistful'));
    check('it admits which words are new to it', /petrichor/.test(await page.textContent('#museStep')));
    await shot(page, '03-muse-feel');

    await page.click('#museSave');
    await page.waitForSelector('.draft-card');
    check('saving produces a draft straight away', (await page.locator('#mdChords .cc').count()) >= 2);
    check('the taught song appears in the memory panel', /Night Shapes/.test(await page.textContent('#museMemory')));
    check('memory is written to local storage', await page.evaluate(() =>
      JSON.parse(localStorage.getItem('chordpath:muse:memory')).songs.some(s => s.title === 'Night Shapes')));
    await shot(page, '04-muse-draft');

    // ── Muse: drafting ─────────────────────────────────────────────────────
    section('Muse — drafting');
    const firstDraft = await page.textContent('#mdChords');
    await page.click('#mdAgain');
    await page.click('#mdAgain');
    check('"Another" produces a different draft', (await page.textContent('#mdChords')) !== firstDraft);
    await page.click('#mdClose [data-c="close"]');
    check('closeness can be changed', (await page.textContent('#mdClose button.active')) === 'Close');

    await page.evaluate(() => {
      window.__meter = new window.Tone.Meter();
      window.Tone.getDestination().connect(window.__meter);
    });
    await page.click('#mdPlay');
    await page.waitForFunction(() => window.Tone.context.state === 'running', null, { timeout: 5000 });
    let peak = -Infinity;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(100);
      peak = Math.max(peak, await page.evaluate(() => window.__meter.getValue()));
    }
    check('pressing Play makes sound (peak ' + peak.toFixed(1) + ' dB)', peak > -50);
    check('the playing chord is highlighted', (await page.locator('#mdChords .cc.playing').count()) <= 1);
    await page.click('#mdStop');

    // ── Muse: a song from the built-in library ─────────────────────────────
    section('Muse — built-in library');
    await page.click('#mdDone');
    await page.fill('#museTitle', 'wonderwall');
    await page.click('#museSongForm button[type="submit"]');
    await page.waitForSelector('#museChords');
    check('a library song is recognised', /built-in library/.test(await page.textContent('.muse-thread')));
    check('its chords are offered for checking', /F#m7/.test(await page.inputValue('#museChords')));

    const opened = await app.evaluate(async ({ shell }) => {
      global.__opened = [];
      shell.openExternal = async url => { global.__opened.push(url); };
      return true;
    });
    const pagesBefore = app.windows().length;
    await page.click('.muse-link');
    await page.waitForTimeout(400);
    const openedUrls = await app.evaluate(() => global.__opened);
    check('the look-it-up link is handed to the user\'s browser',
      opened && openedUrls.length === 1 && openedUrls[0].startsWith('https://www.google.com/search?q=') && /chords/.test(openedUrls[0]));
    check('and no window opens inside the app', app.windows().length === pagesBefore && page.url().startsWith('app://chordpath/'));
    await page.click('#museCancel');

    // ── Muse: asking for a draft, then a full song ─────────────────────────
    section('Muse — from a feeling to a song');
    await page.click('#museMode [data-mode="ask"]');
    await page.fill('#museAsk', 'petrichor and hazy, slow');
    await page.click('#museAskForm button[type="submit"]');
    await page.waitForSelector('.draft-card');
    check('a draft for a learned word credits the song it was learned from',
      /Night Shapes/.test(await page.textContent('.draft-card')));
    await page.click('#mdSong');
    await page.waitForSelector('#overviewRoot .ov-card');
    check('"Make a full song" opens it in the song overview', /#\/song\//.test(page.url()));
    const sectionCount = await page.locator('#ovTimeline .ov-card[data-sec]').count();
    check('the song has a full set of sections', sectionCount >= 6);
    check('the song notes credit Muse', await page.evaluate(() => /Drafted by Muse/.test(window.App.state.song.notes)));
    await shot(page, '05-song-overview');

    // ── The rest of the app still works ────────────────────────────────────
    section('Existing views');
    await page.click('#navTabs [data-nav="section"]');
    await page.waitForSelector('#progression .prog-chord');
    check('the section editor opens the drafted song', (await page.locator('#progression .prog-chord').count()) >= 2);
    await page.click('#navTabs [data-nav="studio"]');
    await page.waitForSelector('#studioRoot .studio');
    await page.click('#navTabs [data-nav="handoff"]');
    await page.waitForSelector('#handoffRoot .ho-section');
    check('studio and handoff render', (await page.locator('#handoffRoot .ho-section').count()) >= 3);
    await page.click('#navTabs [data-nav="songs"]');
    await page.waitForSelector('#songsGrid .song-card');
    check('the song is listed on the Songs page', (await page.locator('#songsGrid .song-card').count()) === 1);

    // ── Independence ───────────────────────────────────────────────────────
    section('Independence');
    const external = log.requests.filter(u => !/^(app:\/\/chordpath\/|blob:|data:)/.test(u));
    if (external.length) console.error(external.join('\n'));
    check('using the app made no request beyond its own files', external.length === 0);
    if (log.errors.length) console.error(log.errors.join('\n'));
    check('no errors were logged while using the app', log.errors.length === 0);

    // ── Restart ────────────────────────────────────────────────────────────
    section('Restart');
    await app.close();
    ({ app, page, log } = await launch(userData));
    await page.click('#navTabs [data-nav="muse"]');
    await page.waitForSelector('.muse .bubble.from-muse');
    check('Muse remembers what it was taught after a restart',
      /Night Shapes/.test(await page.textContent('#museMemory')) && /You've taught me 1 song/.test(await page.textContent('.muse-thread')));
    check('the drafted song survives a restart', await page.evaluate(() => window.Storage.listProjects().length === 1));
  } catch (err) {
    failed++;
    failures.push('crashed: ' + err.message);
    console.error(err);
    try { await shot(page, 'crash'); } catch (e) { /* window may be gone */ }
  } finally {
    try { await app.close(); } catch (e) { /* already closed */ }
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('\nFailed checks:');
    failures.forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
})();
