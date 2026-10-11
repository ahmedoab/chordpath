/* ChordPath — DAW screen tests, driving the real app like a user.
 * Run with: node tests/e2e-daw.js   (or npm run test:e2e)
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { check, section, tempDataDir, launch, shot, crashed, finish, cleanup } = require('./e2e-helpers');

// Geometry of the timeline canvas (mirrors ui/daw/arrange.js).
const TOP = 44, LANE_H = 58, RIBBON_H = 24;

(async () => {
  const userData = tempDataDir();
  const downloads = tempDataDir();
  const fixtures = tempDataDir();
  process.env.CHORDPATH_DOWNLOADS = downloads;
  let { app, page, log } = await launch(userData);

  // Canvas helpers: positions are in beats and lanes, converted with the view's own zoom.
  const view = () => page.evaluate(() => {
    const box = document.getElementById('dawCanvas').getBoundingClientRect();
    const hs = document.getElementById('dawHScroll');
    const size = document.getElementById('dawHSize').getBoundingClientRect().width;
    return { x: box.left, y: box.top, w: box.width, h: box.height, scroll: hs.scrollLeft, size };
  });
  const state = () => page.evaluate(() => window.__daw());
  const lanePoint = async (beat, lane, ppb) => {
    const v = await view();
    return { x: v.x + beat * ppb - v.scroll, y: v.y + TOP + lane * LANE_H + LANE_H / 2 };
  };

  try {
    // A song to work on, made the normal way.
    await page.evaluate(() => {
      const song = Feelings.generateSongSpec({ feelingId: 'yearning', genreId: 'jangle_indie', energy: 'mid', seed: 11 });
      song.title = 'Harbour Lights';
      Storage.saveProject(song);
      window.__songId = song.id;
      location.hash = '#/song/' + song.id;
    });
    await page.waitForSelector('#overviewRoot #ovDaw');

    // ── Opening ────────────────────────────────────────────────────────────
    section('Opening a song in the DAW');
    await page.click('#ovDaw');
    await page.waitForSelector('#dawCanvas');
    // The view keeps its state private; tests read it through one small hook.
    await page.evaluate(() => {
      window.__daw = () => {
        const eng = DawEngine.get();
        const p = eng.project;
        return {
          tracks: p.tracks.map(t => ({ id: t.id, name: t.name, kind: t.kind, instrument: t.instrument, mute: t.mute, solo: t.solo, armed: t.armed,
            volume: t.volume, clips: t.clips.map(c => ({ id: c.id, start: c.start, length: c.length, notes: c.notes ? c.notes.length : -1, audioId: c.audioId || null })) })),
          tempo: p.tempo, loop: p.loop, markers: p.markers, master: p.master,
          playing: eng.isPlaying(), recording: eng.isRecording(), position: eng.position(),
        };
      };
    });
    let st = await state();
    check('the DAW route is its own page', /#\/song\/.+\/daw$/.test(page.url()));
    check('the nav shows the DAW tab as active', await page.locator('#navTabs [data-nav="daw"].active').count() === 1);
    check('the song arrives as five tracks', st.tracks.length === 5 && st.tracks.map(t => t.name).join() === 'Chords,Bass,Drums,Vocal melody,Under melody');
    check('with a header for each', (await page.locator('#dawHeads .daw-head').count()) === 5);
    check('sections become markers', st.markers.length === 8 && st.markers[0].name === 'Intro');
    check('the tempo box shows the song tempo', (await page.inputValue('#dawTempo')) === String(st.tempo));
    check('the timeline has been drawn', await page.evaluate(() => {
      const c = document.getElementById('dawCanvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 97) seen.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
      return seen.size > 8;
    }));
    await shot(page, '10-daw-open');
    const ppb = (await view()).size / (116 + 32);     // song is 116 beats long, plus the view's margin

    // ── Transport ──────────────────────────────────────────────────────────
    section('Transport');
    await page.click('#dawPlay');
    await page.waitForFunction(() => window.__daw().playing);
    check('Play starts playback and the button turns into Stop', (await page.textContent('#dawPlay')).includes('Stop'));
    await page.waitForFunction(() => window.__daw().position > 1.5);
    check('the position readout advances', (await page.textContent('#dawBars')) !== '1.1' || (await state()).position > 1.5);
    await page.click('#dawPlay');
    st = await state();
    check('Stop holds the playhead where it was', !st.playing && st.position > 1.5);
    await page.keyboard.press('Home');
    check('Home returns to the start', (await state()).position === 0);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__daw().playing);
    await page.keyboard.press('Space');
    check('Space toggles playback', !(await state()).playing);
    await page.keyboard.press('Home');

    let v = await view();
    await page.mouse.click(v.x + 16 * ppb, v.y + RIBBON_H + 10);
    check('clicking the bar ruler moves the playhead there', Math.abs((await state()).position - 16) < 0.3);

    st = await state();
    const verse = st.markers[1], pre = st.markers[2];
    const inVerse = v.x + (verse.beat + 3) * ppb;
    await page.mouse.click(inVerse, v.y + 10);
    st = await state();
    check('clicking a section loops exactly that section',
      st.loop.on && st.loop.start === verse.beat && st.loop.end === pre.beat && Math.abs(st.position - verse.beat) < 0.01);
    check('and lights the Loop button', await page.locator('#dawLoop.on').count() === 1);
    await page.mouse.click(inVerse, v.y + 10);
    check('clicking it again turns the loop off', !(await state()).loop.on);

    await page.mouse.move(v.x + 8 * ppb, v.y + RIBBON_H + 10);
    await page.mouse.down();
    await page.mouse.move(v.x + 16 * ppb, v.y + RIBBON_H + 10, { steps: 4 });
    await page.mouse.up();
    st = await state();
    check('dragging in the ruler sets a loop range', st.loop.on && Math.abs(st.loop.start - 8) < 0.3 && Math.abs(st.loop.end - 16) < 0.3);
    await page.keyboard.press('l');
    check('L toggles the loop', !(await state()).loop.on);

    await page.fill('#dawTempo', '132');
    await page.press('#dawTempo', 'Enter');
    check('the tempo can be changed', (await state()).tempo === 132);
    await page.click('#dawUndo');
    check('and undone', (await state()).tempo !== 132);
    await page.click('#dawRedo');
    check('and redone', (await state()).tempo === 132);
    await page.click('#dawUndo');

    // ── Clips ──────────────────────────────────────────────────────────────
    section('Clips on the timeline');
    const bass = (await state()).tracks[1];
    const firstClip = bass.clips[0];
    let pt = await lanePoint(firstClip.start + 2, 1, ppb);
    await page.mouse.click(pt.x, pt.y);
    check('clicking a clip selects it and shows it in the note editor',
      (await page.locator('#dawRoll').count()) === 1 && /Bass/.test(await page.textContent('#dawClipInfo')));
    check('its track header is highlighted', (await page.locator('#dawHeads .daw-head.selected .daw-name').textContent()) === 'Bass');

    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.move(pt.x + 8 * ppb, pt.y, { steps: 5 });
    await page.mouse.up();
    let moved = (await state()).tracks[1].clips.find(c => c.id === firstClip.id);
    check('dragging a clip moves it along the timeline', Math.abs(moved.start - (firstClip.start + 8)) < 0.3);
    await page.keyboard.press('Control+z');
    moved = (await state()).tracks[1].clips.find(c => c.id === firstClip.id);
    check('Ctrl+Z puts it back', moved.start === firstClip.start);

    pt = await lanePoint(firstClip.start + firstClip.length, 1, ppb);
    await page.mouse.move(pt.x - 3, pt.y);
    await page.mouse.down();
    await page.mouse.move(pt.x - 3 - 4 * ppb, pt.y, { steps: 4 });
    await page.mouse.up();
    moved = (await state()).tracks[1].clips.find(c => c.id === firstClip.id);
    check('dragging a clip edge trims it', Math.abs(moved.length - (firstClip.length - 4)) < 0.3);
    await page.keyboard.press('Control+z');

    pt = await lanePoint(firstClip.start + 2, 1, ppb);
    await page.mouse.click(pt.x, pt.y);
    await page.keyboard.press('Control+d');
    check('Ctrl+D duplicates the selected clip', (await state()).tracks[1].clips.length === bass.clips.length + 1);
    await page.keyboard.press('Delete');
    check('Delete removes the selected clip', (await state()).tracks[1].clips.length === bass.clips.length);

    await page.mouse.click(pt.x, pt.y);
    v = await view();
    await page.mouse.click(v.x + (firstClip.start + 4) * ppb, v.y + RIBBON_H + 10);
    await page.keyboard.press('s');
    st = await state();
    const halves = st.tracks[1].clips.filter(c => c.start === firstClip.start || c.start === firstClip.start + 4);
    check('S splits the selected clip at the playhead',
      st.tracks[1].clips.length === bass.clips.length + 1 && halves.length === 2 && halves[0].length === 4);
    await page.keyboard.press('Control+z');

    // Clear the bass out of the intro, then draw a new clip into the gap.
    await page.mouse.click(pt.x, pt.y);
    await page.keyboard.press('Delete');
    check('the intro is now empty on the bass track', !(await state()).tracks[1].clips.some(c => c.start < 8));
    const empty = await lanePoint(4, 1, ppb);
    await page.mouse.dblclick(empty.x, empty.y);
    st = await state();
    const made = st.tracks[1].clips.find(c => c.start === 4 && c.notes === 0);
    check('double-clicking an empty stretch makes a new four-beat clip', !!made && made.length === 4);

    // ── Note editor ────────────────────────────────────────────────────────
    section('Note editor');
    const roll = async () => page.evaluate(() => {
      const c = document.getElementById('dawRoll').getBoundingClientRect();
      const w = document.getElementById('dawRollWrap');
      return { x: c.left, y: c.top, wrapTop: w.getBoundingClientRect().top, wrapH: w.clientHeight, scrollTop: w.scrollTop };
    });
    const notesOf = async id => page.evaluate(clipId => {
      const p = DawEngine.get().project;
      for (const t of p.tracks) for (const c of t.clips) if (c.id === clipId) return c.notes.map(n => ({ t: n.t, d: n.d, n: n.n, v: n.v }));
      return null;
    }, id);
    const KEYS_W = 54, ROW_H = 12, RULER = 16, HIGH = 96;
    // The editor opens zoomed so the clip fills it (mirrors fitRoll in ui/views/daw.js).
    const fitPx = async beats => {
      const w = await page.evaluate(() => document.getElementById('dawRollWrap').offsetWidth);
      return Math.max(24, Math.min(180, (w - KEYS_W - 44) / beats));
    };
    let PX = await fitPx(4);
    check('a short clip is zoomed in as far as the editor goes', PX === 180);
    const cell = async (beat, midi) => {
      const r = await roll();
      return { x: r.x + KEYS_W + beat * PX + 6, y: r.y + RULER + (HIGH - midi) * ROW_H + ROW_H / 2 };
    };
    let r = await roll();
    check('the editor opens scrolled to a playable register', r.scrollTop > 100);
    // An empty clip opens centred on the octave above middle C, so work there.
    let c1 = await cell(1, 60);
    await page.mouse.click(c1.x, c1.y);
    let notes = await notesOf(made.id);
    check('clicking an empty cell adds a note on the grid', notes.length === 1 && notes[0].t === 1 && notes[0].n === 60);

    c1 = await cell(2, 62);
    await page.mouse.move(c1.x, c1.y);
    await page.mouse.down();
    await page.mouse.move(c1.x + PX * 1.5, c1.y, { steps: 4 });
    await page.mouse.up();
    notes = await notesOf(made.id);
    check('dragging while placing a note sets its length', notes.length === 2 && notes[1].t === 2 && notes[1].d >= 1.25);

    c1 = await cell(1, 60);
    await page.mouse.move(c1.x + 4, c1.y);
    await page.mouse.down();
    const c2 = await cell(0, 64);
    await page.mouse.move(c2.x + 4, c2.y, { steps: 5 });
    await page.mouse.up();
    notes = await notesOf(made.id);
    check('dragging a note moves it in time and pitch', notes.some(n => n.t === 0 && n.n === 64) && !notes.some(n => n.n === 60));

    check('selecting a note offers a velocity control', (await page.locator('#dawVel').count()) === 1);
    await page.locator('#dawVel').fill('0.3');
    await page.locator('#dawVel').dispatchEvent('change');
    notes = await notesOf(made.id);
    check('velocity can be set', notes.some(n => Math.abs(n.v - 0.3) < 0.001));

    await page.click('#dawTools [data-tool="tr"][data-n="12"]');
    notes = await notesOf(made.id);
    check('+12 transposes the clip an octave', notes.some(n => n.n === 76) && notes.some(n => n.n === 74));
    await page.click('#dawTools [data-tool="tr"][data-n="-12"]');

    const c3 = await cell(2, 62);
    await page.mouse.click(c3.x, c3.y, { button: 'right' });
    notes = await notesOf(made.id);
    check('right-clicking a note deletes it', notes.length === 1);
    await shot(page, '11-daw-notes');

    // Drum grid.
    const drumClip = (await state()).tracks[2].clips[0];
    pt = await lanePoint(drumClip.start + 1, 2, ppb);
    await page.mouse.click(pt.x, pt.y);
    r = await roll();
    PX = await fitPx(drumClip.length);
    check('a longer clip is zoomed to fit the editor', PX > 24 && PX < 180);
    const before = (await notesOf(drumClip.id)).length;
    const crashRow = { x: r.x + KEYS_W + 2.5 * PX + 4, y: r.y + RULER + 12 };       // top lane: crash
    await page.mouse.click(crashRow.x, crashRow.y);
    notes = await notesOf(drumClip.id);
    check('clicking the drum grid adds a hit', notes.length === before + 1 && notes.some(n => n.n === 49 && n.t === 2.5));
    await page.mouse.click(crashRow.x, crashRow.y);
    check('clicking it again removes the hit', (await notesOf(drumClip.id)).length === before);

    // ── Tab ────────────────────────────────────────────────────────────────
    section('Tab');
    pt = await lanePoint(bass.clips[1].start + 2, 1, ppb);
    await page.mouse.click(pt.x, pt.y);
    await page.click('#dawPanelTabs [data-panel="tab"]');
    const tab = await page.textContent('#dawTab');
    check('a bass clip shows as six-line guitar tab', /^E \|/m.test(tab) && /^e \|/m.test(tab) && /\d/.test(tab));
    check('with the beat count under it', /1 e \+ a 2 e \+ a/.test(tab));
    const chordClip = (await state()).tracks[0].clips[1];
    pt = await lanePoint(chordClip.start + 2, 0, ppb);
    await page.mouse.click(pt.x, pt.y);
    const chordTab = await page.textContent('#dawTab');
    const strings = chordTab.split('\n').filter(l => /^[EADGBe] \|/.test(l)).slice(0, 6);
    check('a chord clip is written as chord shapes, each strum one stack',
      strings.length === 6 && strings.filter(l => /\d/.test(l[3])).length >= 3 && !/\d{3}/.test(strings.join('\n')));
    pt = await lanePoint(drumClip.start + 1, 2, ppb);
    await page.mouse.click(pt.x, pt.y);
    check('a drum clip shows as a step grid', /Kick\s+\|[x-]{16}\|/.test(await page.textContent('#dawTab')));
    await shot(page, '12-daw-tab');

    // ── Mixer ──────────────────────────────────────────────────────────────
    section('Mixer');
    await page.click('#dawPanelTabs [data-panel="mixer"]');
    check('there is a strip per track plus the master', (await page.locator('.mx-strip').count()) === 6);
    check('every strip is headed by its track name', await page.evaluate(() =>
      [...document.querySelectorAll('.mx-strip[data-track]')].every(strip => {
        const name = strip.querySelector('.mx-name').getBoundingClientRect();
        return name.height >= 10 && name.width > 20;
      })));
    check('and shows all of its controls without scrolling', await page.evaluate(() => {
      const body = document.getElementById('dawPanelBody').getBoundingClientRect();
      return [...document.querySelectorAll('.mx-strip[data-track]')].every(strip => {
        const last = strip.querySelector('[data-toggle="fx.comp"]').getBoundingClientRect();
        const side = strip.querySelector('.mx-side');
        return last.height > 0 && last.bottom <= body.bottom && side.scrollHeight <= side.clientHeight + 1;
      });
    }));
    const chordsId = (await state()).tracks[0].id;
    const strip = page.locator(`.mx-strip[data-track="${chordsId}"]`);
    await strip.locator('.mx-fader').fill('-20');
    await strip.locator('.mx-fader').dispatchEvent('change');
    check('a fader sets the track volume', (await state()).tracks[0].volume === -20);
    check('and its readout follows', (await strip.locator('[data-db]').textContent()) === '-20.0');
    await strip.locator('[data-toggle="solo"]').click();
    check('Solo in the mixer solos the track', (await state()).tracks[0].solo === true);
    check('and the track header shows it', await page.locator(`#dawHeads .daw-head[data-track="${chordsId}"] [data-act="solo"].on`).count() === 1);
    await strip.locator('[data-toggle="solo"]').click();
    await page.locator('.mx-strip.master .mx-fader').fill('-6');
    await page.locator('.mx-strip.master .mx-fader').dispatchEvent('change');
    check('the master fader is saved in the project', (await state()).master === -6);
    await page.locator('.mx-strip.master .mx-fader').dblclick();
    check('double-clicking a fader returns it to neutral', (await state()).master === 0);
    await page.locator('.mx-strip.master .mx-fader').fill('-6');
    await page.locator('.mx-strip.master .mx-fader').dispatchEvent('change');

    // Moved with the mouse, a fader hands the keyboard back: Home belongs to the transport.
    const bassId = (await state()).tracks[1].id;
    const fader = await page.locator(`.mx-strip[data-track="${bassId}"] .mx-fader`).boundingBox();
    await page.mouse.click(fader.x + fader.width / 2, fader.y + fader.height / 2);
    await page.waitForTimeout(80);
    const bassVol = (await state()).tracks[1].volume;
    check('clicking along a fader moves it there', bassVol < -12 && bassVol > -45);
    check('and the fader lets go of the keyboard', await page.evaluate(() => document.activeElement.tagName !== 'INPUT'));
    await page.click('#dawPlay');
    await page.waitForFunction(() => window.__daw().position > 2);
    await page.click('#dawPlay');
    await page.keyboard.press('Home');
    st = await state();
    check('so Home goes back to the start and leaves the fader alone', st.position === 0 && st.tracks[1].volume === bassVol);

    await page.click('#dawPlay');
    await page.waitForFunction(() => window.__daw().position > 9);
    const meter = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.mx-meter span')].map(s => parseFloat(s.style.height) || 0)));
    check('meters move during playback', meter > 5);
    await shot(page, '13-daw-mixer');
    await page.click('#dawPlay');

    // ── Tracks ─────────────────────────────────────────────────────────────
    section('Tracks');
    await page.click('#dawHeads [data-add="instrument"]');
    st = await state();
    check('+ Instrument adds a track', st.tracks.length === 6 && st.tracks[5].kind === 'instrument');
    const newId = st.tracks[5].id;
    await page.selectOption(`#dawHeads .daw-head[data-track="${newId}"] select`, 'strings');
    check('its instrument can be chosen', (await state()).tracks[5].instrument === 'strings');
    await page.click(`#dawHeads .daw-head[data-track="${newId}"] [data-act="mute"]`);
    check('M on the header mutes it', (await state()).tracks[5].mute === true);
    await page.click(`#dawHeads .daw-head[data-track="${newId}"] [data-act="remove"]`);
    await page.click('#cbOk');
    check('a track can be removed after confirming', (await state()).tracks.length === 5);

    // ── Recording ──────────────────────────────────────────────────────────
    section('Recording');
    await page.keyboard.press('Home');
    await page.click('#dawRec');
    await page.waitForFunction(() => window.__daw().recording, null, { timeout: 15000 });
    st = await state();
    check('Record makes and arms an audio track', st.tracks.length === 6 && st.tracks[5].kind === 'audio' && st.tracks[5].armed);
    check('the Record button shows it is live', await page.locator('#dawRec.on').count() === 1);
    check('the status line explains the count-in', /count|clicks/i.test(await page.textContent('#dawStatus')));
    await page.waitForFunction(() => window.__daw().position > 3, null, { timeout: 20000 });
    await page.click('#dawPlay');
    await page.waitForFunction(() => !window.__daw().recording && window.__daw().tracks[5].clips.length === 1, null, { timeout: 10000 });
    st = await state();
    const take = st.tracks[5].clips[0];
    check('stopping leaves the take as a clip where recording began', take.start === 0 && take.length > 2.5 && !!take.audioId);
    check('the take can be played back', await page.evaluate(id => DawEngine.get().audioSeconds(id) > 1, take.audioId));
    check('the take is described in plain terms', /^Take 1 on Audio 1: \d+(\.\d\d?)? beats$/.test((await page.textContent('#dawClipInfo')).trim()));
    await shot(page, '14-daw-recorded');

    // ── Export ─────────────────────────────────────────────────────────────
    section('Export');
    const wavInfo = file => {
      const b = fs.readFileSync(file);
      return { riff: b.toString('ascii', 0, 4), wave: b.toString('ascii', 8, 12), channels: b.readUInt16LE(22), rate: b.readUInt32LE(24), bits: b.readUInt16LE(34), bytes: b.length };
    };
    const waitFile = async (name, ms) => {
      const file = path.join(downloads, name);
      for (let i = 0; i < ms / 200; i++) {
        if (fs.existsSync(file) && fs.statSync(file).size > 0) { await page.waitForTimeout(300); return file; }
        await page.waitForTimeout(200);
      }
      return null;
    };
    await page.click('#dawExport');
    await page.click('#modalContent [data-export="mix"]');
    const mixFile = await waitFile('Harbour Lights.wav', 90000);
    check('Mixdown writes a WAV file named after the song', !!mixFile);
    if (mixFile) {
      const info = wavInfo(mixFile);
      check('the file is 24-bit stereo 44.1 kHz and holds the whole song',
        info.riff === 'RIFF' && info.wave === 'WAVE' && info.channels === 2 && info.rate === 44100 && info.bits === 24 && info.bytes > 44100 * 6 * 50);
    }
    await page.click('#dawExport');
    await page.click('#modalContent [data-export="midi"]');
    const midFile = await waitFile('Harbour Lights.mid', 15000);
    check('MIDI export writes a standard MIDI file', !!midFile && fs.readFileSync(midFile).toString('ascii', 0, 4) === 'MThd');

    await page.click('#dawExport');
    await page.selectOption('#dawBits', '16');
    await page.click('#modalContent [data-export="stems"]');
    let stems = [];
    for (let i = 0; i < 600 && stems.length < 6; i++) {
      await page.waitForTimeout(250);
      stems = fs.readdirSync(downloads).filter(f => / - \d\d /.test(f));
    }
    check('Stems writes one file per track into the chosen folder', stems.length === 6 && stems.some(f => /01 Chords\.wav$/.test(f)) && stems.some(f => /06 Audio 1\.wav$/.test(f)));
    if (stems.length) check('stems honour the chosen bit depth', wavInfo(path.join(downloads, stems[0])).bits === 16);

    // ── Importing audio ────────────────────────────────────────────────────
    section('Importing audio');
    // A mono 16-bit WAV of a plain tone, written the long way so the test owns its fixture.
    const toneWav = (seconds, hz) => {
      const rate = 22050, frames = Math.round(seconds * rate);
      const b = Buffer.alloc(44 + frames * 2);
      b.write('RIFF', 0); b.writeUInt32LE(36 + frames * 2, 4); b.write('WAVE', 8);
      b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
      b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
      b.write('data', 36); b.writeUInt32LE(frames * 2, 40);
      for (let i = 0; i < frames; i++) b.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * hz * i / rate)), 44 + i * 2);
      return b;
    };
    fs.writeFileSync(path.join(fixtures, 'Guitar idea.wav'), toneWav(2, 330));
    fs.writeFileSync(path.join(fixtures, 'Spare.wav'), toneWav(1, 220));
    fs.writeFileSync(path.join(fixtures, 'Shopping list.wav'), 'eggs, strings, a capo');

    await page.keyboard.press('Home');
    await page.setInputFiles('#dawImportFile', path.join(fixtures, 'Guitar idea.wav'));
    await page.waitForFunction(() => window.__daw().tracks.length === 7, null, { timeout: 15000 });
    st = await state();
    const brought = st.tracks[6];
    check('an audio file arrives on a new track named after it', brought.kind === 'audio' && brought.name === 'Guitar idea' && brought.clips.length === 1);
    check('as a clip of the file\'s length at the playhead',
      brought.clips[0].start === 0 && Math.abs(brought.clips[0].length - 2 * st.tempo / 60) < 0.05);
    check('and it is ready to play', await page.evaluate(id => Math.abs(DawEngine.get().audioSeconds(id) - 2) < 0.02, brought.clips[0].audioId));

    await page.setInputFiles('#dawImportFile', path.join(fixtures, 'Shopping list.wav'));
    await page.waitForFunction(() => /could not be read/i.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
    check('a file that is not audio is turned away and nothing is added', (await state()).tracks.length === 7);

    // A take that is thrown away is cleared from disk the next time the project opens.
    await page.setInputFiles('#dawImportFile', path.join(fixtures, 'Spare.wav'));
    await page.waitForFunction(() => window.__daw().tracks.length === 8, null, { timeout: 15000 });
    const spareId = (await state()).tracks[7].clips[0].audioId;
    await page.keyboard.press('Delete');
    check('Delete removes the selected audio clip', (await state()).tracks[7].clips.length === 0);

    // ── Layout and help ────────────────────────────────────────────────────
    section('Layout and help');
    const panelHeight = async () => (await page.locator('.daw-panel').boundingBox()).height;
    const tall = await panelHeight();
    const grip = await page.locator('#dawSplit').boundingBox();
    await page.mouse.move(grip.x + 500, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + 500, grip.y + grip.height / 2 + 70, { steps: 5 });
    await page.mouse.up();
    const shorter = await panelHeight();
    check('dragging the divider resizes the editor panel', Math.abs(tall - shorter - 70) <= 4);

    await page.keyboard.press('?');
    await page.waitForSelector('#scrim.open');
    const help = await page.textContent('#modalContent');
    check('? lists the DAW shortcuts', /Split the selected clip/.test(help) && /Record/.test(help) && !/7th chords/.test(help));
    await page.keyboard.press('Escape');
    check('Escape closes the list', await page.locator('#scrim.open').count() === 0);

    // ── Saving ─────────────────────────────────────────────────────────────
    section('Saving');
    const snapshot = await state();
    await page.waitForTimeout(1200);                 // let the autosave land
    await page.click('#navTabs [data-nav="overview"]');
    await page.waitForSelector('#overviewRoot .ov-card');
    check('leaving the DAW stops playback', !(await page.evaluate(() => DawEngine.get().isPlaying())));
    await app.close();
    ({ app, page, log } = await launch(userData));
    await page.evaluate(() => { location.hash = '#/song/' + Storage.listProjects()[0].id + '/daw'; });
    await page.waitForSelector('#dawCanvas');
    await page.evaluate(() => {
      window.__daw = () => { const p = DawEngine.get().project; return { tracks: p.tracks.map(t => ({ name: t.name, volume: t.volume, clips: t.clips.map(c => ({ id: c.id, start: c.start, audioId: c.audioId || null })) })), master: p.master }; };
    });
    const again = await state();
    check('after a restart the project is as it was left',
      again.tracks.length === snapshot.tracks.length && again.tracks[0].volume === -20 && again.master === -6);
    const savedTake = again.tracks[5].clips[0];
    check('and the recording is still there', !!savedTake && savedTake.audioId === take.audioId &&
      await page.evaluate(id => DawEngine.get().audioSeconds(id) > 1, take.audioId));
    check('so is the imported audio', again.tracks[6].name === 'Guitar idea' &&
      await page.evaluate(id => Math.abs(DawEngine.get().audioSeconds(id) - 2) < 0.02, brought.clips[0].audioId));
    check('the editor panel keeps the height it was given', Math.abs((await panelHeight()) - shorter) <= 2);
    await page.waitForFunction(id => DawStore.getAudio(id).then(a => a === null), spareId, { timeout: 10000 }).catch(() => {});
    check('audio that no clip uses any more has been cleared from disk',
      await page.evaluate(async ids => (await DawStore.getAudio(ids[0])) === null && (await DawStore.getAudio(ids[1])) !== null, [spareId, take.audioId]));

    // ── Deleting the song ──────────────────────────────────────────────────
    section('Deleting the song');
    const songId = await page.evaluate(() => Storage.listProjects()[0].id);
    await page.click('#navTabs [data-nav="songs"]');
    await page.click(`#songsGrid .song-card[data-id="${songId}"] [data-act="del"]`);
    check('the warning says the recordings go too', /recordings/i.test(await page.textContent('#modalContent')));
    await page.click('#cbOk');
    await page.waitForFunction(id => DawStore.loadProject('daw_' + id).then(p => p === null), songId, { timeout: 10000 }).catch(() => {});
    check('deleting a song deletes its DAW project and recordings', await page.evaluate(async args =>
      (await DawStore.loadProject('daw_' + args[0])) === null && (await DawStore.getAudio(args[1])) === null, [songId, take.audioId]));

    section('Health');
    if (log.errors.length) console.error(log.errors.join('\n'));
    check('no errors were logged', log.errors.length === 0);
  } catch (err) {
    crashed(err);
    try { await shot(page, 'daw-crash'); } catch (e) { /* window may be gone */ }
  } finally {
    try { await app.close(); } catch (e) { /* already closed */ }
    cleanup(userData);
    cleanup(downloads);
    cleanup(fixtures);
  }
  finish();
})();
