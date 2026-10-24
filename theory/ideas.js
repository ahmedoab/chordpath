/* ChordPath — theory/ideas.js
 * Ideas a writer can try, for them to keep or throw away: chord progressions
 * that lean towards a feeling or that well-known songs are built on, strums
 * and grooves made for the section's time, other times to hear it in, and
 * melody shapes to sing over it. Nothing here writes a song. Every idea is
 * played in the writer's own key and time, and only goes into the section
 * when they choose to use it.
 */
(function (global) {
  'use strict';

  // Progressions heard in well-known songs, written as numerals so they can
  // be played in any key. mode is the kind of key each one belongs to.
  const FAMOUS = [
    { roman: 'I-V-vi-IV', mode: 'major', name: 'The four chords of pop',
      songs: [['Let It Be', 'The Beatles'], ['With or Without You', 'U2'], ['Someone Like You', 'Adele']],
      tip: 'Home, lift, a sad turn, then round again. So familiar it is almost invisible, which leaves the melody and the words to do the work.' },
    { roman: 'vi-IV-I-V', mode: 'major', name: 'The same four, starting sad',
      songs: [['Zombie', 'The Cranberries'], ['Numb', 'Linkin Park']],
      tip: 'The pop four started on the minor chord: it sounds like a minor song that keeps reaching for the light.' },
    { roman: 'I-vi-IV-V', mode: 'major', name: 'The fifties progression',
      songs: [['Stand by Me', 'Ben E. King'], ['Every Breath You Take', 'The Police'], ['Earth Angel', 'The Penguins']],
      tip: 'Doo-wop\'s loop: warm, a little nostalgic, and it always wants to come round once more.' },
    { roman: 'I-IV-V', mode: 'major', name: 'Three chords',
      songs: [['Twist and Shout', 'The Beatles'], ['La Bamba', 'Ritchie Valens'], ['Wild Thing', 'The Troggs']],
      tip: 'The bones of rock and roll, folk and country. Plain on paper; everything comes from how it is played.' },
    { roman: 'I-bVII-IV', mode: 'major', name: 'The flat seven',
      songs: [['Sweet Home Alabama', 'Lynyrd Skynyrd']],
      tip: 'A chord borrowed from outside the key gives a major loop a swagger it cannot get on its own.' },
    { roman: 'I-bVII-IV-I', mode: 'major', name: 'The long ending',
      songs: [['Hey Jude (the na-na-na ending)', 'The Beatles']],
      tip: 'The flat seven again, landing home each time round: made for singing along, over and over.' },
    { roman: 'I-ii-IV-I', mode: 'major', name: 'Up the stairs and home',
      songs: [['What\'s Up?', '4 Non Blondes']],
      tip: 'Each chord a step further from home before it falls back: open, strummy, made for a big voice.' },
    { roman: 'I-III-IV-iv', mode: 'major', name: 'Major, then the floor drops',
      songs: [['Creep', 'Radiohead']],
      tip: 'The third chord is major where you expect minor, and the last turns minor where you expect major. Both surprises hurt.' },
    { roman: 'IV-iv-I', mode: 'major', name: 'The four that turns minor',
      songs: [['In My Life', 'The Beatles']],
      tip: 'Changing one note of the four chord turns it minor, and the way home becomes a sigh.' },
    { roman: 'I-V-vi-iii-IV-I-IV-V', mode: 'major', name: 'Pachelbel\'s Canon',
      songs: [['Canon in D', 'Pachelbel'], ['Basket Case (verse)', 'Green Day']],
      tip: 'A slow walk down and back up again. Eight chords, so a line can stretch out over it.' },
    { roman: 'vi-ii-V-I', mode: 'major', name: 'Round the circle of fifths',
      songs: [['Fly Me to the Moon', 'Bart Howard']],
      tip: 'Each chord pulls into the next until it lands home: the move under countless standards.' },
    { roman: 'I-vi-ii-V', mode: 'major', name: 'The turnaround',
      songs: [['I Got Rhythm', 'George Gershwin']],
      tip: 'A loop built to send you back to the start, fast. Swing it, or slow it down for a ballad.' },
    { roman: 'I-Imaj7-I7-IV', mode: 'major', name: 'A line falling inside a chord',
      songs: [['Something', 'The Beatles']],
      tip: 'One note of the home chord slides down a step at a time until it opens into the four.' },
    { roman: 'I-I-I-I-IV-IV-I-I-V-IV-I-V', mode: 'major', name: 'Twelve-bar blues',
      songs: [['Johnny B. Goode', 'Chuck Berry'], ['Sweet Home Chicago', 'Robert Johnson']],
      tip: 'Twelve bars that every blues, and a good deal of rock and roll, is built on. Try it with sevenths.' },

    { roman: 'i-bVII-bVI-V', mode: 'minor', name: 'The Andalusian cadence',
      songs: [['Hit the Road Jack', 'Ray Charles'], ['Stray Cat Strut', 'Stray Cats']],
      tip: 'Four steps down to a major five: Spanish, dramatic, and it falls back to the top by itself.' },
    { roman: 'i-bVI-bIII-bVII', mode: 'minor', name: 'The four chords, in minor',
      songs: [['Save Tonight', 'Eagle-Eye Cherry'], ['Zombie', 'The Cranberries']],
      tip: 'The same four chords as the pop loop, heard from the minor side: driving and bittersweet.' },
    { roman: 'i-bIII-bVII-IV', mode: 'minor', name: 'A minor song with a bright four',
      songs: [['Mad World', 'Tears for Fears']],
      tip: 'The major four is borrowed from Dorian: it lets a little light into a dark loop.' },
    { roman: 'i-bVII-bVI-bVII', mode: 'minor', name: 'Down and back',
      songs: [['All Along the Watchtower', 'Bob Dylan, Jimi Hendrix']],
      tip: 'Two steps down and one back up, without ever going home properly: restless and full of menace.' },
    { roman: 'i-IV', mode: 'minor', name: 'The Dorian vamp',
      songs: [['Oye Como Va', 'Santana'], ['Evil Ways', 'Santana']],
      tip: 'Two chords and a groove. The major four keeps a minor key from feeling sad.' },
    { roman: 'i-bIII-IV-bVI', mode: 'minor', name: 'The rising sun',
      songs: [['House of the Rising Sun', 'The Animals']],
      tip: 'Climbs from the minor home through two major chords: ancient-sounding, made for 6/8 and a picked guitar.' },
    { roman: 'i-V-bVII-IV-bVI-bIII-iv-V', mode: 'minor', name: 'The long minor descent',
      songs: [['Hotel California', 'Eagles']],
      tip: 'Eight chords falling in fifths with a major five to pull it back: room for a whole story in one loop.' },
    { roman: 'i7-IV7', mode: 'minor', name: 'The funk vamp',
      songs: [['Chameleon', 'Herbie Hancock']],
      tip: 'Two seventh chords and a lot of groove: play it tight and let the bass lead.' },
  ];

  const S = () => global.Scales;
  const Song = () => global.Song;
  const Mt = () => global.Meters;
  const F = () => global.Feelings;

  // ── Small helpers ────────────────────────────────────────────────────────
  function rng(seed) {
    if (global.Melody && global.Melody.rng) return global.Melody.rng(seed);
    let s = (seed >>> 0) || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function shuffled(list, rand) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  function minorKey(scale) {
    return global.ChordParse ? global.ChordParse.isMinorMode(scale) : /minor|dorian|phrygian|locrian|aeolian/.test(String(scale || ''));
  }

  // A chord's spec, with its root spelled the way the key would write it:
  // the key's own notes as the key spells them, and the borrowed flat
  // degrees (♭II, ♭III, ♭VI, ♭VII) as flats, never as sharps.
  function spell(chord, key, scale) {
    const keyPc = S().noteIndex(key);
    const pc = S().noteIndex(chord.root);
    const rel = (pc - keyPc + 12) % 12;
    const meta = S().getScaleMeta(scale);
    const inKey = (meta && meta.intervals ? meta.intervals : [0, 2, 4, 5, 7, 9, 11]).includes(rel);
    const keyFlats = key.includes('b') || S().FLAT_KEYS.has(minorKey(scale) ? key + 'm' : key);
    const flat = inKey ? keyFlats : ([1, 3, 8, 10].includes(rel) || keyFlats);
    return S().noteName(pc, flat) + ':' + chord.quality;
  }

  // ── Chord progressions ───────────────────────────────────────────────────
  // Feelings to lean the generated ideas towards: the section's own (if any)
  // most of the time, with one or two others for contrast; with none chosen,
  // one from each of several different families.
  function leanings(feelingId, role, rand, count) {
    const all = F().FEELINGS;
    if (feelingId && F().getFeeling(feelingId)) {
      const contrast = F().CONTRAST[feelingId] || {};
      const others = [contrast.chorus, contrast.bridge].filter(id => id && id !== feelingId && F().getFeeling(id));
      const home = F().getFeeling(feelingId).group;
      shuffled(all.filter(f => f.group !== home), rand).forEach(f => { if (!others.includes(f.id)) others.push(f.id); });
      const out = [];
      for (let i = 0; i < count - 2; i++) out.push(feelingId);
      return out.concat(others.slice(0, 2));
    }
    const groups = {};
    all.forEach(f => { (groups[f.group] = groups[f.group] || []).push(f); });
    return shuffled(Object.keys(groups), rand).slice(0, count)
      .map(g => groups[g][Math.floor(rand() * groups[g].length)].id);
  }

  // [{ kind: 'feeling' | 'song', specs, label, tip, ... }]: a handful of
  // progressions for the section, in its key. A seed gives the same handful
  // again; another seed, others.
  function progressions(song, section, opts) {
    opts = opts || {};
    const seed = opts.seed || 1;
    const rand = rng(seed * 7919 + 13);
    const key = Song().sectionKey(song, section);
    const scale = song.scale;
    const role = (section && section.role) || 'verse';
    const out = [];
    const seen = new Set();
    const add = idea => {
      const sig = idea.specs.join(' ');
      if (idea.specs.length < 2 || seen.has(sig)) return false;
      seen.add(sig);
      out.push(idea);
      return true;
    };

    leanings(Song().sectionFeeling(song, section), role, rand, opts.feelings || 5).forEach((feelingId, i) => {
      const feeling = F().getFeeling(feelingId);
      for (let attempt = 0; attempt < 6; attempt++) {
        const chords = F().buildProgression({
          key, scale, feelingId, role, genreId: song.genreId,
          seed: ((seed * 131 + i * 977 + attempt * 7919) & 0xffff) || 1,
        });
        const idea = { kind: 'feeling', feelingId, specs: chords.map(c => spell(c, key, scale)), label: feeling.name, tip: feeling.vibe };
        if (add(idea)) break;
      }
    });

    const mode = minorKey(scale) ? 'minor' : 'major';
    const famous = shuffled(FAMOUS.filter(f => f.mode === mode), rand);
    let taken = 0;
    for (const f of famous) {
      if (taken >= (opts.songs || 3)) break;
      const chords = global.ChordParse.parseRoman(f.roman, key, scale);
      const [title, artist] = f.songs[Math.floor(rand() * f.songs.length)];
      const idea = {
        kind: 'song', roman: f.roman, mode: f.mode, specs: chords.map(c => c.spec), label: f.name, tip: f.tip,
        song: { title, artist }, songs: f.songs.map(([t, a]) => ({ title: t, artist: a })),
      };
      if (add(idea)) taken++;
    }
    return out;
  }

  // ── Rhythms, grooves and times ───────────────────────────────────────────
  function meterOf(song, section) { return Mt().id(Song().sectionMeter(song, section)); }

  // The strum and picking charts made for the section's time.
  function rhythms(song, section) { return Mt().rhythmsFor(meterOf(song, section)); }

  // The grooves made for the section's time, after the choice of none at all.
  function grooves(song, section) {
    const meter = meterOf(song, section);
    return [{ id: '', meter, name: 'No drums', tip: 'Just the chords and the bass: room for the voice, and for the drums to come in later.' }]
      .concat(Mt().groovesFor(meter));
  }

  // Every other time the section could be in.
  function times(song, section) {
    const meter = meterOf(song, section);
    return Mt().LIST.filter(m => m.id !== meter);
  }

  // What sort of chart a rhythm is, so moving to another time can find one like it.
  function rhythmKind(chart) {
    if (!chart) return null;
    if (/^[1-6.\-]+$/.test(chart.chords)) return 'picked';
    if (/[Uu]/.test(chart.chords)) return 'strum';
    return 'plain';
  }
  function grooveKind(groove) {
    if (!groove || typeof groove.kick !== 'string') return null;
    const hits = (groove.kick + groove.snare + groove.hat).replace(/[^xX]/g, '').length;
    return hits * 2 < Mt().stepsPerBar(groove.meter) ? 'sparse' : 'full';
  }

  // The rhythm and groove a section should take on in another time: none
  // stays none, one written for that time stays, and anything else becomes the
  // nearest of its kind there.
  function patternsFor(section, fromMeter, toMeter) {
    const to = Mt().id(toMeter);
    // Older songs write "no drums" as 'none'.
    const drums = section.drumPattern === 'none' ? '' : section.drumPattern;
    const out = { rhythmPattern: section.rhythmPattern || '', drumPattern: drums || '' };
    if (out.rhythmPattern) {
      const chart = Mt().findRhythm(out.rhythmPattern, fromMeter);
      if (!chart || chart.meter !== to) {
        const list = Mt().rhythmsFor(to);
        const kind = rhythmKind(chart);
        out.rhythmPattern = (kind && list.find(r => rhythmKind(r) === kind) || list[0]).id;
      }
    }
    if (out.drumPattern) {
      const groove = Mt().findGroove(out.drumPattern, fromMeter);
      if (!groove || groove.meter !== to) {
        const list = Mt().groovesFor(to);
        const kind = grooveKind(groove);
        out.drumPattern = (kind && list.find(g => grooveKind(g) === kind) || list[0]).id;
      }
    }
    return out;
  }

  // Moves a section from one time to another, keeping its chords, its
  // chords-to-the-bar, and the sort of rhythm and groove it had.
  function adapt(section, fromMeter, toMeter) {
    if (Mt().same(fromMeter, toMeter)) return;
    Object.assign(section, patternsFor(section, fromMeter, toMeter));
    if (section.beatsPerChord) {
      const scaled = section.beatsPerChord * Mt().barQuarters(toMeter) / Mt().barQuarters(fromMeter);
      section.beatsPerChord = Math.max(0.5, Math.min(24, Math.round(scaled * 2) / 2));
    }
  }

  // Puts one section in another time ('6/8'); in the song's own time it simply follows the song again.
  function useTime(song, section, meterId) {
    const to = Mt().parse(meterId);
    if (!to) return false;
    const from = Song().sectionMeter(song, section);
    adapt(section, from, to);
    section.meterOverride = Mt().same(to, song.meter) ? null : to;
    return true;
  }

  // Puts the whole song in another time: every section that follows the
  // song's time moves with it; a section with a time of its own keeps it.
  function useSongTime(song, meterId) {
    const to = Mt().parse(meterId);
    if (!to) return false;
    const from = Mt().parse(song.meter) || { num: 4, den: 4 };
    (song.sections || []).forEach(sec => {
      if (sec.meterOverride && !Mt().same(sec.meterOverride, from)) {
        if (Mt().same(sec.meterOverride, to)) sec.meterOverride = null;
        return;
      }
      adapt(sec, from, to);
      sec.meterOverride = null;
    });
    song.meter = to;
    return true;
  }

  // ── Melody shapes ────────────────────────────────────────────────────────
  // A few vocal shapes to hum along with: { id, name, tip, seed }.
  function melodies(song, section, opts) {
    opts = opts || {};
    const seed = opts.seed || 1;
    const rand = rng(seed * 104729 + 7);
    const list = global.Arrangements.VOCAL_MELODIES;
    const role = (section && section.role) || 'verse';
    // A chorus is offered the shapes that rise; a verse, the ones that stay close.
    const suits = v => (role === 'chorus' ? /lift|hook|arch|smile/.test(v.id) : /plain|story|stepwise|speech|murmur|lilt|answer/.test(v.id));
    const first = shuffled(list.filter(suits), rand);
    const rest = shuffled(list.filter(v => !suits(v)), rand);
    return first.slice(0, 2).concat(rest).slice(0, opts.count || 4)
      .map(v => ({ id: v.id, name: v.name, tip: v.tip, seed: 1 + Math.floor(rand() * 9999) }));
  }

  global.Ideas = {
    FAMOUS,
    spell, progressions, rhythms, grooves, times, melodies,
    patternsFor, useTime, useSongTime,
  };
})(typeof window !== 'undefined' ? window : globalThis);
