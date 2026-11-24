/* ChordPath — ui/views/songs.js
 * Project browser: song cards with genre/feeling chips, progress stages, and
 * open/duplicate/export/delete actions. New song → wizard; Import JSON.
 */
(function (global) {
  'use strict';

  const doc = global.document;
  const UI = () => global.UI;
  const St = () => global.Storage;

  let search = '';

  // The four stages, named, with the ones ticked off on the Overview marked done.
  function progressLine(progress) {
    const steps = global.Song.PROGRESS_STEPS;
    return `<div class="song-progress" title="How far the song has got. Tick the stages off on its Overview."><span class="label">Progress</span>` + steps.map(s => {
      const done = !!(progress && progress[s.id]);
      return `<span class="${done ? 'done' : ''}" title="${UI().esc(s.tip)}">${done ? '✓ ' : ''}${UI().esc(s.name)}</span>`;
    }).join('') + '</div>';
  }

  function render() {
    const grid = doc.getElementById('songsGrid');
    if (!grid) return;
    const ui = UI();
    let projects = St().listProjects();
    if (search) {
      const q = search.toLowerCase();
      projects = projects.filter(p => (p.title || '').toLowerCase().includes(q));
    }

    if (!projects.length) {
      grid.innerHTML = `
        <div class="songs-empty">
          <h3>Start with a key</h3>
          <p class="meta">Choose the key and the time, and write. ChordPath offers chords, rhythms,
          grooves and melody shapes to hear and try, writes the tabs, and helps you take the song into a DAW.</p>
          <button type="button" class="primary" id="btnNewSongEmpty">+ New song</button>
        </div>`;
      const b = doc.getElementById('btnNewSongEmpty');
      if (b) b.addEventListener('click', () => global.Nav.go('wizard'));
      return;
    }

    grid.innerHTML = projects.map(p => `
      <div class="song-card" data-id="${ui.esc(p.id)}" tabindex="0" role="button" aria-label="Open ${ui.esc(p.title)}">
        <div class="song-card-head">
          <span class="song-card-title">${ui.esc(p.title)}</span>
        </div>
        <div class="song-card-chips">${ui.genreChipHTML(p.genreId)}${ui.feelingChipHTML(p.feelingId)}</div>
        <div class="song-card-meta meta">
          ${ui.esc(p.key || '')} ${ui.esc((global.Scales.getScaleMeta(p.scale) || {}).name || p.scale || '')}
          · ${ui.esc(p.tempo || '?')} BPM · ${ui.esc(p.sectionCount || 0)} ${(p.sectionCount || 0) === 1 ? 'section' : 'sections'}
        </div>
        ${progressLine(p.progress)}
        <div class="song-card-foot">
          <span class="meta">Changed ${ui.esc(ui.timeAgo(p.updatedAt))}</span>
          <span class="song-card-actions">
            <button type="button" class="ghost small" data-act="dup" title="Make a copy of this song">Duplicate</button>
            <button type="button" class="ghost small" data-act="export" title="Save this song as a file, to keep or to open on another computer">Save file</button>
            <button type="button" class="ghost small danger" data-act="del" title="Delete this song">Delete</button>
          </span>
        </div>
      </div>
    `).join('');

    grid.querySelectorAll('.song-card').forEach(card => {
      const id = card.dataset.id;
      card.addEventListener('click', (e) => {
        const act = e.target.dataset && e.target.dataset.act;
        if (act === 'dup') {
          e.stopPropagation();
          St().duplicateProject(id);
          render();
          ui.toast('Song duplicated');
          return;
        }
        if (act === 'export') {
          e.stopPropagation();
          exportSong(id);
          return;
        }
        if (act === 'del') {
          e.stopPropagation();
          const entry = St().listProjects().find(p => p.id === id);
          ui.confirmBox(`Delete "${entry ? entry.title : 'this song'}", its snapshots, and its DAW project with any recordings? This cannot be undone.`)
            .then(ok => {
              if (!ok) return;
              St().deleteProject(id);
              global.Views.Daw.forget(id);
              render();
              ui.toast('Song deleted');
            });
          return;
        }
        global.Nav.go('overview', id);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') global.Nav.go('overview', id);
      });
    });
  }

  function exportSong(id) {
    const text = St().exportText(id);
    if (!text) return;
    const entry = St().listProjects().find(p => p.id === id);
    const slug = (entry && entry.title ? entry.title : 'song')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song';
    const blob = new Blob([text], { type: 'application/json' });
    const a = doc.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = slug + '.chordpath.json';
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    UI().toast('Song file saved');
  }

  function wire() {
    const newBtn = doc.getElementById('btnNewSong');
    if (newBtn) newBtn.addEventListener('click', () => global.Nav.go('wizard'));

    const searchEl = doc.getElementById('songSearch');
    if (searchEl) searchEl.addEventListener('input', () => { search = searchEl.value.trim(); render(); });

    const importBtn = doc.getElementById('btnImportSong');
    const fileInput = doc.getElementById('importFile');
    if (importBtn && fileInput) {
      importBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        file.text().then(text => {
          const { song, errors } = St().importJSON(text);
          if (!song) {
            UI().toast('Import failed: ' + (errors[0] || 'invalid file'));
            return;
          }
          render();
          UI().toast(`Imported "${song.title}"`);
          global.Nav.go('overview', song.id);
        });
        fileInput.value = '';
      });
    }
  }

  global.Views = global.Views || {};
  global.Views.Songs = { render, wire, exportSong };
})(typeof window !== 'undefined' ? window : globalThis);
