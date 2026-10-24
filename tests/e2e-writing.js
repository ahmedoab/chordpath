/* ChordPath — writing a song in the real app: starting one, the section
 * editor, and the ideas it offers. Nothing is written for the writer: the
 * tests check that ideas are heard first and go in only when chosen.
 * Run with: node tests/e2e-writing.js   (or npm run test:e2e)
 */
'use strict';

const { check, section, tempDataDir, launch, shot, crashed, finish, cleanup } = require('./e2e-helpers');

(async () => {
  const userData = tempDataDir();
  let { app, page, log } = await launch(userData);

  // Small readers of the app's own state.
  const song = () => page.evaluate(() => JSON.parse(JSON.stringify(window.App.state.song)));
  const current = () => page.evaluate(() => {
    const s = window.App.state.song;
    return JSON.parse(JSON.stringify(window.Song.getSection(s, window.App.state.sectionId) || s.sections[0]));
  });
  const progression = async () => (await page.locator('#progression .prog-chord .name').allTextContents()).join(' ');
  const optionValues = sel => page.$$eval(sel + ' option', os => os.map(o => o.value));
  // The loudest the app's output gets over the next ms milliseconds, in dB.
  const loudest = async ms => {
    await page.waitForFunction(() => window.Tone.context.state === 'running', null, { timeout: 5000 });
    let peak = -Infinity;
    for (let t = 0; t < ms; t += 100) {
      await page.waitForTimeout(100);
      peak = Math.max(peak, await page.evaluate(() => window.__meter.getValue()));
    }
    return peak;
  };

  try {
    await page.evaluate(() => {
      window.__meter = new window.Tone.Meter();
      window.Tone.getDestination().connect(window.__meter);
    });

    // ── Starting a song ────────────────────────────────────────────────────
    section('Starting a song');
    await page.click('#btnNewSong');
    await page.waitForSelector('#wizardRoot .start');
    check('nothing can start until a key is chosen', await page.isDisabled('#wzCreate'));
    const blackKey = async () => (await page.textContent('.start-tonic[data-pc="1"]')).trim();
    check(`in a major key the note above C is named D♭ first (${await blackKey()})`, /^D♭/.test(await blackKey()));
    await page.click('#startMode [data-scale="natural_minor"]');
    check(`and in a minor key, C♯ (${await blackKey()})`, /^C♯/.test(await blackKey()));
    await page.click('.start-tonic[data-key="E"]');
    await page.click('.start-meter[data-meter="3/4"]');
    await page.fill('#startTitle', 'Paper Boats');
    check('with a key chosen, it can', !(await page.isDisabled('#wzCreate')));
    await page.click('#wzCreate');
    await page.waitForSelector('#view-section:not([hidden]) #progression');
    let s = await song();
    check('the song is in the key and time chosen', s.key === 'E' && s.scale === 'natural_minor' && s.meter.num === 3 && s.meter.den === 4);
    check('and starts with one empty verse, nothing written for the writer', s.sections.length === 1 && s.sections[0].role === 'verse' && s.sections[0].progSpecs.length === 0);
    check('the editor opens on it', /#\/song\/.+\/section\//.test(page.url()) && (await page.locator('#progression .prog-chord').count()) === 0);

    // ── The editor follows the section's time ──────────────────────────────
    section('The section editor in 3/4');
    check('the beat lights have one light per beat of 3/4', (await page.locator('.beat-led span').count()) === 3);
    check('the time box shows 3/4', (await page.inputValue('#sectionMeter')) === '3/4');
    const rhythms = await optionValues('#rhythmPattern');
    check('rhythm choices start with plain chords', rhythms[0] === '' && /Plain/.test(await page.textContent('#rhythmPattern option >> nth=0')));
    check('then the rhythms written for 3/4', rhythms.includes('waltz_strum') && rhythms.includes('waltz_picked'));
    check('and no 4/4 styles, which cannot play in 3/4', !rhythms.includes('jangle_arp') && !rhythms.includes('quarter_downs'));
    const drums = await optionValues('#drumPattern');
    check('drum choices start with none, then the grooves for 3/4', drums[0] === '' && drums.includes('waltz_kit') && !drums.includes('motorik_backbeat'));
    check('an empty section shows plain chords and no drums', (await page.inputValue('#rhythmPattern')) === '' && (await page.inputValue('#drumPattern')) === '');
    check('and no melody, rather than the first one on the list', (await page.inputValue('#vocalPattern')) === '' && /No melody/.test(await page.textContent('#vocalPattern option >> nth=0')));
    check('the feeling can be none in particular', (await page.inputValue('#emotionSelect')) === '' && /No particular feeling/.test(await page.textContent('#emotionSelect option >> nth=0')));
    check('and nothing offers to regenerate the section', (await page.locator('#regenRow, #btnRegenChords, #btnRegenArr, #btnRegenAll').count()) === 0);
    await shot(page, '20-section-empty');

    // ── Ideas ──────────────────────────────────────────────────────────────
    section('Ideas');
    check('the next-chord list is showing first', await page.isVisible('#options') && !(await page.isVisible('#ideas')));
    await page.click('#paneSwitch [data-pane="ideas"]');
    await page.waitForSelector('#ideas .idea');
    check('Ideas replaces it', await page.isVisible('#ideas') && !(await page.isVisible('#options')));
    for (const group of ['progressions', 'rhythms', 'grooves', 'times', 'melodies']) {
      check(`ideas include ${group}`, (await page.locator(`#ideas .idea-group[data-group="${group}"] .idea`).count()) > 0);
    }
    const progs = page.locator('#ideas .idea-group[data-group="progressions"] .idea');
    check(`a handful of progressions to try (${await progs.count()})`, (await progs.count()) >= 6);
    check('every idea can be heard and used', (await page.locator('#ideas .idea').count()) === (await page.locator('#ideas .idea [data-act="hear"]').count())
      && (await page.locator('#ideas .idea').count()) === (await page.locator('#ideas .idea [data-act="use"]').count()));
    const firstIdea = (await progs.nth(0).locator('.idea-chords').textContent()).trim();
    await progs.nth(0).locator('[data-act="hear"]').click();
    const heardIdea = await loudest(1500);
    check(`hearing a progression plays it (peak ${heardIdea.toFixed(1)} dB)`, heardIdea > -50);
    await page.click('#btnStop');
    check('hearing it does not put it in the section', (await current()).progSpecs.length === 0);
    await progs.nth(0).locator('[data-act="use"]').click();
    check(`using it puts exactly those chords in (${firstIdea})`, (await progression()) === firstIdea);
    const used = (await current()).progSpecs.slice();
    const arc = await page.evaluate(() => {
      const svg = document.getElementById('tensionChart');
      const box = svg.viewBox.baseVal;
      const dots = [...svg.querySelectorAll('.dot')].map(d => (d.getAttribute('d').match(/M\s*([\d.]+)\s+([\d.]+)/) || []).slice(1).map(Number));
      return { height: box.height, width: box.width, dots };
    });
    check(`the tension arc has a point per chord, all inside its box (${arc.dots.map(d => d[1]).join(', ')})`,
      arc.dots.length === used.length && arc.dots.every(([x, y]) => x >= 0 && x <= arc.width && y >= 0 && y <= arc.height));
    await page.click('#paneSwitch [data-pane="next"]');
    await page.click('#options .opt >> nth=0');
    check('a chord can be added after it', (await current()).progSpecs.length === used.length + 1);
    await page.click('#btnUndo');
    check('Undo takes that chord away again', JSON.stringify((await current()).progSpecs) === JSON.stringify(used));
    await page.click('#btnUndo');
    check('and Undo again puts back what was there before the idea', (await current()).progSpecs.length === 0);
    await page.click('#paneSwitch [data-pane="ideas"]');
    await page.click('#ideas .idea-group[data-group="progressions"] .idea >> nth=0 >> [data-act="use"]');
    await page.click('#btnReset');
    check('Clear empties the section', (await current()).progSpecs.length === 0);
    await page.click('#btnUndo');
    check('and Undo brings the chords back', JSON.stringify((await current()).progSpecs) === JSON.stringify(used));
    const others = await page.locator('#ideas .idea-group[data-group="progressions"] .idea-chords').allTextContents();
    await page.click('#ideasMore');
    const fresh = await page.locator('#ideas .idea-group[data-group="progressions"] .idea-chords').allTextContents();
    check('"Other ideas" offers different progressions', fresh.join('|') !== others.join('|'));

    await page.click('#ideas .idea-group[data-group="rhythms"] .idea[data-id="waltz_strum"] [data-act="use"]');
    check('using a rhythm chooses it', (await page.inputValue('#rhythmPattern')) === 'waltz_strum' && (await current()).rhythmPattern === 'waltz_strum');
    check('and marks it as the one in use', (await page.locator('#ideas .idea-group[data-group="rhythms"] .idea.current').getAttribute('data-id')) === 'waltz_strum');
    await page.click('#ideas .idea-group[data-group="grooves"] .idea[data-id="waltz_kit"] [data-act="use"]');
    check('using a groove chooses it', (await current()).drumPattern === 'waltz_kit');
    await page.click('#ideas .idea-group[data-group="melodies"] .idea >> nth=0 >> [data-act="use"]');
    check('using a melody shape chooses it', (await page.inputValue('#vocalPattern')) !== '' && (await current()).vocalPattern !== '');
    await shot(page, '21-section-ideas');

    // ── Another time ───────────────────────────────────────────────────────
    section('Another time');
    await page.click('#ideas .idea-group[data-group="times"] .idea[data-id="6/8"] [data-act="hear"]');
    const heardTime = await loudest(1200);
    check(`a time can be heard before it is chosen (peak ${heardTime.toFixed(1)} dB)`, heardTime > -50);
    await page.click('#btnStop');
    check('hearing it changes nothing', (await current()).meterOverride === null && (await page.inputValue('#sectionMeter')) === '3/4');
    await page.click('#ideas .idea-group[data-group="times"] .idea[data-id="6/8"] [data-act="use"]');
    let sec = await current();
    check('using it puts the section in 6/8', sec.meterOverride && sec.meterOverride.num === 6 && sec.meterOverride.den === 8 && (await page.inputValue('#sectionMeter')) === '6/8');
    check('the song keeps its own time', (await song()).meter.num === 3);
    check('the chords stay', JSON.stringify(sec.progSpecs) === JSON.stringify(used));
    const six = await page.evaluate(() => window.Meters.rhythmsFor('6/8').map(r => r.id));
    check(`the rhythm becomes one written for 6/8 (${sec.rhythmPattern})`, six.includes(sec.rhythmPattern));
    check('the beat lights now count six', (await page.locator('.beat-led span').count()) === 6);
    check('and the rhythm list is the one for 6/8', (await optionValues('#rhythmPattern')).includes('six_eight_sway') && !(await optionValues('#rhythmPattern')).includes('waltz_strum'));
    await page.selectOption('#chordLength', { label: '2 bars' });
    sec = await current();
    check('a chord can last two bars', sec.beatsPerChord === 6);
    await page.selectOption('#sectionMeter', '3/4');
    sec = await current();
    check('back in the song\'s time, the section follows the song again', sec.meterOverride === null && sec.beatsPerChord === 6 && (await page.locator('.beat-led span').count()) === 3);

    // ── Tabs follow the time ───────────────────────────────────────────────
    section('Tabs');
    await page.click('#tabTabs [data-tab="chords"]');
    const chordTab = await page.textContent('#tabPane');
    check('the chord tab shows how the rhythm is strummed, counted in three', /Count\s+1\s+&\s+2\s+&\s+3/.test(chordTab) && /↓/.test(chordTab));
    await page.click('#tabTabs [data-tab="drums"]');
    const drumTab = await page.textContent('#tabPane');
    check('the drum tab is a 3/4 bar, twelve steps wide', drumTab.split('\n').some(line => /^KK\|[x-]{12}\|$/.test(line)));
    await page.click('#tabTabs [data-tab="melody"]');
    check('the vocal tab shows the melody shape chosen', /\|/.test(await page.textContent('#tabPane')) && !/no vocal/i.test(await page.textContent('#tabPane')));
    await page.click('#tabTabs [data-tab="bass"]');
    check('the bass tab has notes on the low strings', /^E \|.*\d/m.test(await page.textContent('#tabPane')));

    // ── Playing it ─────────────────────────────────────────────────────────
    section('Playing');
    await page.click('#btnPlayBand');
    const heardBand = await loudest(600);
    check(`Band plays the section (peak ${heardBand.toFixed(1)} dB)`, heardBand > -50);
    const lit = await page.evaluate(() => new Promise(resolve => {
      const seen = new Set();
      const t = setInterval(() => document.querySelectorAll('.beat-led span').forEach((sp, i) => { if (sp.classList.contains('on')) seen.add(i); }), 20);
      setTimeout(() => { clearInterval(t); resolve(Array.from(seen).sort()); }, 2600);
    }));
    check(`all three beat lights take their turn (${lit.join(',')})`, lit.join(',') === '0,1,2');
    await page.click('#btnStop');

    // ── More sections ──────────────────────────────────────────────────────
    section('Adding a section');
    await page.click('#btnAddSection');
    await page.click('#modalContent [data-role="chorus"]');
    await page.waitForFunction(() => window.App.state.song.sections.length === 2);
    await page.waitForFunction(() => window.App.state.sectionId === window.App.state.song.sections[1].id, null, { timeout: 5000 });
    s = await song();
    check('a new section starts empty', s.sections[1].role === 'chorus' && s.sections[1].progSpecs.length === 0 && s.sections[1].rhythmPattern === '' && s.sections[1].vocalPattern === '');
    check('and the editor moves to it', (await current()).id === s.sections[1].id && (await page.locator('#progression .prog-chord').count()) === 0);

    // ── Starter sounds stay in the writer's key ────────────────────────────
    section('Starter sounds');
    await page.click('[popovertarget="popMore"]');
    await page.click('#btnPresets');
    await page.click('#modalContent [data-preset="0"]');
    s = await song();
    sec = await current();
    check('a starter sound does not change the song\'s key', s.key === 'E' && s.scale === 'natural_minor');
    check('nor the section\'s role', sec.role === 'chorus');
    check(`it is played in the song's key (${sec.progSpecs.join(' ')})`, sec.progSpecs.join(' ') === 'G:add9 D:sus4 E:m7 C:maj7');
    await page.click('#btnUndo');
    check('and Undo takes it out again', (await current()).progSpecs.length === 0);

    // ── Keys ───────────────────────────────────────────────────────────────
    section('Keyboard');
    await page.click('#navTabs [data-nav="section"]');
    const ideasBefore = await page.isVisible('#ideas');
    await page.keyboard.press('i');
    check('I switches between the next chord and ideas', (await page.isVisible('#ideas')) === !ideasBefore && (await page.isVisible('#options')) === ideasBefore);

    // ── Keys are named the way musicians name them ─────────────────────────
    section('Key names');
    await page.click('#navTabs [data-nav="songs"]');
    await page.click('#btnNewSong');
    await page.waitForSelector('#wizardRoot .start');
    await page.click('.start-tonic[data-pc="1"]');
    await page.click('#wzCreate');
    await page.waitForSelector('#view-section:not([hidden]) #progression');
    s = await song();
    check(`a song started on the key above C, in major, is in D♭ (${s.key})`, s.key === 'Db' && s.scale === 'major');
    const active = async () => page.$eval('#keyGrid button.active', b => ({ pc: b.dataset.pc, text: b.textContent.trim() }));
    let on = await active();
    check(`the key grid shows it as D♭ (${on.text})`, on.pc === '1' && on.text === 'D♭');
    await page.click('#keyModeToggle [data-mode="minor"]');
    s = await song();
    on = await active();
    check(`switched to minor, it becomes C♯ minor (${s.key}, ${on.text})`, s.key === 'C#' && s.scale === 'natural_minor' && on.pc === '1' && on.text === 'C♯');
    await page.click('#keyModeToggle [data-mode="major"]');
    check('and back to D♭ major', (await song()).key === 'Db');
    await page.click('#keyGrid button[data-pc="10"]');
    check('a key chosen in the grid is named for the mode too: B♭', (await song()).key === 'Bb' && (await active()).text === 'B♭');
    await page.evaluate(() => { window.App.mutate(sg => { sg.key = 'A#'; }); window.Views.Section.renderAll(); });
    on = await active();
    check(`an older song saved in A# still lights the right key (${on.text})`, on.pc === '10');

    // ── Health ─────────────────────────────────────────────────────────────
    section('Health');
    const external = log.requests.filter(u => !/^(app:\/\/chordpath\/|blob:|data:)/.test(u));
    check('writing made no request beyond the app\'s own files', external.length === 0);
    if (log.errors.length) console.error(log.errors.join('\n'));
    check('no errors were logged', log.errors.length === 0);
  } catch (err) {
    crashed(err);
    try { await shot(page, 'crash-writing'); } catch (e) { /* window may be gone */ }
  } finally {
    try { await app.close(); } catch (e) { /* already closed */ }
    cleanup(userData);
  }
  finish();
})();
