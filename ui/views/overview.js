/* ChordPath — ui/views/overview.js
 * Song overview: title/key/time/tempo header, progress pipeline, section
 * timeline (per-section time, bars, patterns and feeling; reorder, add an
 * empty section, remove), snapshots, and exports. Nothing here writes chords
 * or patterns for the writer.
 */
(function (global) {
  'use strict';

  const doc = global.document;
  const UI = () => global.UI;
  const F = () => global.Feelings;
  const R = () => global.Arrangements;
  const Song = () => global.Song;
  const Mt = () => global.Meters;
  const I = () => global.Ideas;
  const St = () => global.Storage;
  const App = () => global.App;

  function root() { return doc.getElementById('overviewRoot'); }
  function song() { return App().state.song; }

  let playingSectionId = null;

  function glyph(name) { return String(name).replace('#', '♯').replace(/^([A-G])b/, '$1♭'); }
  function feelingName(id) { const f = id && id !== 'none' ? F().getFeeling(id) : null; return f ? f.name : 'No feeling'; }

  // What a section really plays, by name (as the section editor shows it).
  function patternNames(s, sec) {
    const p = R().soundingPatterns(sec.rhythmPattern, sec.drumPattern, Song().sectionMeter(s, sec));
    return { rhythm: (p.rhythm && p.rhythm.name) || 'Plain chords', drums: (p.drum && p.drum.name) || 'No drums' };
  }

  function render() {
    const s = song();
    if (!s) { root().innerHTML = '<p class="meta">No song open.</p>'; return; }
    const ui = UI();

    const progress = Song().PROGRESS_STEPS.map(step => `
      <label class="progress-step${s.progress[step.id] ? ' done' : ''}" title="${ui.esc(step.tip)}">
        <input type="checkbox" data-progress="${step.id}"${s.progress[step.id] ? ' checked' : ''} />
        ${ui.esc(step.name)}
      </label>`).join('');

    const cards = s.sections.map((sec, i) => {
      const chords = Song().chordsOf(s, sec);
      const fid = Song().sectionFeeling(s, sec);
      const names = patternNames(s, sec);
      const time = Mt().id(Song().sectionMeter(s, sec));
      const bars = Song().sectionBars(sec, s);
      const facts = [time].concat(chords.length ? [bars + (bars === 1 ? ' bar' : ' bars')] : [], [names.rhythm, names.drums]);
      return `
      <div class="ov-card${sec.id === playingSectionId ? ' playing' : ''}" data-sec="${ui.esc(sec.id)}">
        <div class="ov-card-head">
          <span class="ov-sec-name">${ui.esc(sec.name)}</span>
          <button type="button" class="chip chip-feeling clickable" data-act="feeling" title="Change this section's feeling">${ui.esc(feelingName(fid))}</button>
        </div>
        <div class="ov-chords">${chords.length ? chords.map(c => `<span class="ov-chord ${c.category}">${ui.esc(c.shortName)}</span>`).join('') : '<span class="meta">no chords yet</span>'}</div>
        <div class="ov-meta meta">${facts.map(f => ui.esc(f)).join(' · ')}</div>
        <div class="ov-actions">
          <button type="button" class="ghost small" data-act="open">Edit</button>
          <button type="button" class="ghost small" data-act="dup">Duplicate</button>
          <button type="button" class="ghost small" data-act="left" ${i === 0 ? 'disabled' : ''}>◀</button>
          <button type="button" class="ghost small" data-act="right" ${i === s.sections.length - 1 ? 'disabled' : ''}>▶</button>
          <button type="button" class="ghost small danger" data-act="del">×</button>
        </div>
      </div>`;
    }).join('');

    const snaps = St().listSnapshots(s.id);
    const snapRows = snaps.length ? snaps.map(sn => `
      <div class="snap-row" data-snap="${ui.esc(sn.snapId)}">
        <span class="snap-name">${ui.esc(sn.name)}</span>
        <span class="meta">${ui.esc(ui.timeAgo(sn.takenAt))}</span>
        <span>
          <button type="button" class="ghost small" data-act="restore">Restore as copy</button>
          <button type="button" class="ghost small danger" data-act="delsnap">×</button>
        </span>
      </div>`).join('') : '<p class="meta">No snapshots yet. Take one before big changes — autosave can never overwrite it.</p>';

    const canPlaySong = !!(global.Audio && global.Audio.playSong);
    const songTime = Mt().id(s.meter);
    const times = Mt().LIST.map(t => t.id);
    if (!times.includes(songTime)) times.push(songTime);

    root().innerHTML = `
      <div class="overview">
        <header class="ov-head">
          <input id="ovTitle" class="ov-title" type="text" value="${ui.esc(s.title)}" maxlength="60" aria-label="Song title" />
          <div class="ov-head-meta">
            <span class="chip">${ui.esc(glyph(s.key))} ${ui.esc((global.Scales.getScaleMeta(s.scale) || {}).name || s.scale)}</span>
            <label class="chip chip-input" title="The song's time signature. Sections with a time of their own keep it.">Time <select id="ovMeter">${times.map(id =>
              `<option value="${ui.esc(id)}"${id === songTime ? ' selected' : ''}>${ui.esc(id)}</option>`).join('')}</select></label>
            <label class="chip chip-input">♩ <input id="ovTempo" type="number" min="40" max="200" value="${ui.esc(s.tempo)}" /> BPM</label>
            ${ui.genreChipHTML(s.genreId)}
            <button type="button" class="chip chip-feeling clickable" id="ovFeeling" title="Change the song's overall feeling">${ui.esc(feelingName(s.feelingId))}</button>
          </div>
          <div class="progress-steps">${progress}</div>
        </header>

        <div class="ov-transport">
          <button type="button" id="ovPlaySong" class="play-main" ${canPlaySong ? '' : 'disabled title="Whole-song playback arrives with the next update"'}>▶ Play song</button>
          <button type="button" id="ovStop" class="ghost">Stop</button>
          <label class="ck"><input id="ovLoop" type="checkbox" /> Loop song</label>
          <span class="meta" id="ovDuration"></span>
          <span class="spacer"></span>
          <button type="button" id="ovExportJson" class="ghost">Export JSON</button>
          <button type="button" id="ovExportMidi" class="ghost" ${global.Midi && global.Midi.downloadSong ? '' : 'disabled title="Multi-track MIDI arrives with a later update"'}>Export MIDI (all tracks)</button>
          <button type="button" id="ovDaw" class="ghost">Open in DAW</button>
          <button type="button" id="ovHandoff" class="ghost">Handoff pack</button>
        </div>

        <div class="ov-timeline" id="ovTimeline">${cards}
          <button type="button" class="ov-card add" id="ovAddSection">+ Add section</button>
        </div>

        <div class="ov-snapshots">
          <div class="ov-snap-head">
            <h4>Snapshots</h4>
            <button type="button" class="ghost small" id="ovTakeSnap">Take snapshot</button>
          </div>
          ${snapRows}
        </div>
      </div>`;

    wire();
  }

  function wire() {
    const s = song();
    const ui = UI();

    doc.getElementById('ovTitle').addEventListener('change', () => {
      const v = doc.getElementById('ovTitle').value.trim() || 'Untitled song';
      App().mutate(sg => { sg.title = v; });
      global.Nav.setSongOpen(s.id, v);
    });
    doc.getElementById('ovTempo').addEventListener('change', () => {
      const v = Math.max(40, Math.min(200, parseInt(doc.getElementById('ovTempo').value, 10) || s.tempo));
      App().mutate(sg => { sg.tempo = v; });
      updateDuration();
    });
    doc.getElementById('ovMeter').addEventListener('change', () => {
      const id = doc.getElementById('ovMeter').value;
      if (global.Audio) global.Audio.stop();
      App().mutate(sg => { I().useSongTime(sg, id); });
      render();
    });
    doc.getElementById('ovFeeling').addEventListener('click', () => {
      openFeelingDialog(null);
    });

    doc.querySelectorAll('#overviewRoot [data-progress]').forEach(cb => {
      cb.addEventListener('change', () => {
        App().mutate(sg => { sg.progress[cb.dataset.progress] = cb.checked; });
        render();
      });
    });

    doc.getElementById('ovAddSection').addEventListener('click', () => {
      openRolePicker();
    });

    doc.querySelectorAll('#ovTimeline .ov-card[data-sec]').forEach(card => {
      const secId = card.dataset.sec;
      card.addEventListener('click', (e) => {
        const act = e.target.dataset && e.target.dataset.act;
        if (!act) return;
        e.stopPropagation();
        const idx = s.sections.findIndex(x => x.id === secId);
        if (act === 'open') global.Nav.go('section', s.id, secId);
        else if (act === 'feeling') openFeelingDialog(secId);
        else if (act === 'dup') {
          App().mutate(sg => {
            const copy = Song().createSection(JSON.parse(JSON.stringify(sg.sections[idx])));
            copy.id = Song().newId('sec');
            sg.sections.splice(idx + 1, 0, copy);
            Song().autoNameSections(sg);
          });
          render();
        } else if (act === 'left' || act === 'right') {
          App().mutate(sg => {
            const to = act === 'left' ? idx - 1 : idx + 1;
            const [moved] = sg.sections.splice(idx, 1);
            sg.sections.splice(to, 0, moved);
            Song().autoNameSections(sg);
          });
          render();
        } else if (act === 'del') {
          if (s.sections.length <= 1) { ui.toast('A song needs at least one section'); return; }
          ui.confirmBox(`Delete "${s.sections[idx].name}"?`).then(ok => {
            if (!ok) return;
            App().mutate(sg => {
              sg.sections.splice(idx, 1);
              Song().autoNameSections(sg);
            });
            render();
          });
        }
      });
      card.addEventListener('dblclick', () => global.Nav.go('section', s.id, secId));
    });

    doc.getElementById('ovTakeSnap').addEventListener('click', () => {
      const suggested = 'Snapshot · ' + new Date().toLocaleDateString() + ' ' +
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      ui.promptBox('Snapshot name:', suggested).then(name => {
        if (name === null) return;
        App().flushSave();
        const id = St().takeSnapshot(s.id, name.trim() || undefined);
        if (id) { ui.toast('Snapshot saved — autosave can never touch it'); render(); }
      });
    });

    doc.querySelectorAll('.snap-row').forEach(row => {
      const snapId = row.dataset.snap;
      row.addEventListener('click', (e) => {
        const act = e.target.dataset && e.target.dataset.act;
        if (act === 'restore') {
          const newId = St().restoreSnapshot(s.id, snapId);
          if (newId) {
            ui.toast('Snapshot restored as a new song — your current version is untouched');
            global.Nav.go('overview', newId);
          }
        } else if (act === 'delsnap') {
          ui.confirmBox('Delete this snapshot?').then(ok => {
            if (ok) { St().deleteSnapshot(s.id, snapId); render(); }
          });
        }
      });
    });

    doc.getElementById('ovExportJson').addEventListener('click', () => {
      App().flushSave();
      global.Views.Songs.exportSong(s.id);
    });
    const midiBtn = doc.getElementById('ovExportMidi');
    if (global.Midi && global.Midi.downloadSong) {
      midiBtn.addEventListener('click', () => {
        if (global.Midi.downloadSong(s)) ui.toast('Multi-track MIDI downloaded — drag it into your DAW');
      });
    }
    doc.getElementById('ovDaw').addEventListener('click', () => global.Nav.go('daw', s.id));
    doc.getElementById('ovHandoff').addEventListener('click', () => global.Nav.go('handoff', s.id));

    const playBtn = doc.getElementById('ovPlaySong');
    if (global.Audio && global.Audio.playSong) {
      playBtn.addEventListener('click', () => {
        const items = Song().buildPlayback(s);
        if (!items.length) { ui.toast('No sections with chords yet'); return; }
        global.Audio.playSong(items, {
          loop: () => doc.getElementById('ovLoop') && doc.getElementById('ovLoop').checked,
          onSectionStart: (i, item) => {
            playingSectionId = item.sectionId;
            doc.querySelectorAll('#ovTimeline .ov-card').forEach(c =>
              c.classList.toggle('playing', c.dataset.sec === item.sectionId));
          },
          onDone: () => {
            playingSectionId = null;
            doc.querySelectorAll('#ovTimeline .ov-card').forEach(c => c.classList.remove('playing'));
          },
        });
      });
    }
    doc.getElementById('ovStop').addEventListener('click', () => {
      if (global.Audio) global.Audio.stop();
      playingSectionId = null;
      doc.querySelectorAll('#ovTimeline .ov-card').forEach(c => c.classList.remove('playing'));
    });

    updateDuration();
  }

  function updateDuration() {
    const el = doc.getElementById('ovDuration');
    if (!el) return;
    const sec = Math.round(Song().songDurationSec(song()));
    el.textContent = `~${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  // ── Dialogs ──────────────────────────────────────────────────────────────────────
  // A feeling is a label and a guide for the ideas offered; setting one
  // changes nothing the writer has written.
  function openFeelingDialog(sectionId) {
    const s = song();
    const ui = UI();
    const sec = sectionId ? Song().getSection(s, sectionId) : null;
    const now = sec ? Song().sectionFeeling(s, sec) : s.feelingId;
    const current = now && now !== 'none' ? now : '';
    const groups = F().groupedFeelings();
    const options = `<option value=""${current ? '' : ' selected'}>No particular feeling</option>` +
      Object.entries(groups).map(([group, list]) =>
        `<optgroup label="${ui.esc(group)}">${list.map(f =>
          `<option value="${f.id}"${f.id === current ? ' selected' : ''}>${ui.esc(f.name)}</option>`).join('')}</optgroup>`).join('');

    ui.openModal(`
      <div class="feeling-dialog">
        <h3>${sec ? 'Feeling for ' + ui.esc(sec.name) : 'Overall song feeling'}</h3>
        <select id="fdSelect">${options}</select>
        <p class="meta" id="fdVibe"></p>
        <p class="meta">It guides the ideas offered${sec ? ' for this section' : ''}. Nothing you have written changes.</p>
        <div class="fd-actions">
          <button type="button" class="primary" id="fdSet">Set feeling</button>
        </div>
      </div>`);

    const sel = doc.getElementById('fdSelect');
    const vibe = doc.getElementById('fdVibe');
    const updateVibe = () => {
      const f = sel.value ? F().getFeeling(sel.value) : null;
      vibe.textContent = f ? f.vibe + ' ' + f.tip : '';
    };
    sel.addEventListener('change', updateVibe);
    updateVibe();

    doc.getElementById('fdSet').addEventListener('click', () => {
      const feelingId = sel.value;
      App().mutate(sg => {
        if (!sec) { sg.feelingId = feelingId || null; return; }
        const target = Song().getSection(sg, sec.id);
        if (!feelingId) target.feelingId = sg.feelingId ? 'none' : null;
        else target.feelingId = feelingId === sg.feelingId ? null : feelingId;
      });
      UI().closeModal();
      render();
    });
  }

  // The new section stays here on the overview, where the song is being laid
  // out; Edit or a double-click opens it.
  function openRolePicker() {
    const ui = UI();
    const roles = R().SECTIONS.map(r =>
      `<button type="button" class="ghost" data-role="${r.id}">${ui.esc(r.name)} <span class="meta">${ui.esc(r.target)}</span></button>`).join('');
    ui.openModal(`<div class="role-picker"><h3>Add a section</h3><p class="meta">It starts empty, in the song's key and time.</p><div class="role-list">${roles}</div></div>`);
    doc.querySelectorAll('#modalContent [data-role]').forEach(b => {
      b.addEventListener('click', () => {
        const sec = Song().createSection({ role: b.dataset.role });
        App().mutate(sg => {
          sg.sections.push(sec);
          Song().autoNameSections(sg);
        });
        ui.closeModal();
        render();
      });
    });
  }

  function enter() { render(); }

  global.Views = global.Views || {};
  global.Views.Overview = { enter, render };
})(typeof window !== 'undefined' ? window : globalThis);
