/* ChordPath — the DAW with its audio engine, driven like a user: a sound
 * card chosen on screen, the song played through it, and plugins on the
 * mixer strips with their windows.
 *
 * Uses the stand-in ASIO driver that is part of the audio host
 * (CHORDPATH_TEST_AUDIO=1), so no sound card is needed and nothing is heard;
 * in tests plugin windows open hidden. The plugin checks use TDR Nova where it
 * is installed and are skipped where it is not. The whole suite is skipped
 * when the audio host has not been built (npm run build:native).
 * Run with: node tests/e2e-host.js   (or npm run test:e2e)
 */
'use strict';

const { check, section, tempDataDir, launch, shot, crashed, finish, cleanup } = require('./e2e-helpers');

const DRIVER = 'ChordPath test driver';

(async () => {
  const userData = tempDataDir();
  let { app, page, log } = await launch(userData, { CHORDPATH_TEST_AUDIO: '1' });

  const project = () => page.evaluate(() => JSON.parse(JSON.stringify(DawEngine.get().project)));
  const native = () => page.evaluate(() => DawEngine.get().usingNative());
  const pluginState = id => page.evaluate(pid => DawEngine.get().pluginInfo(pid), id);
  const settings = () => page.evaluate(() => Storage.getSettings().dawAudio || null);
  const fitsStrips = () => page.evaluate(() => {
    const body = document.getElementById('dawPanelBody').getBoundingClientRect();
    return [...document.querySelectorAll('.mx-strip[data-track]')].every(strip => {
      const last = strip.querySelector('[data-toggle="fx.comp"]').getBoundingClientRect();
      const side = strip.querySelector('.mx-side');
      return last.height > 0 && last.bottom <= body.bottom && side.scrollHeight <= side.clientHeight + 1;
    });
  });

  try {
    const built = await page.evaluate(() => window.Desktop.audio.info().then(i => !!i.available));
    if (!built) {
      console.log('  (skipped: the audio host is not built here — npm run build:native)');
      return;
    }

    await page.evaluate(() => {
      const song = Feelings.generateSongSpec({ feelingId: 'yearning', genreId: 'jangle_indie', energy: 'mid', seed: 11 });
      song.title = 'Night Ferry';
      Storage.saveProject(song);
      location.hash = '#/song/' + song.id + '/daw';
    });
    await page.waitForSelector('#dawCanvas');

    // ── Choosing a sound card ──────────────────────────────────────────────
    section('Audio settings');
    check('the toolbar has an Audio button, and still sits on one row',
      (await page.locator('#dawAudio').count()) === 1 && (await page.locator('.daw-bar').boundingBox()).height < 56);
    check('the DAW plays through this computer until told otherwise', !(await native()) && !(await page.locator('#dawAudio.on').count()));
    await page.click('#dawAudio');
    await page.waitForSelector('#audSettings');
    check('the dialog starts on this computer\'s sound', await page.isChecked('#audModeBuiltIn'));
    check('and the card\'s settings wait until a card is chosen', await page.isDisabled('#audApi'));
    await page.check('#audModeCard');
    await page.selectOption('#audApi', 'asio');
    await page.waitForFunction(d => [...document.querySelectorAll('#audDevice option')].some(o => o.value === d), DRIVER, { timeout: 15000 });
    check('the ASIO drivers on this computer are listed, the stand-in among them', true);
    await page.selectOption('#audDevice', DRIVER);
    await page.waitForFunction(() => [...document.querySelectorAll('#audBuffer option')].some(o => o.value === '256'), null, { timeout: 15000 });
    check('the driver\'s buffer sizes are offered', (await page.$$eval('#audBuffer option', os => os.map(o => o.value))).includes('256'));
    await page.selectOption('#audBuffer', '256');
    await page.click('#audApply');
    await page.waitForFunction(() => DawEngine.get().usingNative(), null, { timeout: 20000 });
    await page.waitForFunction(() => /test driver/.test(document.getElementById('audState').textContent), null, { timeout: 5000 });
    const said = (await page.textContent('#audState')).replace(/\s+/g, ' ');
    check(`it says what is playing and how (${said.trim()})`, /ChordPath test driver/.test(said) && /256/.test(said) && /kHz/.test(said));
    const kept = await settings();
    check('the choice is remembered', !!kept && kept.mode === 'card' && kept.api === 'asio' && kept.device === DRIVER && kept.bufferFrames === 256);
    check('with the card open, the driver\'s own settings window can be reached from here', await page.isVisible('#audPanel'));
    await shot(page, '30-audio-settings');
    await page.click('#audClose');
    check('the Audio button shows a card is in use', (await page.locator('#dawAudio.on').count()) === 1 &&
      /test driver/.test(await page.getAttribute('#dawAudio', 'title')));

    // ── Playing through it ─────────────────────────────────────────────────
    section('Playing through the card');
    await page.click('#dawPlay');
    await page.waitForFunction(() => { const s = NativeAudio.status(); return !!s && s.blocks > 20; }, null, { timeout: 15000 });
    check('the song streams to the card', true);
    await page.waitForFunction(() => DawEngine.get().position() > 2, null, { timeout: 10000 });
    check('and the playhead moves with it', true);
    await page.click('#dawPlay');

    // ── Plugins on the strips ──────────────────────────────────────────────
    section('Plugins');
    await page.click('#dawPanelTabs [data-panel="mixer"]');
    check('every strip, and the master, has a Plugins button', (await page.locator('.mx-strip [data-act="plugins"]').count()) === 6);
    check('and every strip still shows all of its controls without scrolling', await fitsStrips());
    const chordsId = (await project()).tracks[0].id;
    const strip = page.locator(`.mx-strip[data-track="${chordsId}"]`);
    await strip.locator('[data-act="plugins"]').click();
    await page.waitForSelector('#plugDialog');
    check('the dialog names the strip', /Chords/.test(await page.textContent('#plugDialog h2')));
    check('and says the chain is empty', /No plugins/.test(await page.textContent('#plugChain')));
    await page.waitForFunction(() => !document.querySelector('#plugAvail .plug-scanning'), null, { timeout: 60000 });
    const avail = await page.$$eval('#plugAvail .plug-avail', rows => rows.map(r => r.dataset.name));
    check(`the plugins installed here are listed (${avail.length})`, avail.length > 0 || /No plugins were found/.test(await page.textContent('#plugAvail')));
    const hasNova = avail.includes('TDR Nova');
    if (!hasNova) {
      console.log('  (skipped: TDR Nova is not installed, so no plugin is loaded)');
    } else {
      await page.fill('#plugSearch', 'nova');
      check('the list can be searched', (await page.locator('#plugAvail .plug-avail:visible').count()) >= 1 &&
        (await page.$$eval('#plugAvail .plug-avail', rows => rows.filter(r => r.offsetParent).every(r => /nova/i.test(r.dataset.name)))));
      await page.click('#plugAvail .plug-avail[data-name="TDR Nova"] [data-act="add"]');
      let track = (await project()).tracks[0];
      check('adding one puts it on the track', track.plugins.length === 1 && track.plugins[0].name === 'TDR Nova');
      const novaId = track.plugins[0].id;
      await page.waitForFunction(pid => DawEngine.get().pluginInfo(pid).state === 'ready', novaId, { timeout: 30000 });
      check('the audio engine loads it', (await pluginState(novaId)).state === 'ready');
      await page.waitForFunction(() => !/loading/i.test(document.getElementById('plugChain').textContent), null, { timeout: 5000 });
      check('the chain shows it, ready', /TDR Nova/.test(await page.textContent('#plugChain')));
      await shot(page, '31-plugins');

      await page.click(`#plugChain [data-plugin="${novaId}"] [data-act="window"]`);
      await page.waitForFunction(pid => DawEngine.get().pluginInfo(pid).editorOpen === true, novaId, { timeout: 10000 });
      check('its window opens', true);
      check('and the button offers to close it', /Close/.test(await page.textContent(`#plugChain [data-plugin="${novaId}"] [data-act="window"]`)));
      await page.click(`#plugChain [data-plugin="${novaId}"] [data-act="window"]`);
      await page.waitForFunction(pid => DawEngine.get().pluginInfo(pid).editorOpen === false, novaId, { timeout: 10000 });
      check('and closes', true);

      await page.click(`#plugChain [data-plugin="${novaId}"] [data-act="bypass"]`);
      track = (await project()).tracks[0];
      check('it can be bypassed', track.plugins[0].bypass === true &&
        (await page.locator(`#plugChain [data-plugin="${novaId}"] [data-act="bypass"].on`).count()) === 1);
      await page.click(`#plugChain [data-plugin="${novaId}"] [data-act="bypass"]`);
      check('and switched back on', (await project()).tracks[0].plugins[0].bypass === false);

      await page.click('#plugClose');
      check('the strip shows it has a plugin', /1/.test(await strip.locator('[data-act="plugins"]').textContent()) &&
        (await strip.locator('[data-act="plugins"].on').count()) === 1 &&
        /TDR Nova/.test(await strip.locator('[data-act="plugins"]').getAttribute('title')));
      check('and still shows all of its controls without scrolling', await fitsStrips());

      // Three edits: added, bypassed, switched back on.
      await page.click('#dawUndo');
      check('Undo takes back the last of them first', (await project()).tracks[0].plugins[0].bypass === true);
      await page.click('#dawUndo');
      await page.click('#dawUndo');
      check('and then the plugin itself', (await project()).tracks[0].plugins.length === 0);
      await page.click('#dawRedo');
      await page.click('#dawRedo');
      await page.click('#dawRedo');
      check('Redo puts it all back', (await project()).tracks[0].plugins.length === 1 && (await project()).tracks[0].plugins[0].id === novaId &&
        (await project()).tracks[0].plugins[0].bypass === false);

      await page.click('.mx-strip.master [data-act="plugins"]');
      await page.waitForSelector('#plugDialog');
      check('the master has a chain of its own', /Master/.test(await page.textContent('#plugDialog h2')));
      await page.waitForFunction(() => !document.querySelector('#plugAvail .plug-scanning'), null, { timeout: 60000 });
      await page.click('#plugAvail .plug-avail[data-name="TDR Nova"] [data-act="add"]');
      check('a plugin can go on the master', (await project()).masterPlugins.length === 1);
      const masterId = (await project()).masterPlugins[0].id;
      await page.click(`#plugChain [data-plugin="${masterId}"] [data-act="remove"]`);
      check('and come off it', (await project()).masterPlugins.length === 0);
      await page.click('#plugClose');

      await page.click('#dawPlay');
      await page.waitForFunction(() => DawEngine.get().position() > 1, null, { timeout: 10000 });
      check('the song plays with the plugin in the chain', (await pluginState(novaId)).state === 'ready');
      await page.click('#dawPlay');

      // Automating one of its settings.
      const head = page.locator('#dawHeads .daw-head').nth(0);
      await head.locator('[data-act="auto"]').click();
      await head.locator('[data-act="laneAdd"][data-target="param"]').click();
      await page.waitForSelector('#lanePick [data-g]', { timeout: 15000 });
      check(`+ Plugin… lists the settings of the plugins on the track (${await page.locator('#lanePick [data-g]').count()})`,
        await page.locator('#lanePick [data-g]').count() > 10);
      await page.fill('#lpFind', 'output gain');
      check('and they can be searched', await page.locator('#lanePick [data-g]').count() >= 1 && /Output Gain/.test(await page.textContent('#lpList')));
      await page.locator('#lanePick [data-g]').first().click();
      const lane = (await project()).tracks[0].auto[0];
      check('choosing one makes a lane for it, named after it, starting where the setting is',
        !!lane && lane.target === 'param' && lane.plugin === novaId && /Output Gain/.test(lane.name) && lane.points.length === 1 && Math.abs(lane.points[0].v - 0.5) < 1e-6);
      const moved = await page.evaluate(async () => {
        const eng = DawEngine.get();
        const p = JSON.parse(JSON.stringify(eng.project));
        const l = p.tracks[0].auto[0];
        l.points = [{ b: 0, v: 0.5 }, { b: 8, v: 0.5 }, { b: 8.05, v: 0 }];      // from 0 dB down to -20 at bar 3
        const only = { onlyTrackId: p.tracks[0].id, tail: 0 };
        // Without the lane first: a plugin keeps whatever setting automation last gave it.
        l.on = false;
        const off = await DawEngine.render(p, eng.audio, only);
        l.on = true;
        const on = await DawEngine.render(p, eng.audio, only);
        const t = b => DawProject.beatToSeconds(p, b);
        const rms = (out, a, b) => {
          const d = out.channels[0], sr = out.sampleRate;
          let s = 0, n = 0;
          for (let i = Math.floor(a * sr); i < Math.min(d.length, Math.floor(b * sr)); i++, n++) s += d[i] * d[i];
          return Math.sqrt(s / Math.max(1, n));
        };
        const db = (x, y) => 20 * Math.log10(x / y);
        // The fader too: a volume lane stepping down 12 dB at the same place, the setting left alone.
        l.on = false;
        const fader = DawProject.addLane(p, p.tracks[0].id, { target: 'volume', value: p.tracks[0].volume });
        DawProject.setPoint(fader, 8, p.tracks[0].volume);
        DawProject.setPoint(fader, 8.05, p.tracks[0].volume - 12);
        const ridden = await DawEngine.render(p, eng.audio, only);
        const again = await DawEngine.render(Object.assign(p, { tracks: p.tracks.map((tr, i) => (i ? tr : Object.assign({}, tr, { auto: [] }))) }), eng.audio, only);
        return {
          early: db(rms(on, t(1), t(7.5)), rms(off, t(1), t(7.5))), late: db(rms(on, t(9), t(16)), rms(off, t(9), t(16))),
          faderEarly: db(rms(ridden, t(1), t(7.5)), rms(again, t(1), t(7.5))), faderLate: db(rms(ridden, t(9), t(16)), rms(again, t(9), t(16))),
        };
      });
      check(`in a mixdown through the audio engine the setting follows its lane (${moved.early.toFixed(1)} dB, then ${moved.late.toFixed(1)} dB)`,
        Math.abs(moved.early) < 0.5 && Math.abs(moved.late + 20) < 1.5);
    check(`and so does a volume lane, the audio engine moving the fader (${moved.faderEarly.toFixed(1)} dB, then ${moved.faderLate.toFixed(1)} dB)`,
      Math.abs(moved.faderEarly) < 0.3 && Math.abs(moved.faderLate + 12) < 0.5);
      await page.click('#dawPlay');
      await page.waitForFunction(() => DawEngine.get().position() > 1, null, { timeout: 10000 });
      check('and the song plays with it', true);
      await page.click('#dawPlay');
      await head.locator('[data-act="laneRemove"]').click();
      await head.locator('[data-act="auto"]').click();
    }

    // ── Back to this computer ──────────────────────────────────────────────
    // ── Recording through it ───────────────────────────────────────────────
    // The stand-in driver hands back as its input whatever it was given to play.
    // In tests the host plays silence; the stand-in reaches no speaker, so here
    // it is let play the song, to have something to record.
    section('Recording through the card');
    await page.evaluate(async () => {
      const eng = DawEngine.get();
      await eng.useNative(Object.assign({}, eng.nativeConfig, { muted: false }));
    });
    await page.keyboard.press('Home');
    await page.click('#dawRec');
    await page.waitForFunction(() => DawEngine.get().isRecording(), null, { timeout: 15000 });
    await page.waitForFunction(() => DawEngine.get().position() > 4, null, { timeout: 20000 });
    await page.click('#dawPlay');
    const audioClip = () => page.evaluate(() => {
      const eng = DawEngine.get();
      const track = eng.project.tracks.find(t => t.kind === 'audio');
      const clip = track && track.clips[0];
      return clip ? { start: clip.start, length: clip.length, seconds: eng.audioSeconds(clip.audioId), peak: eng.peakBetween(clip.audioId, 0, 60) } : null;
    });
    await page.waitForFunction(() => !DawEngine.get().isRecording() && DawEngine.get().project.tracks.some(t => t.kind === 'audio' && t.clips.length), null, { timeout: 15000 }).catch(() => {});
    const viaCard = await audioClip();
    check('Stop ends a take recorded through the card, and keeps it', !(await page.evaluate(() => DawEngine.get().isRecording())) &&
      !!viaCard && viaCard.start === 0 && viaCard.length > 3 && viaCard.seconds > 1);
    check(`what came in is what the card was playing (${viaCard ? viaCard.peak.toFixed(2) : '-'} at its loudest)`, !!viaCard && viaCard.peak > 0.01);

    section('Back to this computer');
    await page.click('#dawAudio');
    await page.waitForSelector('#audSettings');
    await page.waitForFunction(d => document.getElementById('audDevice').value === d, DRIVER, { timeout: 15000 }).catch(() => {});
    check('the dialog shows the card in use', await page.isChecked('#audModeCard') && (await page.inputValue('#audDevice')) === DRIVER);
    await page.check('#audModeBuiltIn');
    await page.click('#audApply');
    await page.waitForFunction(() => !DawEngine.get().usingNative(), null, { timeout: 10000 });
    check('choosing this computer again puts the built-in engine back', !(await native()));
    await page.waitForFunction(() => /this computer/.test(document.getElementById('audState').textContent), null, { timeout: 10000 }).catch(() => {});
    check('and that is remembered too', ((await settings()) || {}).mode === 'builtin');
    await page.click('#audClose');
    check('the Audio button shows no card', (await page.locator('#dawAudio.on').count()) === 0);
    await strip.locator('[data-act="plugins"]').click();
    await page.waitForSelector('#plugDialog');
    check('the plugins dialog says plugins are heard only through a card', await page.isVisible('#plugOff'));
    if (hasNova) {
      check('and a plugin\'s window cannot be opened without one', await page.isDisabled('#plugChain [data-act="window"]'));
    }
    await page.click('#plugClose');
    await page.click('#dawPlay');
    await page.waitForFunction(() => DawEngine.get().position() > 1, null, { timeout: 10000 });
    check('the song still plays', true);
    await page.click('#dawPlay');

    section('Health');
    if (log.errors.length) console.error(log.errors.join('\n'));
    check('no errors were logged', log.errors.length === 0);
  } catch (err) {
    crashed(err);
    try { await shot(page, 'host-crash'); } catch (e) { /* window may be gone */ }
  } finally {
    try { await app.close(); } catch (e) { /* already closed */ }
    cleanup(userData);
  }
  finish();
})();
