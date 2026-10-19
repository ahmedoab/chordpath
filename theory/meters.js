/* ChordPath — theory/meters.js
 * Time signatures, and rhythms written for each of them.
 *
 * A song can be in any time: the familiar 4/4, the sway of 3/4 and 6/8, or
 * the off-balance pull of 5/4 and 7/8. Each time comes with strums, picked
 * patterns, bass lines and drum grooves that feel natural in it, for a writer
 * to try over their own chords and keep or throw away.
 *
 * Patterns are written as charts, one character to a sixteenth note:
 *   strums   D d  down-stroke (capital = hard)      U u  up-stroke
 *            x    muted chuck                       1–6  one string of the chord, low to high
 *            . -  let it ring
 *   bass     R    root     5 fifth     8 root an octave up     3 third
 *            >    a note leading into the next chord
 *   drums    x    a hit    X a hard hit    .  nothing
 * A chart is exactly one bar long, so it can be shown as it is played.
 */
(function (global) {
  'use strict';

  // groups: how a bar is felt, in sixteenths (6/8 is two groups of three eighths).
  const LIST = [
    { id: '4/4', num: 4, den: 4, name: 'Four-four', groups: [16],
      feel: 'Steady and open, with room for anything: the time most songs are in, so changing it is a strong move.',
      count: '1 2 3 4', examples: ['Let It Be', 'Wonderwall'] },
    { id: '3/4', num: 3, den: 4, name: 'Three-four (waltz)', groups: [12],
      feel: 'One strong beat and two light ones: lilting and swaying, tender or old-fashioned, made for slow dancing.',
      count: '1 2 3', examples: ['Piano Man', 'Moon River'] },
    { id: '2/4', num: 2, den: 4, name: 'Two-four', groups: [8],
      feel: 'Two beats and nothing to spare: punchy and forward, the time of marches, polkas and quick country.',
      count: '1 2', examples: ['polkas and marches'] },
    { id: '6/8', num: 6, den: 8, name: 'Six-eight', groups: [6, 6],
      feel: 'Two big swaying beats, each split in three: rolling ballads, sea songs, anything that rocks like a boat.',
      count: '1 2 3 4 5 6 — felt as ONE two three FOUR five six', examples: ['House of the Rising Sun', 'Nothing Else Matters'] },
    { id: '9/8', num: 9, den: 8, name: 'Nine-eight', groups: [6, 6, 6],
      feel: 'Three swaying beats, each in three: circling and dreamy, the lilt of an Irish slip jig.',
      count: '1 2 3 4 5 6 7 8 9 — felt as ONE two three FOUR five six SEVEN eight nine', examples: ['slip jigs'] },
    { id: '12/8', num: 12, den: 8, name: 'Twelve-eight', groups: [6, 6, 6, 6],
      feel: 'Four slow beats, each a triplet: the slow blues, soul ballads and doo-wop, heavy and unhurried.',
      count: '1 2 3 4 5 6 7 8 9 10 11 12 — felt as four beats of three', examples: ['At Last', 'slow blues'] },
    { id: '5/4', num: 5, den: 4, name: 'Five-four', groups: [12, 8],
      feel: 'One beat too many: off-balance and restless, felt as three then two, always about to trip.',
      count: '1 2 3 4 5 — felt as ONE two three FOUR five', examples: ['Take Five', '15 Step'] },
    { id: '7/4', num: 7, den: 4, name: 'Seven-four', groups: [16, 12],
      feel: 'A bar of four and a bar of three glued together: long and searching, it never quite settles.',
      count: '1 2 3 4 5 6 7 — felt as ONE two three four FIVE six seven', examples: ['Money', 'Solsbury Hill'] },
    { id: '7/8', num: 7, den: 8, name: 'Seven-eight', groups: [4, 4, 6],
      feel: 'Two, two, three: a limp that drives forward, the pull of Balkan dances, prog and math rock.',
      count: '1 2 3 4 5 6 7 — felt as ONE two THREE four FIVE six seven', examples: ['Bulgarian rachenitsa'] },
  ];

  // ── Charts for each time ─────────────────────────────────────────────────
  const RHYTHMS = [
    // 4/4
    { id: 'quarter_downs', meter: '4/4', name: 'Downstrokes on the beat', chords: 'D...D...D...D...', bass: 'R.......R.......',
      tip: 'Four even downstrokes a bar. Blunt on purpose: it leaves the words and the chord changes to do the work.' },
    { id: 'eighth_downups', meter: '4/4', name: 'Down-up eighths', chords: 'D.u.D.u.D.u.D.u.', bass: 'R.......5.......',
      tip: 'Down on the beat, up on the "and". The everyday strum, and the default for a reason.' },
    { id: 'folk_strum', meter: '4/4', name: 'Folk strum (D, DU, UDU)', chords: 'D...D.U...U.D.U.', bass: 'R.......5.......',
      tip: 'The hand keeps moving but skips the down-stroke on beat 3, so the off-beats pop. Campfire, folk-pop, singer-songwriter.' },
    { id: 'offbeat_chops', meter: '4/4', name: 'Off-beat chops', chords: '..x...x...x...x.', bass: 'R.....5.R.....5.',
      tip: 'Short muted chops on every "and": the guitar answers the beat instead of sitting on it. Reggae and ska; under a verse it leaves room for the voice.' },
    { id: 'three_three_two', meter: '4/4', name: 'Three-three-two push', chords: 'D..u..u.D..u..u.', bass: 'R..R..R.R..R..5.',
      tip: 'Hits that lean against the beat in threes and a two. The pulse under a lot of pop, Latin and dance music.' },
    { id: 'funk_sixteenths', meter: '4/4', name: 'Funk sixteenths', chords: 'DxuxDxuxDxuxDxux', bass: 'R..R....5..R..>.',
      tip: 'The hand never stops; most strokes are muted and only some ring. Funk and disco: play it light.' },
    { id: 'picked_four', meter: '4/4', name: 'Picked arpeggio', chords: '1.3.5.3.6.3.5.3.', bass: 'R...............',
      tip: 'Let the chord ring one string at a time. Ballads, intros, anywhere a strum would be too loud.' },
    { id: 'half_time_strum', meter: '4/4', name: 'Half-time', chords: 'D.......D...u...', bass: 'R...............',
      tip: 'Two big strokes a bar: the song feels half as fast without changing tempo. A heavy chorus or a slow-burning verse.' },
    // 3/4
    { id: 'waltz_strum', meter: '3/4', name: 'Waltz (bass, strum, strum)', chords: '....D...D...', bass: 'R...........',
      tip: 'A bass note on 1 and the chord on 2 and 3: the oom-pah-pah of every waltz. Tender, old-fashioned, swaying.' },
    { id: 'waltz_downups', meter: '3/4', name: 'Waltz with up-strokes', chords: 'D...D.u.D.u.', bass: 'R.......5...',
      tip: 'All three beats strummed, with up-strokes in between. Folk waltzes and country ballads.' },
    { id: 'waltz_picked', meter: '3/4', name: 'Picked waltz', chords: '1.3.5.3.6.3.', bass: 'R...........',
      tip: 'Six notes to the bar, one string at a time. Lullabies, or a quiet verse that turns.' },
    { id: 'three_downs', meter: '3/4', name: 'Three downstrokes', chords: 'D...D...D...', bass: 'R...5...5...',
      tip: 'Even and heavy, no lilt: where grunge and indie songs in three tend to sit.' },
    // 2/4
    { id: 'boom_chick', meter: '2/4', name: 'Boom-chick', chords: '....D...', bass: 'R.......',
      tip: 'Bass on 1, the chord on 2. Polka, old-time country, a march that smiles.' },
    { id: 'march_strum', meter: '2/4', name: 'March', chords: 'D...D...', bass: 'R...5...',
      tip: 'Two firm strokes a bar: stomps and anything that should feel like walking forward.' },
    { id: 'two_step', meter: '2/4', name: 'Two-step eighths', chords: 'D.u.D.u.', bass: 'R...5...',
      tip: 'Down-ups at a quick tempo: bluegrass and country two-step.' },
    // 6/8
    { id: 'six_eight_arpeggio', meter: '6/8', name: 'Rolling arpeggio', chords: '1.3.5.6.5.3.', bass: 'R...........',
      tip: 'Up through the chord and back down, six notes a bar: "House of the Rising Sun", "Nothing Else Matters".' },
    { id: 'six_eight_sway', meter: '6/8', name: 'Swaying strum', chords: 'D...u.D...u.', bass: 'R.....5.....',
      tip: 'Two big down-strokes a bar, each with a lift before the next: the sway of a slow ballad or a sea song.' },
    { id: 'six_eight_eighths', meter: '6/8', name: 'Six-eight eighths', chords: 'D.d.d.D.d.d.', bass: 'R.....R.....',
      tip: 'Every eighth strummed, leaning on 1 and 4. Steady and rolling.' },
    { id: 'six_eight_gallop', meter: '6/8', name: 'Gallop', chords: 'D.dud.D.dud.', bass: 'R.....5.....',
      tip: 'A quick up-stroke tucked in before beats 3 and 6: driving, galloping, Irish-folk energy.' },
    // 9/8
    { id: 'slip_jig', meter: '9/8', name: 'Slip-jig strum', chords: 'D.d.d.D.d.d.D.d.d.', bass: 'R.....5.....R.....',
      tip: 'Three groups of three, every eighth strummed: slip jigs, and anything that circles.' },
    { id: 'nine_eight_swells', meter: '9/8', name: 'Three swells', chords: 'D.....D.....D.....', bass: 'R.................',
      tip: 'One big stroke per beat, each left to ring: dreamy and wide.' },
    { id: 'nine_eight_arpeggio', meter: '9/8', name: 'Circling arpeggio', chords: '1.3.5.2.4.6.3.5.1.', bass: 'R.................',
      tip: 'A picked figure that never quite repeats inside the bar: hypnotic, a little unsettled.' },
    // 12/8
    { id: 'slow_blues_triplets', meter: '12/8', name: 'Slow-blues triplets', chords: 'D.d.d.D.d.d.D.d.d.D.d.d.', bass: 'R.....3.....5.....3.....',
      tip: 'Every triplet strummed over a walking bass: "At Last", slow blues, doo-wop.' },
    { id: 'twelve_eight_shuffle', meter: '12/8', name: 'Shuffle (long-short)', chords: 'D...d.D...d.D...d.D...d.', bass: 'R.....5.....R.....5.....',
      tip: 'The first two notes of each triplet tied together: the lope of a shuffle.' },
    { id: 'twelve_eight_ballad', meter: '12/8', name: 'Four big strokes', chords: 'D.....D.....D.....D.....', bass: 'R...........5...........',
      tip: 'One stroke per beat, left to ring: soul ballads and power ballads.' },
    // 5/4
    { id: 'five_vamp', meter: '5/4', name: 'Three-plus-two vamp', chords: 'D...d...d...D...d...', bass: 'R...........5.......',
      tip: 'Leaning on 1 and 4: the off-balance limp of "Take Five".' },
    { id: 'five_eighths', meter: '5/4', name: 'Five in eighths', chords: 'D.u.D.u.D.u.D.u.D.u.', bass: 'R.......5.......R...',
      tip: 'Plain down-ups through all five beats: the oddness comes from the bar, not the hand.' },
    { id: 'five_picked', meter: '5/4', name: 'Picked three-plus-two', chords: '1.3.5.3.5.3.1.3.5.3.', bass: 'R...........5.......',
      tip: 'A picked figure in two halves, three beats and then two.' },
    // 7/4
    { id: 'seven_four_drive', meter: '7/4', name: 'Four-plus-three', chords: 'D...d...d...d...D...d...d...', bass: 'R...............5...........',
      tip: 'Felt as a bar of four and a bar of three: "Money", "Solsbury Hill".' },
    { id: 'seven_four_eighths', meter: '7/4', name: 'Seven in eighths', chords: 'D.u.D.u.D.u.D.u.D.u.D.u.D.u.', bass: 'R...............R...........',
      tip: 'Steady down-ups across all seven beats: long and searching.' },
    { id: 'seven_four_picked', meter: '7/4', name: 'Picked seven', chords: '1.3.5.3.1.3.5.3.1.3.5.3.6.5.', bass: 'R...............5...........',
      tip: 'An arpeggio one beat short of two bars of four.' },
    // 7/8
    { id: 'seven_eight_drive', meter: '7/8', name: 'Two, two, three', chords: 'D.d.D.d.D.d.d.', bass: 'R...R...5.....',
      tip: 'Every eighth strummed, leaning where each group starts: Balkan dances, prog, math rock.' },
    { id: 'seven_eight_limp', meter: '7/8', name: 'Limp', chords: 'D...D...D...u.', bass: 'R.......5.....',
      tip: 'Three strokes, the last one longer: the bar always seems to stumble forward.' },
    { id: 'seven_eight_picked', meter: '7/8', name: 'Picked two-two-three', chords: '1.3.1.3.1.3.5.', bass: 'R.............',
      tip: 'A picked figure that stretches at the end of every bar.' },
  ];

  const GROOVES = [
    // 4/4
    { id: 'basic_rock', meter: '4/4', name: 'Basic rock beat', kick: 'x.......x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', open: '................',
      tip: 'Kick on 1 and 3, snare on 2 and 4, eighths on the hi-hat: the beat under most rock and pop.' },
    { id: 'four_floor', meter: '4/4', name: 'Four on the floor', kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', open: '................',
      tip: 'A kick on every beat with off-beat hats: dance music, disco, anything that should move a room.' },
    { id: 'half_time_beat', meter: '4/4', name: 'Half-time beat', kick: 'x.........x.....', snare: '........x.......', hat: 'x.x.x.x.x.x.x.x.', open: '................',
      tip: 'The snare waits until beat 3: big, slow and heavy. Choruses in hip-hop, metal and modern pop.' },
    { id: 'sparse_ballad', meter: '4/4', name: 'Sparse ballad', kick: 'x...............', snare: '........x.......', hat: 'x...x...x...x...', open: '................',
      tip: 'Barely there: a kick, one snare, quarter-note hats. Leaves space for a quiet verse.' },
    // 3/4
    { id: 'waltz_kit', meter: '3/4', name: 'Waltz', kick: 'x...........', snare: '....x...x...', hat: 'x...x...x...', open: '............',
      tip: 'Kick on 1, a light snare on 2 and 3.' },
    { id: 'rock_waltz', meter: '3/4', name: 'Rock waltz', kick: 'x...........', snare: '........x...', hat: 'x.x.x.x.x.x.', open: '............',
      tip: 'Kick on 1, snare on 3, eighths on the hats: a three that rocks rather than sways.' },
    { id: 'jazz_waltz', meter: '3/4', name: 'Jazz waltz', kick: 'x.......x...', snare: '....x.......', hat: 'x...x..xx...', open: '............',
      tip: 'The ride skips between the beats over a light kick and snare: the bounce of a jazz waltz.' },
    // 2/4
    { id: 'polka_beat', meter: '2/4', name: 'Polka', kick: 'x.......', snare: '....x...', hat: 'x.x.x.x.', open: '........',
      tip: 'Kick on 1, snare on 2, as fast as you dare.' },
    { id: 'march_beat', meter: '2/4', name: 'March', kick: 'x...x...', snare: '....x.x.', hat: '........', open: '........',
      tip: 'Bass drum on both beats, a snare flourish on the second.' },
    // 6/8
    { id: 'six_eight_ballad', meter: '6/8', name: '6/8 ballad', kick: 'x...........', snare: '......x.....', hat: 'x.x.x.x.x.x.', open: '............',
      tip: 'Kick on 1, snare on 4, hats on every eighth: the classic slow 6/8 beat.' },
    { id: 'six_eight_rolling', meter: '6/8', name: 'Rolling 6/8', kick: 'x...x.......', snare: '......x.....', hat: 'x.x.x.x.x.x.', open: '..........x.',
      tip: 'A busier kick that pushes into beat 4, and an open hat to close the bar.' },
    { id: 'six_eight_brushes', meter: '6/8', name: 'Almost nothing', kick: 'x...........', snare: '............', hat: 'x.....x.....', open: '............',
      tip: 'Just a kick and two hats: for a quiet verse that still sways.' },
    // 9/8
    { id: 'nine_eight_lilt', meter: '9/8', name: '9/8 lilt', kick: 'x...........x.....', snare: '......x...........', hat: 'x.x.x.x.x.x.x.x.x.', open: '..................',
      tip: 'Kick on 1 and 7, snare on 4: a gentle three in three.' },
    { id: 'nine_eight_drive', meter: '9/8', name: 'Driving 9/8', kick: 'x.....x.....x.....', snare: '....x.....x.....x.', hat: 'x.x.x.x.x.x.x.x.x.', open: '..................',
      tip: 'A kick on each of the three beats, a snare on the last eighth of each: it pushes forward.' },
    // 12/8
    { id: 'slow_blues_kit', meter: '12/8', name: 'Slow blues', kick: 'x...........x...........', snare: '......x...........x.....', hat: 'x.x.x.x.x.x.x.x.x.x.x.x.', open: '........................',
      tip: 'Snare on 2 and 4, every triplet on the hi-hat.' },
    { id: 'shuffle_kit', meter: '12/8', name: 'Shuffle', kick: 'x.....x.....x.....x.....', snare: '......x...........x.....', hat: 'x...x.x...x.x...x.x...x.', open: '........................',
      tip: 'The hi-hat skips the middle of each triplet: that skip is the shuffle.' },
    // 5/4
    { id: 'five_ride', meter: '5/4', name: 'Three-plus-two ride', kick: 'x...........x.......', snare: '........x.......x...', hat: 'x...x.x.x...x.x.x...', open: '....................',
      tip: 'Kick on 1 and 4, snare on 3 and 5: the shape of the bar made plain.' },
    { id: 'five_rock', meter: '5/4', name: 'Rock in five', kick: 'x.......x.......x...', snare: '....x.......x.......', hat: 'x.x.x.x.x.x.x.x.x.x.', open: '....................',
      tip: 'A rock beat with an extra beat at the end of every bar: it trips on purpose.' },
    // 7/4
    { id: 'seven_four_beat', meter: '7/4', name: '7/4 rock', kick: 'x.......x.......x.......x...', snare: '....x.......x.......x.......', hat: 'x.x.x.x.x.x.x.x.x.x.x.x.x.x.', open: '............................',
      tip: 'Kick and snare take turns on every beat, so bar after bar the snare lands somewhere new.' },
    { id: 'four_plus_three', meter: '7/4', name: 'Four-plus-three', kick: 'x.......x.......x...........', snare: '....x.......x.......x...x...', hat: 'x.x.x.x.x.x.x.x.x.x.x.x.x.x.', open: '............................',
      tip: 'A bar of four and a bar of three glued together: easy to feel, easy to play over.' },
    // 7/8
    { id: 'seven_eight_beat', meter: '7/8', name: 'Two, two, three', kick: 'x.......x.....', snare: '....x.....x...', hat: 'x.x.x.x.x.x.x.', open: '..............',
      tip: 'Kick, snare, kick and a long snare: a 2+2+3 you can dance to.' },
    { id: 'seven_eight_relentless', meter: '7/8', name: 'Relentless 7/8', kick: 'x...x...x.....', snare: '..x...x...x...', hat: 'x.x.x.x.x.x.x.', open: '..............',
      tip: 'A kick at the start of every group and snares in between: it never lets up.' },
  ];

  // ── Reading time signatures ──────────────────────────────────────────────
  const DENOMINATORS = [2, 4, 8, 16];

  // { num, den } from "6/8", from { num, den }, or from a list entry; null when it cannot be a time signature.
  function parse(value) {
    let num, den;
    if (value && typeof value === 'object') { num = value.num; den = value.den; }
    else if (typeof value === 'string') {
      const m = value.trim().match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/);
      if (!m) return null;
      num = parseInt(m[1], 10);
      den = parseInt(m[2], 10);
    } else return null;
    if (!Number.isInteger(num) || !Number.isInteger(den) || num < 1 || num > 32 || !DENOMINATORS.includes(den)) return null;
    return { num, den };
  }
  function id(meter) { const m = parse(meter); return m ? m.num + '/' + m.den : '4/4'; }
  function same(a, b) { return id(a) === id(b); }
  function get(meter) {
    const key = typeof meter === 'string' && !meter.includes('/') ? meter : id(meter);
    return LIST.find(m => m.id === key) || null;
  }

  function barQuarters(meter) { const m = parse(meter) || { num: 4, den: 4 }; return m.num * 4 / m.den; }
  function stepsPerBar(meter) { const m = parse(meter) || { num: 4, den: 4 }; return Math.round(m.num * 16 / m.den); }

  // How a bar is felt, in sixteenths. Times not on the list are grouped in
  // twos and threes (eighths) or whole beats (quarters), the usual way.
  function groups(meter) {
    const known = get(meter);
    if (known) return known.groups.slice();
    const m = parse(meter) || { num: 4, den: 4 };
    const unit = 16 / m.den;
    if (m.den >= 8 && m.num > 4) {
      const out = [];
      let left = m.num;
      while (left > 0) {
        const take = left === 4 ? 2 : left === 2 ? 2 : 3;
        out.push(take * unit);
        left -= take;
      }
      return out;
    }
    return [m.num * unit];
  }

  // Every felt beat of the bar: quarters in x/4, eighths in x/8; strong where a group begins.
  function pulses(meter) {
    const m = parse(meter) || { num: 4, den: 4 };
    const unit = m.den >= 8 ? 2 * (8 / m.den) : 4 * (4 / m.den);
    const starts = new Set();
    let at = 0;
    groups(m).forEach(g => { starts.add(at); at += g; });
    const out = [];
    for (let step = 0; step < stepsPerBar(m); step += unit) out.push({ step, strong: starts.has(step) });
    return out;
  }

  // What to call each sixteenth when counting the bar aloud ('' for the ones between).
  function countRow(meter) {
    const m = parse(meter) || { num: 4, den: 4 };
    const steps = stepsPerBar(m);
    const row = new Array(steps).fill('');
    if (m.den >= 8) {
      const per = 16 / m.den;
      for (let i = 0; i * per < steps; i++) row[i * per] = String(i + 1);
    } else {
      const per = 16 / m.den;
      for (let i = 0; i * per < steps; i++) {
        row[i * per] = String(i + 1);
        if (per >= 4) row[i * per + per / 2] = '&';
      }
    }
    return row;
  }

  // ── Patterns for a time ──────────────────────────────────────────────────
  function rhythm(rid) { return RHYTHMS.find(r => r.id === rid) || null; }
  function groove(gid) { return GROOVES.find(g => g.id === gid) || null; }

  // Plain patterns for a time no chart was written for: a stroke on every
  // felt beat, harder where each group starts, and a snare in each group's middle.
  function madeFor(meter) {
    const m = parse(meter) || { num: 4, den: 4 };
    const key = id(m), steps = stepsPerBar(m);
    const beats = pulses(m);
    const row = place => {
      const r = new Array(steps).fill('.');
      beats.forEach(p => { const c = place(p); if (c) r[p.step] = c; });
      return r.join('');
    };
    const middles = [];
    let at = 0;
    groups(m).forEach(g => {
      const inGroup = beats.filter(p => p.step >= at && p.step < at + g);
      if (inGroup.length >= 2) middles.push(inGroup[Math.floor(inGroup.length / 2)].step);
      at += g;
    });
    const quiet = '.'.repeat(steps);
    return {
      rhythms: [
        { id: 'pulse_' + key, meter: key, name: 'A stroke on every beat', chords: row(p => (p.strong ? 'D' : 'd')),
          bass: row(p => (p.step === 0 ? 'R' : p.strong ? '5' : null)), tip: 'Every beat strummed, harder where each group starts.' },
        { id: 'swells_' + key, meter: key, name: 'One stroke per group', chords: row(p => (p.strong ? 'D' : null)),
          bass: row(p => (p.strong ? 'R' : null)), tip: 'One stroke where each group starts, left to ring.' },
        { id: 'picked_' + key, meter: key, name: 'Picked', chords: row(p => (p.strong ? '1' : '3')),
          bass: row(p => (p.step === 0 ? 'R' : null)), tip: 'One string at a time on every beat.' },
      ],
      grooves: [
        { id: 'groove_' + key, meter: key, name: 'Plain beat', kick: row(p => (p.strong ? 'x' : null)),
          snare: row(p => (middles.includes(p.step) ? 'x' : null)), hat: row(() => 'x'), open: quiet,
          tip: 'Kick where each group starts, a snare in its middle, hats on every beat.' },
        { id: 'quiet_' + key, meter: key, name: 'Kick only', kick: row(p => (p.strong ? 'x' : null)), snare: quiet, hat: quiet, open: quiet,
          tip: 'Just the shape of the bar.' },
      ],
    };
  }

  function rhythmsFor(meter) {
    const key = id(meter);
    const written = RHYTHMS.filter(r => r.meter === key);
    return written.length ? written : madeFor(meter).rhythms;
  }
  function groovesFor(meter) {
    const key = id(meter);
    const written = GROOVES.filter(g => g.meter === key);
    return written.length ? written : madeFor(meter).grooves;
  }
  // A chart for the plain playing styles ('block', 'strum', 'arpeggio') in any time.
  function styleChart(meter, style) {
    const list = rhythmsFor(meter);
    if (style === 'arpeggio') return list.find(r => /^[1-6.\-]+$/.test(r.chords)) || list[0];
    if (style === 'strum') return list.find(r => /[Uu]/.test(r.chords)) || list[0];
    const key = id(meter), steps = stepsPerBar(meter);
    const held = new Array(steps).fill('.');
    pulses(meter).filter(p => p.strong).forEach(p => { held[p.step] = 'D'; });
    return { id: 'held_' + key, meter: key, name: 'Held chords', chords: held.join(''), bass: 'R' + '.'.repeat(steps - 1), tip: 'Each chord struck once where each group starts, and left to ring.' };
  }

  function defaultRhythm(meter) { return rhythmsFor(meter)[0].id; }
  function defaultGroove(meter) { return groovesFor(meter)[0].id; }
  // Looks a pattern up among the charts, including those made for unlisted times.
  function findRhythm(rid, meter) { return rhythm(rid) || rhythmsFor(meter).find(r => r.id === rid) || null; }
  function findGroove(gid, meter) { return groove(gid) || groovesFor(meter).find(g => g.id === gid) || null; }

  // ── Reading charts ───────────────────────────────────────────────────────
  // [{ step, kind: 'down'|'up'|'chuck'|'pick', accent, length (steps it rings), tone (pick: 1–6) }]
  function chordHits(chart) {
    const text = String(chart || '');
    const hits = [];
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      let hit = null;
      if (c === 'D' || c === 'd') hit = { step: i, kind: 'down', accent: c === 'D' };
      else if (c === 'U' || c === 'u') hit = { step: i, kind: 'up', accent: c === 'U' };
      else if (c === 'x') hit = { step: i, kind: 'chuck', accent: false };
      else if (c >= '1' && c <= '6') hit = { step: i, kind: 'pick', accent: false, tone: parseInt(c, 10) };
      if (hit) hits.push(hit);
    }
    hits.forEach((h, k) => { h.length = (k + 1 < hits.length ? hits[k + 1].step : text.length) - h.step; });
    return hits;
  }

  const DEGREES = { R: 'root', 5: 'fifth', 8: 'octave', 3: 'third', '>': 'approach' };
  // [{ step, degree: 'root'|'fifth'|'octave'|'third'|'approach', length }]
  function bassHits(chart) {
    const text = String(chart || '');
    const hits = [];
    for (let i = 0; i < text.length; i++) if (DEGREES[text[i]]) hits.push({ step: i, degree: DEGREES[text[i]] });
    hits.forEach((h, k) => { h.length = (k + 1 < hits.length ? hits[k + 1].step : text.length) - h.step; });
    return hits;
  }

  function laneSteps(chart) {
    const out = [];
    String(chart || '').split('').forEach((c, i) => { if (c === 'x' || c === 'X') out.push(i); });
    return out;
  }
  function laneAccents(chart) {
    const out = [];
    String(chart || '').split('').forEach((c, i) => { if (c === 'X') out.push(i); });
    return out;
  }

  // A strum chart as arrows, the way it is often written above a lyric.
  function arrows(chart) {
    return String(chart || '').split('').map(c => {
      if (c === 'D' || c === 'd') return '↓';
      if (c === 'U' || c === 'u') return '↑';
      if (c === 'x') return '×';
      if (c >= '1' && c <= '6') return c;
      return ' ';
    }).join('');
  }

  global.Meters = {
    LIST, RHYTHMS, GROOVES, DENOMINATORS,
    parse, id, same, get, barQuarters, stepsPerBar, groups, pulses, countRow,
    rhythm, groove, rhythmsFor, groovesFor, defaultRhythm, defaultGroove, findRhythm, findGroove, styleChart,
    chordHits, bassHits, laneSteps, laneAccents, arrows,
  };
})(typeof window !== 'undefined' ? window : globalThis);
