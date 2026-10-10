/* ChordPath — ui/views/overview.js
 * Song overview: title/key/tempo header, progress pipeline, section timeline
 * (per-section feelings, regeneration, reorder, add/remove), snapshots, and
 * exports. Whole-song playback wires in when Audio.playSong is available.
 */
(function (global) {
  'use strict';

  const doc = global.document;
  const UI = () => global.UI;
  const F = () => global.Feelings;
  const R = () => global.Arrangements;
  const Song = () => global.Song;
  const St = () => global.Storage;
  const App = () => global.App;

  function root() { return doc.getElementById('overviewRoot'); }
  function song() { return App().state.song; }

  let playingSectionId = null;

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
      const rhythm = R().byId(R().RHYTHMS, sec.rhythmPattern);
      const drums = R().byId(R().DRUMS, sec.drumPattern);
      return `
      <div class="ov-card${sec.id === playingSectionId ? ' playing' : ''}" data-sec="${ui.esc(sec.id)}">
        <div class="ov-card-head">
          <span class="ov-sec-name">${ui.esc(sec.name)}</span>
          <button type="button" class="chip chip-feeling clickable" data-act="feeling" title="Change this section's feeling">${ui.esc((F().getFeeling(fid) || {}).name || '?')}</button>
        </div>
        <div class="ov-chords">${chords.length ? chords.map(c => `<span class="ov-chord ${c.category}">${ui.esc(c.shortName)}</span>`).join('') : '<span class="meta">no chords yet</span>'}</div>
        <div class="ov-meta meta">${Song().sectionBars(sec)} bars · ${ui.esc(rhythm ? rhythm.name : '')} · ${ui.esc(drums ? drums.name : '')}</div>
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

    root().innerHTML = `
      <div class="overview">
        <header class="ov-head">
          <input id="ovTitle" class="ov-title" type="text" value="${ui.esc(s.title)}" maxlength="60" aria-label="Song title" />
          <div class="ov-head-meta">
            <span class="chip">${ui.esc(s.key)} ${ui.esc((global.Scales.getScaleMeta(s.scale) || {}).name || s.scale)}</span>
            <label class="chip chip-input">♩ <input id="ovTempo" type="number" min="40" max="200" value="${ui.esc(s.tempo)}" /> BPM</label>
            ${ui.genreChipHTML(s.genreId)}
            <button type="button" class="chip chip-feeling clickable" id="ovFeeling" title="Change the song's overall feeling">${ui.esc((F().getFeeling(s.feelingId) || {}).name || '')}</button>
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

  // ── Dialogs ──────────────────────────────────────────────────────────────
  function openFeelingDialog(sectionId) {
    const s = song();
    const ui = UI();
    const sec = sectionId ? Song().getSection(s, sectionId) : null;
    const current = sec ? Song().sectionFeeling(s, sec) : s.feelingId;
    const groups = F().groupedFeelings();
    const options = Object.entries(groups).map(([group, list]) =>
      `<optgroup label="${ui.esc(group)}">${list.map(f =>
        `<option value="${f.id}"${f.id === current ? ' selected' : ''}>${ui.esc(f.name)}</option>`).join('')}</optgroup>`).join('');

    ui.openModal(`
      <div class="feeling-dialog">
        <h3>${sec ? 'Feeling for ' + ui.esc(sec.name) : 'Overall song feeling'}</h3>
        <select id="fdSelect">${options}</select>
        <p class="meta" id="fdVibe"></p>
        ${sec ? `
        <p class="meta">Apply the new feeling by regenerating:</p>
        <div class="fd-actions">
          <button type="button" class="ghost" data-regen="none">Just set the label</button>
          <button type="button" class="ghost" data-regen="chords">Regenerate chords</button>
          <button type="button" class="ghost" data-regen="arr">Regenerate arrangement</button>
          <button type="button" class="primary" data-regen="all">Regenerate both</button>
        </div>` : `
        <div class="fd-actions">
          <button type="button" class="primary" data-regen="setsong">Set feeling</button>
        </div>`}
      </div>`);

    const sel = doc.getElementById('fdSelect');
    const vibe = doc.getElementById('fdVibe');
    const updateVibe = () => {
      const f = F().getFeeling(sel.value);
      vibe.textContent = f ? f.vibe + ' ' + f.tip : '';
    };
    sel.addEventListener('change', updateVibe);
    updateVibe();

    doc.querySelectorAll('.fd-actions [data-regen]').forEach(b => {
      b.addEventListener('click', () => {
        const mode = b.dataset.regen;
        const feelingId = sel.value;
        if (mode === 'setsong') {
          App().mutate(sg => { sg.feelingId = feelingId; });
        } else {
          App().mutate(sg => {
            sec.feelingId = feelingId === sg.feelingId ? null : feelingId;
          });
          if (mode === 'chords' || mode === 'all') {
            const seed = Date.now() & 0xffff;
            App().mutate(sg => {
              const prog = F().buildProgression({
                key: sg.key, scale: sg.scale, feelingId, role: sec.role, genreId: sg.genreId, seed,
              });
              Song().setProgression(sec, prog);
              sec.melodySeed = (seed * 7919 + 17) & 0xffff;
            });
          }
          if (mode === 'arr' || mode === 'all') {
            App().mutate(sg => {
              Object.assign(sec, F().pickArrangement({
                genreId: sg.genreId, feelingId, role: sec.role,
                energy: sg.energy, tempo: sg.tempo, seed: (Date.now() + 101) & 0xffff,
              }));
            });
          }
        }
        UI().closeModal();
        render();
      });
    });
  }

  function openRolePicker() {
    const ui = UI();
    const s = song();
    const roles = R().SECTIONS.map(r =>
      `<button type="button" class="ghost" data-role="${r.id}">${ui.esc(r.name)} <span class="meta">${ui.esc(r.target)}</span></button>`).join('');
    ui.openModal(`<div class="role-picker"><h3>Add a section</h3><div class="role-list">${roles}</div></div>`);
    doc.querySelectorAll('#modalContent [data-role]').forEach(b => {
      b.addEventListener('click', () => {
        const role = b.dataset.role;
        const feeling = F().contrastFor(s.feelingId, role);
        const sec = F().generateSectionSpec(s, role, feeling, Date.now() & 0xffff);
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
