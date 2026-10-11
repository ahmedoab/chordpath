/* ChordPath — a check of the packaged application.
 * Run with: npm run dist && npm run test:packaged
 * Launches dist/win-unpacked/ChordPath.exe, the same program the installer
 * installs, and makes sure it is whole: it starts, serves itself, makes a
 * song, opens it in the DAW, plays and bounces it, and keeps to itself.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { _electron: electron } = require('playwright-core');
const { ROOT, check, section, tempDataDir, crashed, finish, cleanup } = require('./e2e-helpers');

const EXE = path.join(ROOT, 'dist', 'win-unpacked', 'ChordPath.exe');

(async () => {
  if (!fs.existsSync(EXE)) {
    console.error('There is no packaged app at ' + EXE + '. Build it first with: npm run dist');
    process.exit(1);
  }
  const userData = tempDataDir();
  const downloads = tempDataDir();
  let app = null;
  try {
    app = await electron.launch({
      executablePath: EXE,
      env: Object.assign({}, process.env, { CHORDPATH_USER_DATA: userData, CHORDPATH_E2E: '1', CHORDPATH_DOWNLOADS: downloads }),
    });
    const page = await app.firstWindow();
    const errors = [], requests = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(String(err)));
    page.on('request', req => requests.push(req.url()));
    await page.waitForSelector('#navTabs [data-nav="songs"].active');

    section('The program');
    const about = await app.evaluate(({ app: a }) => ({ packaged: a.isPackaged, version: a.getVersion(), name: a.getName() }));
    check('it is the packaged build, not the development one', about.packaged === true);
    check(`it carries the right name and version (${about.name} ${about.version})`,
      about.name === 'ChordPath' && about.version === require(path.join(ROOT, 'package.json')).version);
    check('the window opens on the app\'s own address', page.url() === 'app://chordpath/index.html' && /ChordPath/.test(await page.title()));
    check('the bundled audio library and fonts made it into the package', await page.evaluate(async () => {
      await document.fonts.ready;
      return typeof window.Tone === 'object' && document.fonts.check('14px Inter');
    }));
    check('every part of the app loaded', await page.evaluate(() =>
      ['Feelings', 'Muse', 'Research', 'DawProject', 'DawEngine', 'DawStore', 'Stretch', 'Tabs', 'Views'].every(name => typeof window[name] === 'object')));
    check('nothing outside the app is served, and the page cannot reach the internet', await page.evaluate(async () => {
      for (const url of ['app://chordpath/package.json', 'app://chordpath/desktop/main.js', 'https://example.com/']) {
        try { const r = await fetch(url); if (r.ok) return false; } catch (e) { /* refused is right */ }
      }
      return true;
    }));
    await page.waitForTimeout(300);
    errors.length = 0;                                             // those probes were meant to be refused

    section('Making a song');
    await page.click('#navTabs [data-nav="muse"]');
    await page.waitForSelector('#museTitle');
    check('Muse is there with its library', /well-known songs/.test(await page.textContent('.muse-thread')));
    check('and can look songs up, through the shell', await page.isVisible('#museMode') && await page.evaluate(() => typeof window.Desktop.lookup === 'function'));
    await page.click('#museMode [data-mode="ask"]');
    await page.fill('#museAsk', 'wistful and slow, late at night');
    await page.click('#museAskForm button[type="submit"]');
    await page.waitForSelector('.draft-card');
    check('it drafts a progression', (await page.locator('#mdChords .cc').count()) >= 2);
    await page.click('#mdSong');
    await page.waitForSelector('#overviewRoot #ovDaw');
    check('and turns it into a song', await page.evaluate(() => window.Storage.listProjects().length === 1));

    section('The DAW');
    await page.click('#ovDaw');
    await page.waitForSelector('#dawCanvas');
    const tracks = await page.evaluate(() => DawEngine.get().project.tracks.map(t => t.name));
    check('the song opens as tracks', tracks.length >= 4 && tracks[0] === 'Chords');
    await page.click('#dawPanelTabs [data-panel="mixer"]');
    await page.click('#dawPlay');
    let loudest = -160;
    for (let i = 0; i < 25; i++) {
      await page.waitForTimeout(100);
      loudest = Math.max(loudest, await page.evaluate(() => DawEngine.get().levels().master));
    }
    check(`it plays (peak ${loudest.toFixed(0)} dB)`, loudest > -40);
    await page.click('#dawPlay');
    await page.click('#dawExport');
    await page.click('#modalContent [data-export="mix"]');
    let mixdown = null;
    for (let i = 0; i < 450 && !mixdown; i++) {
      await page.waitForTimeout(200);
      mixdown = fs.readdirSync(downloads).find(name => /\.wav$/.test(name) && fs.statSync(path.join(downloads, name)).size > 100000) || null;
    }
    check('and bounces the song to a WAV file', !!mixdown);

    section('Keeping to itself');
    const outside = requests.filter(u => !/^(app:\/\/chordpath\/|blob:|data:)/.test(u));
    check('none of that made a request beyond the app\'s own files', outside.length === 0);
    const reach = await app.evaluate(async ({ session }) => {
      try { await session.fromPartition('lookup').fetch('https://example.com/'); return 'reached'; } catch (e) { return 'refused'; }
    });
    check('and the lookup channel still reaches only Wikipedia', reach === 'refused');
    if (errors.length) console.error(errors.join('\n'));
    check('no errors were logged', errors.length === 0);
  } catch (err) {
    crashed(err);
  } finally {
    try { if (app) await app.close(); } catch (e) { /* already closed */ }
    cleanup(userData);
    cleanup(downloads);
  }
  finish();
})();
