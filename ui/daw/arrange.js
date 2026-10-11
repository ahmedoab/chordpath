/* ChordPath — ui/daw/arrange.js
 * The arrangement timeline: one lane per track, clips drawn as strips of ink
 * on the page, and — instead of a bare bar ruler — the song's own sections
 * across the top. Click a section to loop it. The bar ruler beneath follows
 * the time signature and notes where the tempo or the time changes;
 * double-click it to make a change there.
 *
 * Draws on one canvas. The view owns the project; this module reads it
 * through host.state() and reports gestures through host.actions.
 */
(function (global) {
  'use strict';

  const RIBBON_H = 24;      // section names
  const RULER_H = 20;       // bar numbers; drag here to set a loop
  const LANE_H = 58;
  const TOP = RIBBON_H + RULER_H;
  const EDGE = 7;           // px at a clip's right edge that resize it

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

    function resize() {
      const st = host.state();
      const dpr = global.devicePixelRatio || 1;
      width = Math.max(200, canvas.parentElement.clientWidth);
      height = TOP + st.project.tracks.length * LANE_H + 1;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const beatToX = beat => (beat - host.state().scrollBeat) * host.state().pxPerBeat;
    const xToBeat = x => x / host.state().pxPerBeat + host.state().scrollBeat;
    const snapBeat = beat => host.snapBeat(beat);

    function hit(x, y) {
      const st = host.state();
      if (y < RIBBON_H) return { zone: 'ribbon' };
      if (y < TOP) return { zone: 'ruler' };
      const index = Math.floor((y - TOP) / LANE_H);
      const track = st.project.tracks[index];
      if (!track) return { zone: 'empty' };
      const beat = xToBeat(x);
      // Later clips draw on top, so search from the end.
      for (let i = track.clips.length - 1; i >= 0; i--) {
        const clip = track.clips[i];
        if (beat >= clip.start && beat < clip.start + clip.length) {
          return { zone: 'lane', track, index, clip, edge: beatToX(clip.start + clip.length) - x <= EDGE };
        }
      }
      return { zone: 'lane', track, index, clip: null };
    }

    // ── Drawing ────────────────────────────────────────────────────────────
    function label(text, x, y, maxWidth, color, font) {
      if (maxWidth < 14) return;
      g.save();
      g.beginPath();
      g.rect(x, y - 12, maxWidth, 16);
      g.clip();
      g.fillStyle = color;
      g.font = font || '500 11px Inter, sans-serif';
      g.fillText(text, x, y);
      g.restore();
    }

    function drawClip(track, clip, y, c, selected) {
      const st = host.state();
      const x = beatToX(clip.start);
      const w = Math.max(3, clip.length * st.pxPerBeat - 1);
      if (x > width || x + w < 0) return;
      const top = y + 4, h = LANE_H - 9;

      g.globalAlpha = selected ? 0.3 : 0.16;
      g.fillStyle = track.color;
      g.beginPath();
      g.roundRect(x, top, w, h, 4);
      g.fill();
      g.globalAlpha = 1;
      g.lineWidth = selected ? 2 : 1;
      g.strokeStyle = selected ? c.accent : track.color;
      g.stroke();

      g.save();
      g.beginPath();
      g.rect(Math.max(0, x), top, Math.min(w, width - x), h);
      g.clip();
      g.fillStyle = track.color;
      const bodyTop = top + 16, bodyH = h - 20;
      if (clip.notes) {
        let lo = 127, hi = 0;
        clip.notes.forEach(n => { if (n.n < lo) lo = n.n; if (n.n > hi) hi = n.n; });
        const span = Math.max(1, hi - lo);
        g.globalAlpha = 0.9;
        clip.notes.forEach(n => {
          if (n.t >= clip.length) return;
          const nx = x + n.t * st.pxPerBeat;
          if (nx > width || nx < -40) return;
          g.fillRect(nx, bodyTop + (1 - (n.n - lo) / span) * (bodyH - 3),
            Math.max(1.5, Math.min(n.d, clip.length - n.t) * st.pxPerBeat - 0.5), 2.5);
        });
      } else {
        const total = host.audioSeconds(clip.audioId);
        const P = global.DawProject;
        const lasts = P.beatToSeconds(st.project, clip.start + clip.length) - P.beatToSeconds(st.project, clip.start);
        const buckets = Math.max(8, Math.min(2000, Math.round(w / 2)));
        const peaks = total > 0 ? host.audioPeaks(clip.audioId, Math.max(8, Math.round(buckets * total / Math.max(0.01, lasts)))) : null;
        if (peaks) {
          const first = Math.floor(clip.offset / total * peaks.length);
          const mid = bodyTop + bodyH / 2;
          g.globalAlpha = 0.85;
          for (let i = 0; i < buckets; i++) {
            const p = peaks[first + i];
            if (p == null) break;
            const amp = Math.max(0.5, Math.min(1, p * clip.gain) * bodyH / 2);
            g.fillRect(x + i * (w / buckets), mid - amp, Math.max(1, w / buckets - 0.5), amp * 2);
          }
        } else {
          label('recording not found', x + 6, bodyTop + 12, w - 10, c.muted);
        }
      }
      g.restore();
      g.globalAlpha = 1;
      label(clip.name || (clip.notes ? 'Clip' : 'Take'), x + 6, top + 12, w - 10, c.ink);
    }

    function draw() {
      const st = host.state();
      const c = theme();
      const p = st.project;
      const ppb = st.pxPerBeat;
      g.clearRect(0, 0, width, height);
      g.fillStyle = c.bg;
      g.fillRect(0, 0, width, height);

      const firstBeat = Math.max(0, Math.floor(st.scrollBeat));
      const lastBeat = Math.ceil(xToBeat(width));

      // Section ribbon: the song's form is the ruler.
      const end = Math.max(global.DawProject.endBeat(p), lastBeat);
      p.markers.forEach((m, i) => {
        const x0 = beatToX(m.beat);
        const x1 = beatToX(i + 1 < p.markers.length ? p.markers[i + 1].beat : end);
        if (x1 < 0 || x0 > width) return;
        const looped = p.loop.on && Math.abs(p.loop.start - m.beat) < 1e-6 &&
          Math.abs(p.loop.end - (i + 1 < p.markers.length ? p.markers[i + 1].beat : global.DawProject.endBeat(p))) < 1e-6;
        g.fillStyle = looped ? c.accent2 : (i % 2 ? c.surface : c.surface2);
        g.fillRect(x0, 0, x1 - x0, RIBBON_H);
        g.fillStyle = c.line;
        g.fillRect(x0, 0, 1, RIBBON_H);
        label(m.name, Math.max(x0, 0) + 7, 16, x1 - Math.max(x0, 0) - 10, looped ? c.ink : c.ink2, '600 11px Inter, sans-serif');
      });

      // Bar ruler: the bars are as long as the time signature makes them.
      g.fillStyle = c.surface;
      g.fillRect(0, RIBBON_H, width, RULER_H);
      const P = global.DawProject;
      const bars = P.barsBetween(p, P.positionAt(p, firstBeat).start, lastBeat + 1);
      const shortest = bars.reduce((least, b) => Math.min(least, b.length), 4) * ppb;
      const barStep = shortest >= 34 ? 1 : shortest >= 17 ? 2 : shortest >= 8 ? 4 : 8;
      bars.forEach(b => {
        if ((b.bar - 1) % barStep) return;
        const x = beatToX(b.beat);
        g.fillStyle = c.line2;
        g.fillRect(x, RIBBON_H + 12, 1, RULER_H - 12);
        label(String(b.bar), x + 4, RIBBON_H + 14, 40, c.muted, '500 10px "JetBrains Mono", monospace');
      });
      // Where the tempo or the time signature changes, the ruler says what to.
      P.stretches(p).forEach((s, i, all) => {
        const x = beatToX(s.beat);
        if (!i || x < -120 || x > width) return;
        const was = all[i - 1];
        const news = [s.tempo !== was.tempo ? s.tempo + ' bpm' : '', s.num !== was.num || s.den !== was.den ? s.num + '/' + s.den : '']
          .filter(Boolean).join('  ');
        g.fillStyle = c.accent;
        g.fillRect(x, RIBBON_H, 1.5, RULER_H);
        // The note sits on a plate of its own, over any bar numbers it would otherwise run into.
        g.font = '600 10px Inter, sans-serif';
        const wide = Math.ceil(g.measureText(news || 'same').width);
        g.fillStyle = c.surface;
        g.fillRect(x + 22, RIBBON_H + 6, wide + 10, RULER_H - 7);
        label(news || 'same', x + 26, RIBBON_H + 14, wide + 4, c.accent, '600 10px Inter, sans-serif');
      });
      if (p.loop.end > p.loop.start) {
        const lx = beatToX(p.loop.start), lw = (p.loop.end - p.loop.start) * ppb;
        g.globalAlpha = p.loop.on ? 0.55 : 0.18;
        g.fillStyle = c.accent;
        g.fillRect(lx, RIBBON_H, lw, 5);
        g.globalAlpha = 1;
      }

      // Lanes and their grid.
      p.tracks.forEach((track, i) => {
        const y = TOP + i * LANE_H;
        g.fillStyle = track.id === st.sel.trackId ? c.surface : c.bg;
        g.fillRect(0, y, width, LANE_H);
        g.fillStyle = c.line;
        g.fillRect(0, y + LANE_H - 1, width, 1);
      });
      const lanesH = p.tracks.length * LANE_H;
      g.fillStyle = c.line;
      bars.forEach(b => {
        g.globalAlpha = 0.9;
        g.fillRect(beatToX(b.beat), TOP, 1, lanesH);
        const beat = 4 / b.den;                      // the beat this bar is counted in
        if (beat * ppb < 9) return;
        g.globalAlpha = 0.4;
        for (let k = 1; k < b.num && k * beat < b.length - 1e-9; k++) g.fillRect(beatToX(b.beat + k * beat), TOP, 1, lanesH);
      });
      g.globalAlpha = 1;
      if (p.loop.on && p.loop.end > p.loop.start) {
        g.globalAlpha = 0.07;
        g.fillStyle = c.accent;
        g.fillRect(beatToX(p.loop.start), TOP, (p.loop.end - p.loop.start) * ppb, lanesH);
        g.globalAlpha = 1;
      }

      p.tracks.forEach((track, i) => {
        const y = TOP + i * LANE_H;
        g.globalAlpha = track.mute ? 0.45 : 1;
        track.clips.forEach(clip => drawClip(track, clip, y, c, clip.id === st.sel.clipId));
        g.globalAlpha = 1;
      });

      // Playhead.
      const px = beatToX(st.playhead);
      if (px >= -1 && px <= width) {
        g.fillStyle = c.accent;
        g.fillRect(px - 0.5, RIBBON_H, 1.5, height - RIBBON_H);
        g.beginPath();
        g.moveTo(px - 5, RIBBON_H);
        g.lineTo(px + 5, RIBBON_H);
        g.lineTo(px, RIBBON_H + 7);
        g.fill();
      }
    }

    // ── Gestures ───────────────────────────────────────────────────────────
    function point(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const pt = point(e);
      const h = hit(pt.x, pt.y);
      const st = host.state();
      canvas.setPointerCapture(e.pointerId);
      if (h.zone === 'ribbon') {
        const beat = xToBeat(pt.x);
        let index = -1;
        st.project.markers.forEach((m, i) => { if (m.beat <= beat) index = i; });
        if (index >= 0) host.actions.pickSection(index);
        return;
      }
      if (h.zone === 'ruler') {
        drag = { kind: 'ruler', x: pt.x, from: snapBeat(xToBeat(pt.x)), moved: false };
        return;
      }
      if (h.zone !== 'lane') return;
      host.actions.select(h.track.id, h.clip ? h.clip.id : null);
      if (h.clip) {
        drag = {
          kind: h.edge ? 'resize' : 'move', clip: h.clip, grab: xToBeat(pt.x) - h.clip.start,
          moved: false,
        };
      }
    });

    canvas.addEventListener('pointermove', e => {
      const pt = point(e);
      const P = global.DawProject;
      const st = host.state();
      if (!drag) {
        const h = hit(pt.x, pt.y);
        canvas.style.cursor = h.zone === 'ruler' ? 'text' : h.zone === 'ribbon' ? 'pointer'
          : h.clip ? (h.edge ? 'ew-resize' : 'grab') : 'default';
        return;
      }
      if (drag.kind === 'ruler') {
        if (Math.abs(pt.x - drag.x) > 4) drag.moved = true;
        if (drag.moved) {
          const to = snapBeat(xToBeat(pt.x));
          host.actions.previewLoop(Math.min(drag.from, to), Math.max(drag.from, to));
        }
        return;
      }
      if (drag.kind === 'move') {
        const start = snapBeat(xToBeat(pt.x) - drag.grab);
        const over = st.project.tracks[Math.floor((pt.y - TOP) / LANE_H)];
        const before = drag.clip.start;
        const home = P.findClip(st.project, drag.clip.id).track.id;
        P.moveClip(st.project, drag.clip.id, start, over ? over.id : undefined);
        const now = P.findClip(st.project, drag.clip.id).track.id;
        if (drag.clip.start !== before || now !== home) {
          drag.moved = true;
          if (now !== home) host.actions.select(now, drag.clip.id);
          host.actions.redraw();
        }
      } else if (drag.kind === 'resize') {
        const min = host.gridStep(drag.clip.start);
        const length = Math.max(min, snapBeat(xToBeat(pt.x)) - drag.clip.start);
        if (length !== drag.clip.length) {
          P.resizeClip(st.project, drag.clip.id, length);
          drag.moved = true;
          host.actions.redraw();
        }
      }
    });

    function release() {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.kind === 'ruler') {
        if (d.moved) host.actions.commitLoop();
        else host.actions.seek(d.from);
      } else if (d.moved) {
        host.actions.commit();
      }
    }
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    canvas.addEventListener('dblclick', e => {
      const pt = point(e);
      const h = hit(pt.x, pt.y);
      // On the ruler: the playhead has just been put there, so offer a change of tempo or time.
      if (h.zone === 'ruler') { host.actions.openTiming(); return; }
      if (h.zone !== 'lane') return;
      if (h.clip) host.actions.openClip(h.track.id, h.clip.id);
      else if (h.track.kind !== 'audio') host.actions.createClip(h.track.id, xToBeat(pt.x));
    });

    canvas.addEventListener('wheel', e => {
      if (e.ctrlKey) {
        e.preventDefault();
        host.actions.zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, xToBeat(point(e).x));
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        host.actions.scrollBy((e.deltaX || e.deltaY) / host.state().pxPerBeat);
      }
    }, { passive: false });

    return { draw, resize };
  }

  global.DawArrange = { create, RIBBON_H, RULER_H, LANE_H, TOP };
})(typeof window !== 'undefined' ? window : globalThis);
