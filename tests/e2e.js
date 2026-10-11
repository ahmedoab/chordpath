/* ChordPath — end-to-end tests.
 * Run with: npm run test:e2e
 * Launches the real desktop app against a throwaway data folder and drives
 * it like a user would. Sound is muted for the run; the audio engine still
 * runs, so levels can be measured.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { check, section, tempDataDir, launch, shot, crashed, finish, cleanup } = require('./e2e-helpers');

// What "Wikipedia" says in this run. The shell answers Muse's lookups from
// these files, in the shape the real site answers in, so the test never goes
// online. The article is made up.
const ARTICLE = `"Lantern Road" is a song by the English rock band The Hollow Pines, released in 1994 as the second single from their album Slow Weather. Written by singer Mara Quill, it is an alternative rock ballad with elements of dream pop.

== Composition ==
"Lantern Road" is written in the key of E minor and moves at a tempo of 76 beats per minute. The verses follow a chord progression of Em–C–G–D, while the chorus shifts to C–G–D–Em. Critics have described the song as melancholic and haunting, with a bittersweet, yearning chorus.`;

(async () => {
  const userData = tempDataDir();
  const fixtures = tempDataDir();
  process.env.CHORDPATH_LOOKUP_FIXTURES = fixtures;
  fs.writeFileSync(path.join(fixtures, 'search.json'), JSON.stringify({ query: { search: [{
    title: 'Lantern Road (The Hollow Pines song)',
    snippet: '<span class="searchmatch">Lantern</span> <span class="searchmatch">Road</span> is a song by the English rock band The Hollow Pines',
  }] } }));
  fs.writeFileSync(path.join(fixtures, 'page.json'), JSON.stringify({ query: { pages: [{
    title: 'Lantern Road (The Hollow Pines song)', fullurl: 'https://en.wikipedia.org/wiki/Lantern_Road_(The_Hollow_Pines_song)', extract: ARTICLE,
  }] } }));
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
    check('and offers to look the song up, saying where', /look it up on Wikipedia/.test(await page.textContent('.muse-thread')) && await page.isVisible('#museLookup'));

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

    // ── Muse: looking a song up online ─────────────────────────────────────
    section('Muse — looking a song up');
    const thread = () => page.textContent('.muse-thread');
    await page.fill('#museTitle', 'Lantern Road');
    await page.fill('#museArtist', 'The Hollow Pines');
    await page.click('#museSongForm button[type="submit"]');
    await page.waitForSelector('#museLookup');
    check('the button says what will be sent', /title and artist/i.test(await page.getAttribute('#museLookup', 'title')));
    // Chords already in the box are yours: a lookup reports what it found and leaves them be.
    await page.fill('#museChords', 'Am F C G');
    await page.click('#museLookup');
    await page.waitForFunction(() => /I found/.test(document.querySelector('.muse-thread').textContent), null, { timeout: 15000 }).catch(() => {});
    check('chords you have already typed are not replaced by what it finds',
      (await page.inputValue('#museChords')) === 'Am F C G' && /left the box as you had it/.test(await thread()));
    await page.fill('#museChords', '');
    await page.click('#museLookup');
    await page.waitForFunction(() => document.getElementById('museChords').value !== '', null, { timeout: 15000 }).catch(() => {});
    const told = await page.innerText('.muse-thread .bubble:last-child');
    check('it names the article it read, with a link to it',
      (await page.getAttribute('.muse-thread a.muse-source', 'href').catch(() => '')) === 'https://en.wikipedia.org/wiki/Lantern_Road_(The_Hollow_Pines_song)');
    check('and tells you what the article says: who, when, style, key and tempo',
      /The Hollow Pines/.test(told) && /1994/.test(told) && /alternative rock/.test(told) && /E minor/.test(told) && /76 bpm/.test(told));
    check('the chords it found are in the box, waiting to be checked', (await page.inputValue('#museChords')) === 'Em C G D');
    check('a second progression the article mentions is passed on as well', /C G D Em/.test(told));
    check('nothing is learned until you say so', !/Lantern Road/.test(await page.textContent('#museMemory')));
    await shot(page, '06-muse-lookup');

    await page.click('#museChordsForm button[type="submit"]');
    await page.waitForSelector('#museChordsOk');
    check('the key is the one the article gives',
      (await page.inputValue('#museKey')) === 'E' && (await page.textContent('#museKeyMode button.active')) === 'minor');
    await page.click('#museChordsOk');
    await page.waitForSelector('#museFeel');
    check('Muse passes on the article\'s words for how it feels', /melancholic, haunting, bittersweet, yearning/.test(await page.textContent('#museStep')));
    check('but leaves the description to you', (await page.inputValue('#museFeel')) === '');
    await page.click('#museUseFeel');
    check('unless you take them as a start', (await page.inputValue('#museFeel')) === 'melancholic, haunting, bittersweet, yearning');
    await page.click('#museFeelForm button[type="submit"]');
    await page.waitForSelector('#museSave');
    await page.click('#museSave');
    await page.waitForSelector('.draft-card');
    const learned = await page.evaluate(() => JSON.parse(localStorage.getItem('chordpath:muse:memory')).songs.find(s => s.title === 'Lantern Road'));
    check('once confirmed, it is learned as a song you taught, with what the article added',
      !!learned && learned.source === 'user' && learned.tempo === 76 && learned.year === 1994 && learned.key === 'E' && learned.genreId === 'indie');
    await page.click('#mdDone');

    // No connection: the question goes unanswered and Muse says so.
    fs.unlinkSync(path.join(fixtures, 'search.json'));
    await page.fill('#museTitle', 'Far Shore');
    await page.click('#museSongForm button[type="submit"]');
    await page.waitForSelector('#museLookup');
    await page.click('#museLookup');
    await page.waitForFunction(() => /couldn't reach Wikipedia/.test(document.querySelector('.muse-thread').textContent), null, { timeout: 15000 }).catch(() => {});
    check('with no connection Muse says so and still takes chords by hand',
      /couldn't reach Wikipedia/.test(await thread()) && await page.isEnabled('#museChords') && (await page.inputValue('#museChords')) === '');
    await page.click('#museCancel');

    // The way out itself, tried from both ends.
    const reach = await app.evaluate(async ({ session }) => {
      const ses = session.fromPartition('lookup');
      const attempt = async url => { try { await ses.fetch(url); return 'reached'; } catch (e) { return 'refused'; } };
      return [await attempt('https://example.com/'), await attempt('http://en.wikipedia.org/'), await attempt('https://en.wikipedia.org.example.com/')];
    });
    check('the channel Muse looks things up through cannot reach anywhere but Wikipedia', reach.join() === 'refused,refused,refused');
    check('and the page can only ask it the two questions it knows', await page.evaluate(() => Promise.all([
      window.Desktop.lookup('fetch', 'https://example.com/').then(() => false, () => true),
      window.Desktop.lookup('page', '').then(() => false, () => true),
      window.Desktop.lookup('search', 'x'.repeat(500)).then(() => false, () => true),
    ]).then(all => all.every(Boolean))));

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
      /Night Shapes/.test(await page.textContent('#museMemory')) && /You've taught me 2 songs/.test(await page.textContent('.muse-thread')));
    check('the drafted song survives a restart', await page.evaluate(() => window.Storage.listProjects().length === 1));
  } catch (err) {
    crashed(err);
    try { await shot(page, 'crash'); } catch (e) { /* window may be gone */ }
  } finally {
    try { await app.close(); } catch (e) { /* already closed */ }
    cleanup(userData);
    cleanup(fixtures);
  }
  finish();
})();
