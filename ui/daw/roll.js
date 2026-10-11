/* ChordPath — ui/daw/roll.js
 * The note editor for one clip: a piano roll for instruments, a step grid
 * for the drum kit. Rows that belong to the song's scale are tinted, so the
 * safe notes are visible before you place one.
 *
 * Click an empty cell to add a note (drag to set its length), drag a note to
 * move it or its right edge to resize it, right-click or double-click to
 * delete. On the drum grid a click simply toggles a hit.
 *
 * Several notes: hold Shift and drag a box over them, or Shift-click notes
 * one by one. Dragging any selected note then moves or resizes them all.
 */
(function (global) {
  'use strict';

  const KEYS_W = 54;
  const RULER_H = 16;
  const ROW_H = 12;
  const DRUM_ROW_H = 24;
  const LOW = 24, HIGH = 96;
  const BLACK = new Set([1, 3, 6, 8, 10]);
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  let lastLength = 0.5;      // new notes take the length of the last one drawn

  function create(canvas, host) {
    const g = canvas.getContext('2d');
    let drag = null;
    let width = 0, height = 0;

    function theme() {
      const cs = global.getComputedStyle(global.document.documentElement);
      const v = name => cs.getPropertyValue(name).trim();
      return {
        bg: v('--bg'), surface: v('--surface'), surface2: v('--surface-2'), line: v('--line'), line2: v('--line-2'),
        ink: v('--ink'), ink2: v('--ink-2'), muted: v('--muted'), accent: v('--accent'), accent2: v('--accent-2'),
      };
    }

    function layout() {
      const st = host.state();
      const drums = st.track.kind === 'drums';
      const list = [];
      if (drums) global.DawProject.DRUM_LANES.forEach(l => list.push({ note: l.note, name: l.name }));
      else for (let n = HIGH; n >= LOW; n--) list.push({ note: n, name: NAMES[n % 12] + (Math.floor(n / 12) - 1) });
      return { st, drums, list, rowH: drums ? DRUM_ROW_H : ROW_H, ppb: st.rollPx, step: st.snap > 0 ? st.snap : 0.25 };
    }

    function resize() {
      const L = layout();
      const dpr = global.devicePixelRatio || 1;
      width = Math.max(canvas.parentElement.clientWidth, KEYS_W + Math.ceil(L.st.clip.length * L.ppb) + 24);
      height = RULER_H + L.list.length * L.rowH;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Vertical position that centres the clip's notes, for the first view.
    function focusY() {
      const L = layout();
      if (L.drums || !L.st.clip.notes.length) return L.drums ? 0 : RULER_H + (HIGH - 66) * ROW_H;
      const pitches = L.st.clip.notes.map(n => n.n).sort((a, b) => a - b);
      const mid = pitches[Math.floor(pitches.length / 2)];
      return RULER_H + (HIGH - mid) * ROW_H;
    }

    function draw() {
      const L = layout();
      const { st, list, rowH, ppb } = L;
      const c = theme();
      const clip = st.clip;
      const scroll = st.scroll;
      const S = global.Scales;
      const keyPc = S.noteIndex(st.project.key);
      const inScale = new Set(S.getIntervals(st.project.scale).map(iv => (keyPc + iv) % 12));
      const gridW = clip.length * ppb;

      g.clearRect(0, 0, width, height);
      g.fillStyle = c.bg;
      g.fillRect(0, 0, width, height);

      // Rows.
      list.forEach((row, i) => {
        const y = RULER_H + i * rowH;
        const pc = row.note % 12;
        if (L.drums) g.fillStyle = i % 2 ? c.bg : c.surface;
        else if (pc === keyPc) g.fillStyle = c.accent2;
        else if (inScale.has(pc)) g.fillStyle = c.surface;
        else g.fillStyle = c.surface2;
        g.fillRect(KEYS_W, y, gridW, rowH);
        if (L.drums || pc === 0) {
          g.fillStyle = c.line;
          g.fillRect(KEYS_W, y + rowH - 1, gridW, 1);
        }
      });

      // Time grid: the snap steps faintly, then the beats and bar lines of the
      // time signature the clip sits in.
      const bars = global.DawProject.clipBars(st.project, clip);
      const upright = (beat, alpha, color) => {
        g.globalAlpha = alpha;
        g.fillStyle = color;
        g.fillRect(KEYS_W + beat * ppb, RULER_H, 1, height - RULER_H);
      };
      if (L.step * ppb >= 7) for (let b = 0; b <= clip.length + 1e-9; b += L.step) upright(b, 0.28, c.line);
      bars.forEach(bar => {
        const beat = 4 / bar.den;
        if (beat * ppb >= 7) {
          for (let k = Math.ceil(bar.skip / beat - 1e-9); k * beat < bar.skip + bar.length - 1e-9; k++) {
            if (k) upright(bar.start - bar.skip + k * beat, 0.6, c.line);
          }
        }
        if (bar.skip < 1e-9) upright(bar.start, 1, c.line2);
      });
      upright(clip.length, 1, c.line2);
      g.globalAlpha = 1;
      g.fillStyle = c.bg;
      g.fillRect(KEYS_W + gridW + 1, RULER_H, width - KEYS_W - gridW, height - RULER_H);

      // Notes.
      clip.notes.forEach(n => {
        const i = list.findIndex(r => r.note === n.n);
        if (i < 0 || n.t >= clip.length) return;
        const x = KEYS_W + n.t * ppb;
        const w = Math.max(3, (L.drums ? L.step : Math.min(n.d, clip.length - n.t)) * ppb - 1);
        const y = RULER_H + i * rowH + 1;
        g.globalAlpha = 0.45 + 0.55 * n.v;
        g.fillStyle = st.track.color;
        g.beginPath();
        g.roundRect(x, y, w, rowH - 2, 2);
        g.fill();
        g.globalAlpha = 1;
        if (st.sel.noteIds.includes(n.id)) {
          g.lineWidth = 1.5;
          g.strokeStyle = c.ink;
          g.stroke();
        }
      });

      // The box being dragged out to select notes.
      if (drag && drag.kind === 'box') {
        const x = KEYS_W + Math.min(drag.beat, drag.toBeat) * ppb;
        const y = RULER_H + Math.min(drag.index, drag.toIndex) * rowH;
        const w = Math.abs(drag.toBeat - drag.beat) * ppb;
        const h = (Math.abs(drag.toIndex - drag.index) + 1) * rowH;
        g.globalAlpha = 0.14;
        g.fillStyle = c.accent;
        g.fillRect(x, y, w, h);
        g.globalAlpha = 1;
        g.lineWidth = 1;
        g.strokeStyle = c.accent;
        g.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
      }

      // Playhead (clip-relative).
      const rel = st.playhead - clip.start;
      if (rel >= 0 && rel <= clip.length) {
        g.fillStyle = c.accent;
        g.fillRect(KEYS_W + rel * ppb - 0.5, RULER_H, 1.5, height - RULER_H);
      }

      // Beat ruler, pinned to the top of the scrolled view.
      const ry = scroll.top;
      g.fillStyle = c.surface;
      g.fillRect(0, ry, width, RULER_H);
      g.fillStyle = c.line;
      g.fillRect(0, ry + RULER_H - 1, width, 1);
      // Bars are numbered as they are in the song; the beats within them when there is room.
      g.font = '500 9px "JetBrains Mono", monospace';
      g.fillStyle = c.muted;
      bars.forEach(bar => {
        const beat = 4 / bar.den;
        for (let k = Math.ceil(bar.skip / beat - 1e-9); k * beat < bar.skip + bar.length - 1e-9; k++) {
          if (k && beat * ppb < 22) continue;
          g.fillText(bar.bar + (k ? '.' + (k + 1) : ''), KEYS_W + (bar.start - bar.skip + k * beat) * ppb + 3, ry + 11);
        }
      });

      // Key column, pinned to the left of the scrolled view.
      const kx = scroll.left;
      list.forEach((row, i) => {
        const y = RULER_H + i * rowH;
        const pc = row.note % 12;
        g.fillStyle = L.drums ? c.surface : (BLACK.has(pc) ? c.ink2 : c.surface);
        g.fillRect(kx, y, KEYS_W, rowH);
        g.fillStyle = c.line;
        g.fillRect(kx, y + rowH - 1, KEYS_W, 1);
        if (L.drums || pc === 0 || pc === keyPc) {
          g.fillStyle = L.drums ? c.ink2 : (pc === keyPc ? c.accent : c.muted);
          g.font = (L.drums ? '500 10px Inter, sans-serif' : '500 9px "JetBrains Mono", monospace');
          g.fillText(row.name, kx + 5, y + rowH - (L.drums ? 8 : 3));
        }
      });
      g.fillStyle = c.line2;
      g.fillRect(kx + KEYS_W - 1, 0, 1, height);
      g.fillStyle = c.surface;
      g.fillRect(kx, ry, KEYS_W - 1, RULER_H - 1);
    }

    // ── Gestures ───────────────────────────────────────────────────────────
    function at(e) {
      const L = layout();
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const index = Math.floor((y - RULER_H) / L.rowH);
      const row = L.list[index] || null;
      const beat = (x - KEYS_W) / L.ppb;
      const overKeys = x - L.st.scroll.left < KEYS_W;
      let note = null;
      if (row && !overKeys) {
        const reach = L.drums ? L.step : 0;
        for (let i = L.st.clip.notes.length - 1; i >= 0; i--) {
          const n = L.st.clip.notes[i];
          if (n.n === row.note && beat >= n.t && beat < n.t + Math.max(reach || n.d, 3 / L.ppb)) { note = n; break; }
        }
      }
      return { L, x, y, index, row, beat, overKeys, note };
    }

    // Where the notes of a group are when a drag on them begins.
    function hold(kind, clip, ids, note, grab, moved) {
      return {
        kind, grab, moved, dt: 0, dn: 0, dd: 0,
        anchor: { id: note.id, t: note.t, d: note.d, n: note.n },
        base: clip.notes.filter(n => ids.includes(n.id)).map(n => ({ id: n.id, t: n.t, d: n.d, n: n.n })),
        alone: ids.length > 1 ? note.id : null,          // a plain click on one of several selects just that one
      };
    }

    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const P = global.DawProject;
      const h = at(e);
      const clip = h.L.st.clip;
      if (!h.row || h.y - h.L.st.scroll.top < RULER_H) return;
      if (h.overKeys) { host.actions.audition(h.row.note); return; }
      canvas.setPointerCapture(e.pointerId);
      const picked = h.L.st.sel.noteIds;
      const more = e.ctrlKey || e.metaKey;

      // With Shift (or Ctrl) held nothing is added or moved: notes are chosen.
      if (e.shiftKey || more) {
        if (h.note) {
          host.actions.selectNotes(picked.includes(h.note.id) ? picked.filter(id => id !== h.note.id) : picked.concat(h.note.id));
        } else {
          const keep = e.shiftKey && more ? picked.slice() : [];
          drag = { kind: 'box', beat: h.beat, index: h.index, toBeat: h.beat, toIndex: h.index, keep };
          host.actions.selectNotes(keep);
        }
        host.actions.redraw();
        return;
      }

      if (h.note) {
        if (h.L.drums) {
          P.removeNote(clip, h.note.id);
          host.actions.selectNotes(picked.filter(id => id !== h.note.id));
          host.actions.commit();
          return;
        }
        const group = picked.includes(h.note.id) ? picked : [h.note.id];
        host.actions.selectNotes(group);
        host.actions.audition(h.note.n);
        const edge = KEYS_W + (h.note.t + h.note.d) * h.L.ppb - h.x <= 6;
        drag = hold(edge ? 'resize' : 'move', clip, group, h.note, h.beat - h.note.t, false);
        host.actions.redraw();
        return;
      }

      const t = Math.floor(h.beat / h.L.step + 1e-9) * h.L.step;
      if (h.beat < 0 || t >= clip.length) return;
      if (h.L.drums) {
        P.addNote(clip, { t, d: h.L.step, n: h.row.note, v: 0.8 });
        host.actions.audition(h.row.note);
        host.actions.commit();
        return;
      }
      const made = P.addNote(clip, { t, d: Math.min(lastLength, clip.length - t), n: h.row.note, v: 0.8 });
      if (!made) return;
      host.actions.selectNotes([made.id]);
      host.actions.audition(made.n);
      drag = hold('resize', clip, [made.id], made, 0, true);
      host.actions.redraw();
    });

    canvas.addEventListener('pointermove', e => {
      const h = at(e);
      if (!drag) {
        canvas.style.cursor = h.overKeys ? 'pointer'
          : h.note && !h.L.drums && KEYS_W + (h.note.t + h.note.d) * h.L.ppb - h.x <= 6 ? 'ew-resize'
          : h.note ? 'grab' : 'crosshair';
        return;
      }
      const P = global.DawProject;
      const clip = h.L.st.clip;
      const snap = b => (h.L.st.snap > 0 ? Math.round(b / h.L.st.snap) * h.L.st.snap : b);
      if (drag.kind === 'box') {
        drag.toBeat = h.beat;
        drag.toIndex = Math.max(0, Math.min(h.L.list.length - 1, h.index));
        const rows = h.L.list.slice(Math.min(drag.index, drag.toIndex), Math.max(drag.index, drag.toIndex) + 1).map(r => r.note);
        const inside = P.notesWithin(clip, drag.beat, drag.toBeat, rows, h.L.drums ? h.L.step : 0);
        host.actions.selectNotes(drag.keep.concat(inside.filter(id => !drag.keep.includes(id))));
        host.actions.redraw();
      } else if (drag.kind === 'move') {
        const pitch = h.row ? h.row.note : drag.anchor.n + drag.dn;
        const went = P.shiftNotes(clip, drag.base, snap(h.beat - drag.grab) - drag.anchor.t, pitch - drag.anchor.n,
          { low: LOW, high: HIGH, step: h.L.step });
        if (went.dt !== drag.dt || went.dn !== drag.dn) {
          if (went.dn !== drag.dn) host.actions.audition(drag.anchor.n + went.dn);
          drag.dt = went.dt;
          drag.dn = went.dn;
          drag.moved = true;
          host.actions.redraw();
        }
      } else {
        const d = Math.max(h.L.step, Math.min(clip.length, snap(h.beat)) - drag.anchor.t);
        if (d - drag.anchor.d !== drag.dd) {
          drag.dd = d - drag.anchor.d;
          P.stretchNotes(clip, drag.base, drag.dd, h.L.step);
          lastLength = d;
          drag.moved = true;
          host.actions.redraw();
        }
      }
    });

    function release() {
      if (!drag) return;
      const was = drag;
      drag = null;
      if (was.kind === 'box') host.actions.redraw();
      else if (was.moved) host.actions.commit();
      else if (was.alone) { host.actions.selectNotes([was.alone]); host.actions.redraw(); }
    }
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    function remove(e) {
      const h = at(e);
      if (!h.note) return false;
      global.DawProject.removeNote(h.L.st.clip, h.note.id);
      host.actions.selectNotes(h.L.st.sel.noteIds.filter(id => id !== h.note.id));
      host.actions.commit();
      return true;
    }
    canvas.addEventListener('contextmenu', e => { e.preventDefault(); remove(e); });
    canvas.addEventListener('dblclick', e => { if (!layout().drums) remove(e); });

    return { draw, resize, focusY };
  }

  global.DawRoll = { create, KEYS_W, RULER_H, ROW_H, LOW, HIGH };
})(typeof window !== 'undefined' ? window : globalThis);
