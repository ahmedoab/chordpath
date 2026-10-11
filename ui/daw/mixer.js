/* ChordPath — ui/daw/mixer.js
 * The mixer: one strip per track with level meter, fader, pan, mute/solo,
 * three-band EQ, compressor switch and reverb/delay sends, plus the master.
 * Moving a control changes the sound at once; letting go records the change
 * for undo.
 */
(function (global) {
  'use strict';

  const doc = global.document;
  const FLOOR = -54;                 // bottom of the meters, dB
  const held = {};                   // meter id → displayed level (falls slowly)

  function esc(v) { return global.UI.esc(v); }

  function slider(field, value, min, max, step, title) {
    return `<input type="range" class="mx-range" data-field="${field}" min="${min}" max="${max}" step="${step}" value="${esc(value)}" title="${esc(title)}" aria-label="${esc(title)}" />`;
  }

  function dbText(db) { return db <= -59.5 ? '-inf' : (db > 0 ? '+' : '') + db.toFixed(1); }

  // A strip is two columns: the fader with its meter, as tall as the panel
  // allows, and beside it everything else, so nothing needs scrolling.
  function strip(track) {
    return `
      <div class="mx-strip" data-track="${esc(track.id)}" style="--tc:${esc(track.color)}">
        <div class="mx-name" title="${esc(track.name)}">${esc(track.name)}</div>
        <div class="mx-body">
          <div class="mx-main">
            <div class="mx-meter"><span data-meter="${esc(track.id)}"></span></div>
            <input type="range" class="mx-fader" data-field="volume" min="-60" max="6" step="0.5" value="${esc(track.volume)}" title="Volume. Double-click to reset." aria-label="Volume" />
          </div>
          <div class="mx-side">
            <div class="mx-row">
              <span class="mx-db mono" data-db title="Volume, dB">${dbText(track.volume)}</span>
              <button type="button" class="mx-btn${track.mute ? ' on' : ''}" data-toggle="mute" title="Mute">M</button>
              <button type="button" class="mx-btn solo${track.solo ? ' on' : ''}" data-toggle="solo" title="Solo">S</button>
            </div>
            <label class="mx-ctl"><span>Pan</span>${slider('pan', track.pan, -1, 1, 0.05, 'Pan, left to right')}</label>
            <label class="mx-ctl"><span>Low</span>${slider('fx.low', track.fx.low, -18, 18, 0.5, 'Low shelf, dB')}</label>
            <label class="mx-ctl"><span>Mid</span>${slider('fx.mid', track.fx.mid, -18, 18, 0.5, 'Mid, dB')}</label>
            <label class="mx-ctl"><span>High</span>${slider('fx.high', track.fx.high, -18, 18, 0.5, 'High shelf, dB')}</label>
            <label class="mx-ctl"><span>Reverb</span>${slider('fx.reverb', track.fx.reverb, 0, 1, 0.01, 'Reverb send')}</label>
            <label class="mx-ctl"><span>Delay</span>${slider('fx.delay', track.fx.delay, 0, 1, 0.01, 'Delay send')}</label>
            <button type="button" class="mx-btn wide${track.fx.comp ? ' on' : ''}" data-toggle="fx.comp" title="Evens out loud and quiet playing">Compressor</button>
          </div>
        </div>
      </div>`;
  }

  function render(container, project, actions) {
    container.innerHTML = `
      <div class="mixer">
        ${project.tracks.map(strip).join('')}
        <div class="mx-strip master">
          <div class="mx-name">Master</div>
          <div class="mx-body">
            <div class="mx-main">
              <div class="mx-meter"><span data-meter="master"></span></div>
              <input type="range" class="mx-fader" data-master min="-60" max="6" step="0.5" value="${esc(project.master)}" title="Master volume. Double-click to reset." aria-label="Master volume" />
            </div>
            <div class="mx-side"><span class="mx-db mono" data-db title="Master volume, dB">${dbText(project.master)}</span></div>
          </div>
        </div>
      </div>`;

    const set = (track, field, value) => {
      if (field.startsWith('fx.')) track.fx[field.slice(3)] = value;
      else track[field] = value;
    };

    container.querySelectorAll('.mx-strip[data-track]').forEach(node => {
      const track = project.tracks.find(t => t.id === node.dataset.track);
      if (!track) return;
      node.querySelectorAll('input[data-field]').forEach(input => {
        input.addEventListener('input', () => {
          const value = parseFloat(input.value);
          set(track, input.dataset.field, value);
          if (input.dataset.field === 'volume') node.querySelector('[data-db]').textContent = dbText(value);
          actions.live();
        });
        input.addEventListener('change', () => actions.done());
        // Double-click returns a control to its neutral position.
        input.addEventListener('dblclick', () => {
          const neutral = input.dataset.field === 'volume' ? -8 : 0;
          input.value = neutral;
          set(track, input.dataset.field, neutral);
          if (input.dataset.field === 'volume') node.querySelector('[data-db]').textContent = dbText(neutral);
          actions.live();
          actions.done();
        });
      });
      node.querySelectorAll('[data-toggle]').forEach(btn => {
        btn.addEventListener('click', () => {
          const field = btn.dataset.toggle;
          const next = !(field.startsWith('fx.') ? track.fx[field.slice(3)] : track[field]);
          set(track, field, next);
          btn.classList.toggle('on', next);
          btn.blur();
          actions.live();
          actions.done();
        });
      });
    });

    const master = container.querySelector('input[data-master]');
    master.addEventListener('input', () => {
      project.master = parseFloat(master.value);
      master.closest('.mx-strip').querySelector('[data-db]').textContent = dbText(project.master);
      actions.live();
    });
    master.addEventListener('change', () => actions.done());
    master.addEventListener('dblclick', () => {
      project.master = 0;
      master.value = 0;
      master.closest('.mx-strip').querySelector('[data-db]').textContent = dbText(0);
      actions.live();
      actions.done();
    });
  }

  // levels: { master, tracks: { id: dB } } — called every frame.
  function setLevels(container, levels) {
    container.querySelectorAll('[data-meter]').forEach(bar => {
      const id = bar.dataset.meter;
      const db = id === 'master' ? levels.master : levels.tracks[id];
      const now = Math.max(FLOOR, db == null ? FLOOR : db);
      const shown = Math.max(now, (held[id] == null ? FLOOR : held[id]) - 1.2);
      held[id] = shown;
      bar.style.height = Math.max(0, Math.min(100, (shown - FLOOR) / -FLOOR * 100)) + '%';
      bar.classList.toggle('hot', shown > -3);
    });
  }

  global.DawMixer = { render, setLevels };
})(typeof window !== 'undefined' ? window : globalThis);
