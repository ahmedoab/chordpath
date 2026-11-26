/* ChordPath — ui/daw/arrange.js
 * The arrangement timeline: one lane per track, clips drawn as strips of ink
 * on the page, and — instead of a bare bar ruler — the song's own sections
 * across the top. Click a section to loop it. The bar ruler beneath follows
 * the time signature and notes where the tempo or the time changes;
 * double-click it to make a change there. Drag along it to set the loop;
 * Shift-drag to set the punch range.
 *
 * Audio clips have fade handles at their top corners and can be trimmed from
 * either edge. A track that shows its takes has a row for each take beneath
 * it: drag along a row to use that take there. A track that shows its
 * automation has a row for each lane: click to add a point, drag one to move
 * it, right-click or double-click it to take it away. The master's lanes, when
 * shown, sit below the last track.
 *
 * Draws on one canvas. The view owns the project; this module reads it
 * through host.state() and reports gestures through host.actions.
 */
(function (global) {
  'use strict';

  const RIBBON_H = 24;      // section names
  const RULER_H = 20;       // bar numbers; drag here to set a loop
  const LANE_H = 58;
  const TAKE_H = 26;        // a row for one take, under a track that shows them
  const AUTO_H = 34;        // a row for one lane of automation, and one more to add a lane from
  const NEAR = 7;           // px round a point of automation that grab it
  const TOP = RIBBON_H + RULER_H;
  const EDGE = 7;           // px at a clip's edges that trim it
  const HANDLE = 7;         // px round a fade handle that grab it

  const P = () => global.DawProject;

  // How many take rows a track shows: none unless it is showing them and has a clip with more than one take.
  function takeRows(track) {
    if (track.kind !== 'audio' || !track.showTakes) return 0;
    const most = track.clips.reduce((n, c) => Math.max(n, P().takesOf(c).length), 0);
    return most > 1 ? most : 0;
  }
  function takesHeight(track) {
    const rows = takeRows(track);
    return rows ? rows * TAKE_H + 4 : 0;
  }
  function autoRows(track) { return track.showAuto ? track.auto.length + 1 : 0; }
  function laneHeight(track) {
    return LANE_H + takesHeight(track) + autoRows(track) * AUTO_H;
  }
  // The master's lanes, below the tracks, while they are shown.
  function masterHeight(project) {
    return project.showMaster ? (project.masterAuto.length + 1) * AUTO_H : 0;
  }

  // How high in its row a value of a lane is drawn, from 0 (bottom) to 1 (top).
  // A fader is drawn as it sounds, so its useful range is not squeezed at the top.
  const TOP_GAIN = Math.pow(10, 6 / 40);
  function heightOf(target, v) {
    if (target === 'volume') return v <= -60 ? 0 : Math.pow(10, v / 40) / TOP_GAIN;
    if (target === 'pan') return (v + 1) / 2;
    return v;
  }
  function valueAtHeight(target, f) {
    const k = Math.max(0, Math.min(1, f));
    if (target === 'volume') return k <= Math.pow(10, -60 / 40) / TOP_GAIN ? -60 : Math.max(-60, Math.min(6, 40 * Math.log10(k * TOP_GAIN)));
    if (target === 'pan') return Math.round((k * 2 - 1) * 100) / 100;
    return k;
  }
  // A lane's value in words: "-6.0 dB", "L 30", "42%".
  function valueText(lane, v) {
    if (lane.target === 'volume') return v <= -60 ? '-inf dB' : (v > 0 ? '+' : '') + v.toFixed(1) + ' dB';
    if (lane.target === 'pan') return Math.abs(v) < 0.005 ? 'Centre' : (v < 0 ? 'L ' : 'R ') + Math.round(Math.abs(v) * 100);
    return Math.round(v * 100) + '%';
  }

  function create(canvas, host) {
    const g = canvas.getContext('2d');
    let drag = null;
    let width = 0, height = 0;

    function theme() {
      const cs = global.getComputedStyle(global.document.documentElement);
      const v = name => cs.getPropertyValue(name).trim();
      return {
        bg: v('--bg'), surface: v('--surface'), surface2: v('--surface-2'), line: v('--line'), line2: v('--line-2'),
        ink: v('--ink'), ink2: v('--ink-2'), muted: v('--muted'), accent: v('--accent'), accent2: v('--accent-2'), tense: v('--tense'),
      };
    }

    // Where each track's lane begins, from the top of the canvas, where the
    // master's lanes begin, and where it all ends.
    function lanes(project) {
      const tops = [];
      let y = TOP;
      project.tracks.forEach(t => { tops.push(y); y += laneHeight(t); });
      return { tops, master: y, bottom: y + masterHeight(project) };
    }

    function resize() {
      const st = host.state();
      const dpr = global.devicePixelRatio || 1;
      width = Math.max(200, canvas.parentElement.clientWidth);
      height = lanes(st.project).bottom + 1;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Where the view is scrolled to and how far it is zoomed: read once a
    // frame while drawing, and afresh for every gesture.
    let view = null;
    const viewNow = () => view || { scroll: host.state().scrollBeat, ppb: host.state().pxPerBeat };
    const beatToX = beat => { const v = viewNow(); return (beat - v.scroll) * v.ppb; };
    const xToBeat = x => { const v = viewNow(); return x / v.ppb + v.scroll; };
    const snapBeat = beat => host.snapBeat(beat);

    // The track under a height on the canvas: { track, index, top } or null.
    function laneAt(project, y) {
      const { tops } = lanes(project);
      for (let i = tops.length - 1; i >= 0; i--) {
        if (y >= tops[i]) return y < tops[i] + laneHeight(project.tracks[i]) ? { track: project.tracks[i], index: i, top: tops[i] } : null;
      }
      return null;
    }

    // A row of automation under the pointer: { lane, top, track } (track null for the master), or null.
    function autoAt(project, y) {
      const where = lanes(project);
      if (y >= where.master && y < where.bottom) {
        const row = Math.floor((y - where.master) / AUTO_H);
        const lane = project.masterAuto[row];
        return lane ? { lane, top: where.master + row * AUTO_H, track: null } : { lane: null };
      }
      const at = laneAt(project, y);
      if (!at || !at.track.showAuto) return null;
      const first = at.top + LANE_H + takesHeight(at.track);
      if (y < first) return null;
      const row = Math.floor((y - first) / AUTO_H);
      const lane = at.track.auto[row];
      return lane ? { lane, top: first + row * AUTO_H, track: at.track } : { lane: null };
    }
    // The point of a lane within reach of (x, y), as its index, or -1.
    function pointAt(row, x, y) {
      const lane = row.lane;
      return lane.points.findIndex(q => Math.abs(beatToX(q.b) - x) <= NEAR &&
        Math.abs(row.top + AUTO_H - 5 - heightOf(lane.target, q.v) * (AUTO_H - 10) - y) <= NEAR);
    }
    const valueAtY = (row, y) => valueAtHeight(row.lane.target, (row.top + AUTO_H - 5 - y) / (AUTO_H - 10));

    function hit(x, y) {
      const st = host.state();
      if (y < RIBBON_H) return { zone: 'ribbon' };
      if (y < TOP) return { zone: 'ruler' };
      const row = autoAt(st.project, y);
      if (row) return row.lane ? { zone: 'auto', row, point: pointAt(row, x, y) } : { zone: 'empty' };
      const lane = laneAt(st.project, y);
      if (!lane) return { zone: 'empty' };
      const { track, index, top } = lane;
      const beat = xToBeat(x);
      const covering = clip => beat >= clip.start && beat < clip.start + clip.length;
      // A take row: the clip there, and which take the row is.
      if (y >= top + LANE_H) {
        const row = Math.floor((y - top - LANE_H - 2) / TAKE_H);
        for (let i = track.clips.length - 1; i >= 0; i--) {
          const clip = track.clips[i];
          if (covering(clip) && row >= 0 && row < P().takesOf(clip).length) return { zone: 'take', track, index, clip, take: row };
        }
        return { zone: 'lane', track, index, clip: null };
      }
      // Later clips draw on top, so search from the end.
      for (let i = track.clips.length - 1; i >= 0; i--) {
        const clip = track.clips[i];
        const x0 = beatToX(clip.start), x1 = beatToX(clip.start + clip.length);
        if (x < x0 - (clip.audioId ? HANDLE : 0) || x >= x1 + (clip.audioId ? HANDLE : 0)) continue;
        // The fade handles sit along the top of an audio clip.
        if (clip.audioId && y - top < 4 + 13) {
          const fin = beatToX(clip.start + clip.fadeIn), fout = beatToX(clip.start + clip.length - clip.fadeOut);
          if (Math.abs(x - fin) <= HANDLE) return { zone: 'lane', track, index, clip, part: 'fadeIn' };
          if (Math.abs(x - fout) <= HANDLE) return { zone: 'lane', track, index, clip, part: 'fadeOut' };
        }
        if (!covering(clip)) continue;
        const part = x1 - x <= EDGE ? 'end' : x - x0 <= EDGE && clip.length * st.pxPerBeat > EDGE * 3 ? 'start' : 'body';
        return { zone: 'lane', track, index, clip, part };
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

    // A take's waveform between two beats, centred on `mid`. False if its recording is missing.
    function wave(project, clip, take, from, to, mid, half) {
      const a = Math.max(0, beatToX(from)), b = Math.min(width, beatToX(to));
      let found = false;
      for (let x = a; x < b; x += 2) {
        const s0 = P().takeAt(project, clip, take, xToBeat(x));
        const s1 = P().takeAt(project, clip, take, xToBeat(Math.min(b, x + 2)));
        const peak = host.peakBetween(take.audioId, s0, s1);
        if (peak < 0) return false;
        found = true;
        if (s1 <= 0) continue;
        const amp = Math.max(0.5, Math.min(1, peak * clip.gain) * half);
        g.fillRect(x, mid - amp, 1.5, amp * 2);
      }
      return found || b <= a;
    }

    function drawClip(project, track, clip, y, c, selected) {
      const st = host.state();
      const x = beatToX(clip.start);
      const w = Math.max(3, clip.length * st.pxPerBeat - 1);
      if (x > width || x + w < 0) return;
      const top = y + 4, h = LANE_H - 9;

      const base = g.globalAlpha;                    // a muted track is drawn faint
      // An audio clip hides whatever it lies over, as only it is heard there.
      if (clip.audioId) {
        g.fillStyle = c.bg;
        g.beginPath();
        g.roundRect(x, top, w, h, 4);
        g.fill();
      }
      g.globalAlpha = base * (selected ? 0.3 : 0.16);
      g.fillStyle = track.color;
      g.beginPath();
      g.roundRect(x, top, w, h, 4);
      g.fill();
      g.globalAlpha = base;
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
        // Each stretch drawn from the take that plays there.
        const takes = P().takesOf(clip);
        g.globalAlpha = 0.85;
        let whole = true;
        P().compRegions(clip).forEach(r => {
          whole = wave(project, clip, takes[r.take], clip.start + r.from, clip.start + r.to, bodyTop + bodyH / 2, bodyH / 2) && whole;
        });
        if (!whole) label('recording not found', x + 6, bodyTop + 12, w - 10, c.muted);
        // Where the takes change, a thin mark.
        g.globalAlpha = 0.7;
        g.fillStyle = c.ink2;
        P().compRegions(clip).slice(1).forEach(r => g.fillRect(beatToX(clip.start + r.from), top + 14, 1, h - 14));
        g.globalAlpha = 1;
        drawFades(clip, x, w, top, h, c, selected);
      }
      g.restore();
      g.globalAlpha = 1;
      const takes = clip.audioId ? P().takesOf(clip).length : 1;
      const name = (clip.name || (clip.notes ? 'Clip' : 'Take')) + (takes > 1 ? `  ·  ${takes} takes` : '');
      label(name, x + 6 + (clip.audioId && clip.fadeIn > 0 ? 6 : 0), top + 12, w - 14, c.ink);
    }

    // The fade curves over an audio clip, and the handles that set them.
    function drawFades(clip, x, w, top, h, c, selected) {
      const ppb = host.state().pxPerBeat;
      const fin = clip.fadeIn * ppb, fout = clip.fadeOut * ppb;
      g.strokeStyle = c.ink2;
      g.lineWidth = 1.2;
      g.globalAlpha = 0.8;
      const curve = (x0, x1, rising) => {
        g.beginPath();
        for (let k = 0; k <= 16; k++) {
          const f = k / 16;
          const level = Math.sin((rising ? f : 1 - f) * Math.PI / 2);
          g.lineTo(x0 + (x1 - x0) * f, top + h - level * (h - 3));
        }
        g.stroke();
      };
      if (fin > 1) {
        curve(x, x + fin, true);
        g.fillStyle = c.bg;
        g.globalAlpha = 0.35;
        g.beginPath();
        g.moveTo(x, top);
        for (let k = 0; k <= 16; k++) g.lineTo(x + fin * k / 16, top + h - Math.sin(k / 16 * Math.PI / 2) * (h - 3));
        g.lineTo(x, top + h);
        g.closePath();
        g.fill();
      }
      if (fout > 1) {
        g.globalAlpha = 0.8;
        curve(x + w - fout, x + w, false);
        g.fillStyle = c.bg;
        g.globalAlpha = 0.35;
        g.beginPath();
        g.moveTo(x + w, top);
        for (let k = 0; k <= 16; k++) g.lineTo(x + w - fout * k / 16, top + h - Math.sin(k / 16 * Math.PI / 2) * (h - 3));
        g.lineTo(x + w, top + h);
        g.closePath();
        g.fill();
      }
      // The handles: small squares on the top edge, at the end of each fade.
      g.globalAlpha = selected ? 1 : 0.55;
      g.fillStyle = selected ? c.accent : c.ink2;
      const size = selected ? 7 : 5;
      g.fillRect(x + fin - size / 2, top - size / 2 + 1, size, size);
      g.fillRect(x + w - fout - size / 2, top - size / 2 + 1, size, size);
      g.globalAlpha = 1;
    }

    // The rows of takes beneath a track: each take's waveform under every
    // clip that has it, lit where that take is the one in use.
    function drawTakeRows(project, track, y, c) {
      const rows = takeRows(track);
      if (!rows) return;
      const st = host.state();
      for (let k = 0; k < rows; k++) {
        const ry = y + LANE_H + 2 + k * TAKE_H;
        g.fillStyle = c.line;
        g.globalAlpha = 0.5;
        g.fillRect(0, ry + TAKE_H - 1, width, 1);
        g.globalAlpha = 1;
        track.clips.forEach(clip => {
          const takes = P().takesOf(clip);
          if (k >= takes.length) return;
          const x = beatToX(clip.start), w = clip.length * st.pxPerBeat;
          if (x > width || x + w < 0) return;
          g.save();
          g.beginPath();
          g.rect(x, ry + 1, w, TAKE_H - 3);
          g.clip();
          // Where this take is the one heard, it is lit.
          P().compRegions(clip).forEach(r => {
            g.globalAlpha = r.take === k ? 0.32 : 0.07;
            g.fillStyle = r.take === k ? c.accent : track.color;
            g.fillRect(beatToX(clip.start + r.from), ry + 1, (r.to - r.from) * st.pxPerBeat, TAKE_H - 3);
          });
          g.globalAlpha = 0.75;
          g.fillStyle = track.color;
          wave(project, clip, takes[k], clip.start, clip.start + clip.length, ry + TAKE_H / 2, TAKE_H / 2 - 4);
          g.restore();
          g.globalAlpha = 1;
          label('Take ' + (k + 1), Math.max(x, 0) + 5, ry + 12, Math.min(w, 70), c.ink2, '600 10px Inter, sans-serif');
        });
      }
    }

    // One row of automation: the line it follows across the view, its points,
    // and its name. A lane switched off is drawn faint.
    function drawAutoRow(lane, top, color, c) {
      g.fillStyle = c.surface2;
      g.globalAlpha = 0.55;
      g.fillRect(0, top, width, AUTO_H);
      g.globalAlpha = 1;
      g.fillStyle = c.line;
      g.fillRect(0, top + AUTO_H - 1, width, 1);
      const yOf = v => top + AUTO_H - 5 - heightOf(lane.target, v) * (AUTO_H - 10);
      if (lane.target === 'pan') {
        g.globalAlpha = 0.5;
        g.fillRect(0, Math.round(yOf(0)), width, 1);
        g.globalAlpha = 1;
      }
      if (lane.points.length) {
        g.globalAlpha = lane.on ? 1 : 0.35;
        g.strokeStyle = color;
        g.lineWidth = 1.6;
        g.beginPath();
        for (let x = 0; x <= width; x += 3) {
          const y = yOf(global.DawProject.laneValue(lane, xToBeat(x)));
          if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
        g.fillStyle = color;
        lane.points.forEach((q, i) => {
          const x = beatToX(q.b);
          if (x < -NEAR || x > width + NEAR) return;
          const held = drag && drag.kind === 'point' && drag.lane === lane && drag.index === i;
          g.beginPath();
          g.arc(x, yOf(q.v), held ? 4.5 : 3.2, 0, Math.PI * 2);
          g.fill();
          if (held) label(valueText(lane, q.v), Math.min(width - 70, x + 8), Math.max(top + 12, yOf(q.v) - 4), 70, c.ink, '600 10px Inter, sans-serif');
        });
        g.globalAlpha = 1;
      }
      label(lane.points.length ? lane.name : lane.name + ': click to put a point down', 6, top + 12,
        lane.points.length ? 200 : 320, lane.points.length ? c.ink2 : c.muted, '600 10px Inter, sans-serif');
    }

    function drawAutoRows(project, track, top, c) {
      if (!track.showAuto) return;
      const first = top + LANE_H + takesHeight(track);
      track.auto.forEach((lane, i) => drawAutoRow(lane, first + i * AUTO_H, track.color, c));
    }

    function draw() {
      view = null;
      const st = host.state();
      view = { scroll: st.scrollBeat, ppb: st.pxPerBeat };
      try { paint(st); } finally { view = null; }
    }

    function paint(st) {
      const c = theme();
      const p = st.project;
      const ppb = st.pxPerBeat;
      const { tops, bottom } = lanes(p);
      g.clearRect(0, 0, width, height);
      g.fillStyle = c.bg;
      g.fillRect(0, 0, width, height);

      const firstBeat = Math.max(0, Math.floor(st.scrollBeat));
      const lastBeat = Math.ceil(xToBeat(width));

      // Section ribbon: the song's form is the ruler.
      const end = Math.max(P().endBeat(p), lastBeat);
      p.markers.forEach((m, i) => {
        const x0 = beatToX(m.beat);
        const x1 = beatToX(i + 1 < p.markers.length ? p.markers[i + 1].beat : end);
        if (x1 < 0 || x0 > width) return;
        const looped = p.loop.on && Math.abs(p.loop.start - m.beat) < 1e-6 &&
          Math.abs(p.loop.end - (i + 1 < p.markers.length ? p.markers[i + 1].beat : P().endBeat(p))) < 1e-6;
        g.fillStyle = looped ? c.accent2 : (i % 2 ? c.surface : c.surface2);
        g.fillRect(x0, 0, x1 - x0, RIBBON_H);
        g.fillStyle = c.line;
        g.fillRect(x0, 0, 1, RIBBON_H);
        label(m.name, Math.max(x0, 0) + 7, 16, x1 - Math.max(x0, 0) - 10, looped ? c.ink : c.ink2, '600 11px Inter, sans-serif');
      });

      // Bar ruler: the bars are as long as the time signature makes them.
      g.fillStyle = c.surface;
      g.fillRect(0, RIBBON_H, width, RULER_H);
      const bars = P().barsBetween(p, P().positionAt(p, firstBeat).start, lastBeat + 1);
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
      P().stretches(p).forEach((s, i, all) => {
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
      // The punch range: a red band along the foot of the ruler.
      const punch = p.punch || {};
      if (punch.end > punch.start) {
        g.globalAlpha = punch.on ? 0.75 : 0.22;
        g.fillStyle = c.tense;
        g.fillRect(beatToX(punch.start), TOP - 4, (punch.end - punch.start) * ppb, 4);
        g.globalAlpha = 1;
      }

      // Lanes and their grid.
      p.tracks.forEach((track, i) => {
        const y = tops[i], h = laneHeight(track);
        g.fillStyle = track.id === st.sel.trackId ? c.surface : c.bg;
        g.fillRect(0, y, width, h);
        if (h > LANE_H) {
          g.fillStyle = c.surface2;
          g.globalAlpha = 0.45;
          g.fillRect(0, y + LANE_H, width, h - LANE_H);
          g.globalAlpha = 1;
        }
        g.fillStyle = c.line;
        g.fillRect(0, y + h - 1, width, 1);
      });
      const lanesH = bottom - TOP;
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
      if (punch.on && punch.end > punch.start) {
        g.globalAlpha = 0.06;
        g.fillStyle = c.tense;
        g.fillRect(beatToX(punch.start), TOP, (punch.end - punch.start) * ppb, lanesH);
        g.globalAlpha = 1;
      }

      p.tracks.forEach((track, i) => {
        const y = tops[i];
        g.globalAlpha = track.mute ? 0.45 : 1;
        track.clips.forEach(clip => drawClip(p, track, clip, y, c, clip.id === st.sel.clipId));
        g.globalAlpha = track.mute ? 0.45 : 1;
        drawTakeRows(p, track, y, c);
        g.globalAlpha = 1;
        drawAutoRows(p, track, y, c);
      });
      // The master's lanes, under everything.
      if (p.showMaster) {
        const where = lanes(p);
        g.fillStyle = c.surface;
        g.fillRect(0, where.master, width, where.bottom - where.master);
        p.masterAuto.forEach((lane, i) => drawAutoRow(lane, where.master + i * AUTO_H, c.accent, c));
        g.fillStyle = c.line2;
        g.fillRect(0, where.master, width, 1);
      }

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
        drag = { kind: e.shiftKey ? 'punch' : 'ruler', x: pt.x, from: snapBeat(xToBeat(pt.x)), moved: false };
        return;
      }
      if (h.zone === 'auto') {
        // A point is grabbed, or put down where the pointer is and grabbed.
        let index = h.point, made = false;
        if (index < 0) {
          index = P().setPoint(h.row.lane, snapBeat(xToBeat(pt.x)), valueAtY(h.row, pt.y));
          made = index >= 0;
        }
        if (index >= 0) drag = { kind: 'point', lane: h.row.lane, row: h.row, index, moved: made };
        host.actions.redraw();
        return;
      }
      if (h.zone === 'take') {
        host.actions.select(h.track.id, h.clip.id);
        drag = { kind: 'comp', clip: h.clip, take: h.take, x: pt.x, from: xToBeat(pt.x), base: JSON.stringify(h.clip.comp || null), moved: false };
        return;
      }
      if (h.zone !== 'lane') return;
      host.actions.select(h.track.id, h.clip ? h.clip.id : null);
      if (h.clip) {
        const kinds = { fadeIn: 'fadeIn', fadeOut: 'fadeOut', start: 'trim', end: 'resize', body: 'move' };
        drag = { kind: kinds[h.part] || 'move', clip: h.clip, grab: xToBeat(pt.x) - h.clip.start, moved: false };
      }
    });

    canvas.addEventListener('pointermove', e => {
      const pt = point(e);
      const st = host.state();
      if (!drag) {
        const h = hit(pt.x, pt.y);
        canvas.style.cursor = h.zone === 'ruler' ? 'text' : h.zone === 'ribbon' ? 'pointer' : h.zone === 'take' ? 'copy'
          : h.zone === 'auto' ? (h.point >= 0 ? 'move' : 'crosshair')
          : !h.clip ? 'default' : h.part === 'fadeIn' || h.part === 'fadeOut' ? 'col-resize'
            : h.part === 'start' || h.part === 'end' ? 'ew-resize' : 'grab';
        return;
      }
      if (drag.kind === 'ruler' || drag.kind === 'punch') {
        if (Math.abs(pt.x - drag.x) > 4) drag.moved = true;
        if (drag.moved) {
          const to = snapBeat(xToBeat(pt.x));
          host.actions[drag.kind === 'punch' ? 'previewPunch' : 'previewLoop'](Math.min(drag.from, to), Math.max(drag.from, to));
        }
        return;
      }
      if (drag.kind === 'point') {
        drag.index = P().movePoint(drag.lane, drag.index, snapBeat(xToBeat(pt.x)), valueAtY(drag.row, pt.y));
        drag.moved = true;
        host.actions.redraw();
        return;
      }
      if (drag.kind === 'comp') {
        if (Math.abs(pt.x - drag.x) > 4) drag.moved = true;
        if (!drag.moved) return;
        const clip = drag.clip;
        const base = JSON.parse(drag.base);
        if (base) clip.comp = base; else delete clip.comp;
        const a = snapBeat(drag.from) - clip.start, b = snapBeat(xToBeat(pt.x)) - clip.start;
        P().setComp(clip, Math.min(a, b), Math.max(a, b), drag.take);
        host.actions.redraw();
        return;
      }
      const clip = drag.clip;
      if (drag.kind === 'move') {
        const start = snapBeat(xToBeat(pt.x) - drag.grab);
        const over = laneAt(st.project, pt.y);
        const before = clip.start;
        const home = P().findClip(st.project, clip.id).track.id;
        P().moveClip(st.project, clip.id, start, over ? over.track.id : undefined);
        const now = P().findClip(st.project, clip.id).track.id;
        if (clip.start !== before || now !== home) {
          drag.moved = true;
          if (now !== home) host.actions.select(now, clip.id);
          host.actions.redraw();
        }
      } else if (drag.kind === 'resize') {
        const min = host.gridStep(clip.start);
        const length = Math.max(min, snapBeat(xToBeat(pt.x)) - clip.start);
        if (length !== clip.length) {
          P().resizeClip(st.project, clip.id, length);
          drag.moved = true;
          host.actions.redraw();
        }
      } else if (drag.kind === 'trim') {
        const before = clip.start;
        P().trimStart(st.project, clip.id, snapBeat(xToBeat(pt.x)));
        if (clip.start !== before) { drag.moved = true; host.actions.redraw(); }
      } else if (drag.kind === 'fadeIn' || drag.kind === 'fadeOut') {
        const beat = xToBeat(pt.x);
        const want = drag.kind === 'fadeIn' ? beat - clip.start : clip.start + clip.length - beat;
        P().setFade(clip, drag.kind === 'fadeIn' ? 'in' : 'out', Math.max(0, want));
        drag.moved = true;
        host.actions.redraw();
      }
    });

    function release() {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.kind === 'ruler') {
        if (d.moved) host.actions.commitLoop();
        else host.actions.seek(d.from);
      } else if (d.kind === 'punch') {
        if (d.moved) host.actions.commitPunch();
        else host.actions.seek(d.from);
      } else if (d.kind === 'point') {
        if (d.moved) host.actions.commit();
        else host.actions.redraw();
      } else if (d.kind === 'comp') {
        // A click without a drag uses the take for the stretch under the pointer.
        if (!d.moved) {
          const at = d.from - d.clip.start;
          const region = P().compRegions(d.clip).find(r => at >= r.from && at < r.to);
          if (region) P().setComp(d.clip, region.from, region.to, d.take);
        }
        host.actions.commit();
      } else if (d.moved) {
        if (d.kind === 'move' && d.clip.audioId) {
          const found = P().findClip(host.state().project, d.clip.id);
          if (found) P().raiseClip(host.state().project, d.clip.id);   // a clip put down on another is the one heard
        }
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
      // On a take row: that take all the way through.
      if (h.zone === 'take') { P().useTake(h.clip, h.take); host.actions.commit(); return; }
      // On a point of automation: away with it.
      if (h.zone === 'auto') {
        if (h.point >= 0 && P().removePoint(h.row.lane, h.point)) host.actions.commit();
        return;
      }
      if (h.zone !== 'lane') return;
      if (h.clip) host.actions.openClip(h.track.id, h.clip.id);
      else if (h.track.kind !== 'audio') host.actions.createClip(h.track.id, xToBeat(pt.x));
    });

    // Right-click on a point of automation takes it away.
    canvas.addEventListener('contextmenu', e => {
      const pt = point(e);
      const h = hit(pt.x, pt.y);
      if (h.zone !== 'auto') return;
      e.preventDefault();
      if (h.point >= 0 && P().removePoint(h.row.lane, h.point)) host.actions.commit();
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

  global.DawArrange = { create, laneHeight, takesHeight, masterHeight, takeRows, valueText, RIBBON_H, RULER_H, LANE_H, TAKE_H, AUTO_H, TOP };
})(typeof window !== 'undefined' ? window : globalThis);
