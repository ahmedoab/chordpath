/* ChordPath — lexicon.js
 * How the built-in AI hears a description. "Bittersweet, like driving home
 * at 3am" becomes weights over the app's feelings (wistful, lonely, …), plus
 * an energy reading and the list of words it did not recognise — those are
 * the ones Muse learns from the songs you teach it.
 */
(function (global) {
  'use strict';

  // ── Vocabulary ───────────────────────────────────────────────────────────
  // feeling id → words. "word:0.6" is a weaker association; "_" joins a
  // phrase. A word may sit under several feelings.
  const SEED = {
    yearning: 'yearning yearn longing ache aching pining pine craving crave unrequited wanting desire:0.8 ' +
      'desperate:0.6 wish wishing reaching unanswered waiting wait:0.7 miss missing:0.9 hungry:0.6 thirst:0.6 ' +
      'unresolved unfinished searching:0.7 distance:0.6 distant:0.6 far_away almost:0.5 need:0.6 needing:0.6 ' +
      'lovesick crush:0.6 heartache:0.8 want:0.7 pleading plead begging:0.7 longed hunger:0.6',
    nostalgic: 'nostalgic nostalgia memories memory remember remembering reminisce reminiscing childhood youth ' +
      'young:0.5 summer:0.6 summers:0.6 photograph photographs polaroid throwback retro:0.7 vintage:0.7 ' +
      'yesterday back_then old_days good_old_days sepia golden:0.6 hometown:0.7 teenage:0.7 highschool:0.7 ' +
      'high_school:0.7 looking_back simpler_times past:0.6 old:0.4 familiar:0.6 sentimental remembered',
    wistful: 'wistful bittersweet bitter-sweet sweet_sadness sweet_sorrow sigh sighing regret regretful:0.8 ' +
      'goodbye:0.7 farewell:0.7 autumn:0.7 fading:0.7 fade:0.6 gone:0.6 ended:0.6 ending:0.5 ' +
      'could_have_been what_if pensive reflective:0.8 thoughtful:0.6 poignant tinged:0.5 letting_go ' +
      'moving_on:0.6 sunset:0.6 dusk:0.6 mixed_feelings ambivalent wistfully',
    homesick: 'homesick homesickness home:0.8 homeward homecoming away:0.5 leaving:0.6 left_behind far_from_home ' +
      'road:0.5 travelling:0.5 traveling:0.5 touring:0.5 displaced uprooted hometown:0.6 return:0.5 ' +
      'returning:0.6 belong:0.6 belonging:0.6 roots:0.6 miles:0.5 country_road:0.7 exile exiled stranded:0.5',
    melancholic: 'melancholic melancholy sad sadness sorrow sorrowful blue blues:0.7 gloomy gloom rain:0.8 ' +
      'rainy:0.8 grey gray overcast down:0.5 low:0.4 somber sombre mournful:0.7 downcast moody:0.7 ' +
      'heavy-hearted depressing:0.8 depressed:0.8 depressive:0.8 unhappy tearful:0.7 weary:0.6 tired:0.4 ' +
      'winter:0.5 bleak:0.7 dreary subdued:0.6 minor:0.4 pensive:0.5 brooding:0.7 downbeat',
    grieving: 'grieving grief grieve mourning mourn loss lost:0.6 death dying:0.8 dead:0.8 funeral heartbroken ' +
      'heartbreak broken:0.6 devastated devastating crying cry:0.8 tears weeping weep sobbing bereaved ' +
      'tragic tragedy:0.9 breakup:0.8 break-up:0.8 goodbye:0.5 pain:0.7 painful:0.7 hurt:0.7 hurting:0.7 ' +
      'agony anguish wounded:0.7 shattered crushed:0.8 despair:0.9 inconsolable sad:0.5',
    lonely: 'lonely loneliness alone lonesome isolated isolation solitude:0.8 solitary:0.8 empty:0.7 abandoned ' +
      'deserted forsaken nobody no_one unloved:0.8 unwanted:0.8 outsider:0.7 invisible:0.7 night:0.4 ' +
      'midnight:0.5 3am:0.7 late_night:0.6 empty_room empty_streets quiet:0.3 silence:0.5 withdrawn:0.7 ' +
      'friendless stranded:0.7 sad:0.4 cold:0.4 loner',
    hollow: 'hollow numb numbness empty:0.8 emptiness void vacant blank detached dissociated dissociation ' +
      'disconnected flat:0.6 lifeless:0.8 apathetic apathy indifferent:0.8 drained:0.8 burnt_out burned_out ' +
      'burnout:0.8 exhausted:0.6 cold:0.6 frozen:0.6 nothing:0.7 meaningless nihilistic dead_inside ' +
      'zombie:0.6 washed_out:0.5 grey:0.4 gray:0.4 bleak:0.6 desolate:0.8 hollowed',
    tender: 'tender tenderness gentle soft softly intimate intimacy close:0.6 delicate fragile:0.8 ' +
      'vulnerable:0.8 caring care:0.6 kind:0.6 kindness:0.7 sweet:0.7 affection affectionate whisper ' +
      'whispered lullaby cradle:0.8 hug:0.8 embrace:0.8 holding:0.6 comforting:0.7 soothing:0.7 quiet:0.5 ' +
      'hushed sincere:0.7 heartfelt:0.8 loving:0.8 warm:0.5 bedroom:0.5',
    romantic: 'romantic romance love:0.8 in_love lover lovers swoon swooning kiss kissing slow_dance ' +
      'candlelight candlelit date:0.6 wedding:0.8 valentine passion passionate:0.9 sensual:0.9 sexy:0.8 ' +
      'seductive:0.8 smoky:0.6 velvet:0.6 moonlight:0.7 moonlit:0.7 crush:0.5 adore adoring devotion ' +
      'devoted:0.9 heart:0.4 sweetheart flirty:0.7 flirt:0.7 butterflies:0.8 infatuated infatuation lush:0.5',
    serene: 'serene serenity calm calming peaceful peace at_peace tranquil tranquility still stillness placid ' +
      'restful relaxed:0.9 relaxing:0.9 meditative meditation zen quiet:0.5 soothing:0.6 ambient:0.7 ' +
      'gentle:0.4 breathe:0.7 breathing:0.7 dawn:0.6 morning:0.5 lake:0.7 ocean:0.5 sea:0.5 waves:0.5 ' +
      'floating:0.4 weightless:0.5 content:0.8 contented:0.8 easy:0.5 unhurried spacious:0.6 pastoral',
    cozy: 'cozy cosy snug warm warmth comfy comfortable comfort:0.8 comforting:0.7 homely homey blanket ' +
      'fireplace fireside hearth sweater tea:0.7 coffee:0.6 cafe:0.6 rainy_day:0.7 indoors lazy:0.7 ' +
      'sunday:0.6 sunday_morning lofi:0.7 lo-fi:0.7 chill:0.7 chilled:0.7 mellow:0.8 laid-back laid_back ' +
      'easygoing soft:0.4 safe:0.7 cuddle:0.8 cuddling:0.8 hygge sleepy:0.6 autumn:0.4',
    hopeful: 'hopeful hope hoping optimistic optimism uplifting uplifted uplift promise:0.7 promising:0.7 ' +
      'sunrise new_beginning fresh_start new_day tomorrow:0.7 possibility possible:0.6 bright:0.7 brighter ' +
      'light:0.5 faith:0.8 believe:0.7 believing:0.7 healing heal:0.9 recovery:0.8 relief:0.8 relieved:0.8 ' +
      'encouraging inspiring:0.9 inspired:0.8 inspirational:0.9 rising:0.6 spring:0.7 bloom:0.7 ' +
      'blooming:0.7 reassuring consoling:0.8 looking_forward',
    playful: 'playful fun funny:0.8 bouncy bounce silly cute quirky cheeky goofy whimsical mischievous ' +
      'lighthearted light-hearted carefree happy:0.8 cheerful cheery sunny:0.8 sunshine:0.7 bubbly jaunty ' +
      'skipping:0.9 summery:0.7 breezy:0.8 upbeat:0.8 joyful:0.7 joy:0.6 smile:0.8 smiling:0.8 grin ' +
      'laughing:0.8 laugh:0.8 childlike innocent:0.6 flirty:0.5 groovy:0.7 funky:0.7 catchy:0.5 peppy perky',
    euphoric: 'euphoric euphoria ecstatic ecstasy elated elation bliss blissful rush:0.7 high:0.5 soaring:0.9 ' +
      'exhilarating exhilarated thrilling:0.8 thrill:0.8 party dance:0.8 dancing:0.8 dancefloor club:0.8 ' +
      'rave festival:0.8 celebration celebrate celebratory fireworks:0.8 alive:0.8 electric:0.7 ' +
      'explosive:0.6 joy:0.8 joyful:0.8 joyous overjoyed happy:0.6 on_top_of_the_world invincible:0.7 ' +
      'glowing:0.6 peak:0.6 banger:0.7 anthem:0.5 hands_up',
    triumphant: 'triumphant triumph victory victorious winning win:0.9 champion champions glory glorious proud ' +
      'pride anthem:0.8 anthemic stadium:0.8 arena:0.7 conquer conquering overcoming:0.8 overcome:0.8 ' +
      'made_it achievement succeeded success:0.9 celebration:0.5 fist-pumping arms_up payoff:0.8 ' +
      'vindicated vindication powerful:0.6 unstoppable:0.8 crowning finale:0.6 uplifting:0.4 rise:0.5',
    defiant: 'defiant defiance rebel rebellious rebellion angry anger rage raging furious fury pissed ' +
      'fight:0.8 fighting:0.8 fierce resist resistance unbroken unbowed stubborn:0.7 fed_up screw_you ' +
      'middle_finger attitude:0.8 swagger:0.7 bold:0.7 gritty:0.8 raw:0.6 punk:0.8 protest revolt uprising ' +
      'standing_up stand_up back_up badass tough:0.8 hard:0.4 aggressive:0.8 snarling sneering bitter:0.6 ' +
      'vengeful revenge:0.9 empowered:0.8 empowering:0.8 loud:0.3',
    restless: 'restless restlessness wired antsy fidgety jittery:0.8 itching can\'t_sit_still on_the_move ' +
      'moving:0.5 driving:0.7 drive:0.5 highway:0.6 road:0.5 road_trip:0.7 wanderlust:0.8 wandering:0.7 ' +
      'running:0.7 run:0.6 chasing:0.7 chase:0.7 pacing impatient:0.9 sleepless:0.7 insomnia:0.7 ' +
      'buzzing:0.7 kinetic propulsive:0.8 pulsing:0.6 churning:0.7 searching:0.5 escape:0.7 escaping:0.7 ' +
      'nervous_energy can\'t_sleep:0.7 unsettled:0.6 momentum:0.6',
    heroic: 'heroic hero heroes brave bravery courage courageous valiant noble gallant determined ' +
      'determination quest adventure:0.9 adventurous:0.9 journey:0.7 battle:0.8 warrior knight march:0.7 ' +
      'marching:0.7 charge:0.7 rally rallying fearless mighty:0.8 strong:0.6 strength:0.7 resolve:0.8 ' +
      'resolute rise:0.6 rising:0.5 trailer:0.6 soundtrack:0.4 superhero saviour savior rescue:0.7 ' +
      'perseverance persevere stand_tall onward forward:0.6',
    urgent: 'urgent urgency rush:0.7 rushing rushed racing:0.9 race:0.8 frantic frenzied frenetic hurry ' +
      'hurried pressing breathless desperate:0.7 panic:0.8 panicked:0.8 emergency alarm:0.8 countdown ' +
      'ticking deadline now:0.4 fast:0.6 speeding speed:0.7 relentless:0.8 pounding:0.7 adrenaline:0.9 ' +
      'intense:0.6 insistent high-stakes running_out_of_time chase:0.6 escape:0.5 hurtling',
    menacing: 'menacing menace ominous sinister evil threatening threat dark:0.7 darkness:0.7 dangerous ' +
      'danger:0.9 predatory stalking lurking villain villainous malevolent wicked:0.8 doom doomy heavy:0.5 ' +
      'brutal:0.8 violent:0.8 violence:0.8 creepy:0.7 scary:0.8 terrifying:0.8 horror:0.8 dread:0.7 ' +
      'foreboding:0.9 looming hostile cruel:0.7 venomous snarl:0.6 growl:0.7 demonic satanic hellish ' +
      'thunder:0.5 storm:0.5 grim:0.7 murky:0.5',
    anxious: 'anxious anxiety nervous nerves worry worried worrying uneasy unease tense tension:0.9 stressed ' +
      'stress:0.9 panic:0.7 panicky paranoid paranoia dread:0.8 fear:0.8 afraid:0.8 scared:0.8 on_edge ' +
      'edgy:0.8 jittery:0.6 apprehensive overthinking racing_thoughts insecure:0.8 insecurity:0.8 ' +
      'claustrophobic suffocating:0.8 overwhelmed:0.8 overwhelming:0.6 uncertain:0.7 uncertainty:0.7 ' +
      'unstable:0.6 trembling:0.8 shaky:0.8 heart_racing:0.9 spiralling spiraling knot:0.5',
    mysterious: 'mysterious mystery enigmatic enigma cryptic fog foggy mist misty shadowy:0.8 shadows:0.7 ' +
      'secret secrets secretive hidden:0.8 unknown:0.8 strange:0.8 odd:0.6 weird:0.7 curious:0.7 eerie:0.7 ' +
      'uncanny:0.8 otherworldly:0.7 mystical:0.9 magic:0.6 magical:0.6 occult:0.8 noir:0.8 detective:0.7 ' +
      'intrigue intriguing suspense suspenseful ambiguous:0.8 elusive:0.8 surreal:0.6 alien:0.6 unknowable ' +
      'veiled moonless smoke:0.5 smoky:0.4 twilight:0.6',
    haunted: 'haunted haunting haunt ghost ghosts ghostly spectral phantom spooky:0.9 eerie:0.8 chilling:0.8 ' +
      'chills:0.7 spine-tingling possessed cursed:0.8 abandoned:0.5 graveyard:0.9 cemetery:0.9 echoes:0.7 ' +
      'echoing:0.7 lingering:0.7 linger:0.7 can\'t_forget:0.8 past:0.4 memory:0.3 unsettling:0.8 ' +
      'disquieting gothic:0.8 goth:0.7 wraith apparition requiem:0.8 hollow:0.4 funereal:0.8 mournful:0.5 ' +
      'dark:0.4 cold:0.3',
    epic: 'epic cinematic huge massive vast enormous grand grandiose majestic sweeping widescreen wide-screen ' +
      'monumental colossal towering mountain:0.8 mountains:0.8 soaring:0.7 orchestral:0.9 symphonic:0.9 ' +
      'film_score:0.9 movie:0.6 soundtrack:0.7 dramatic:0.8 drama:0.6 larger_than_life legendary mythic:0.9 ' +
      'odyssey saga expansive:0.8 panoramic climactic:0.8 crescendo:0.7 awe:0.9 awe-inspiring ' +
      'breathtaking:0.8 immense infinite:0.6 sky:0.4 universe:0.6 cosmic:0.6 big:0.5',
    dreamy: 'dreamy dream dreaming dreamlike dreamscape floating float ethereal hazy haze shimmer shimmering ' +
      'shimmery airy gauzy washed:0.7 washed_out:0.6 reverb:0.7 blurry blurred blur:0.9 woozy:0.9 ' +
      'swirling:0.8 swirl:0.8 drifting drift weightless otherworldly:0.6 heavenly:0.8 celestial:0.8 clouds ' +
      'cloud:0.8 cloudy:0.6 stars:0.6 starry:0.7 space:0.6 spacey:0.9 spacy:0.9 cosmic:0.5 psychedelic:0.7 ' +
      'trippy:0.7 lucid surreal:0.7 soft-focus sleepy:0.5 lullaby:0.4 underwater:0.7 glowing:0.5 ' +
      'pastel:0.7 shoegaze:0.7',
  };

  // Everyday description words that lean on several feelings at once.
  const SHADES = {
    serene: 'sacred:0.7 spiritual:0.7 hymn:0.6 holy:0.6 prayer:0.6 gospel:0.4',
    hopeful: 'sacred:0.4 gospel:0.6 hymn:0.4',
    wistful: 'resigned:0.7 resignation:0.7',
    melancholic: 'resigned:0.5',
    anxious: 'obsessed:0.7 obsessive:0.7 obsession:0.7 jealous:0.8 jealousy:0.8',
    yearning: 'obsessed:0.7 obsessive:0.6 obsession:0.7',
    haunted: 'obsessed:0.5 atmospheric:0.4',
    mysterious: 'cool:0.4 atmospheric:0.5',
    playful: 'cool:0.4 jangly:0.5 sparkling:0.4 glittering:0.4',
    cozy: 'smooth:0.6 fuzzy:0.3 stoned:0.4',
    romantic: 'smooth:0.5 soulful:0.5',
    tender: 'soulful:0.6',
    nostalgic: 'jangly:0.4',
    dreamy: 'atmospheric:0.7 sparkling:0.6 glittering:0.6 fuzzy:0.6 stoned:0.7',
    euphoric: 'sparkling:0.5 glittering:0.5 drunk:0.4',
    lonely: 'sparse:0.5',
    hollow: 'sparse:0.4 drunk:0.3',
    epic: 'melodramatic:0.6',
    grieving: 'melodramatic:0.4',
    defiant: 'noisy:0.5 jealous:0.4',
    restless: 'noisy:0.5 drunk:0.4',
  };

  const ENERGY_SEED = {
    low: 'slow slowly quiet quietly soft gentle calm still sleepy mellow sparse stripped stripped-back ' +
      'stripped_back ballad lullaby minimal hushed subdued lazy laid-back laid_back downtempo sluggish ' +
      'dragging drowsy tired weary whisper intimate ambient relaxed unhurried slow_burn',
    high: 'fast loud driving:0.6 energetic upbeat pumping intense aggressive explosive banger racing frantic ' +
      'hard powerful pounding thrashing uptempo up-tempo danceable frenzied wild furious screaming shouting ' +
      'relentless punchy urgent raging',
  };

  const STOPWORDS = new Set(('a an the and or but of to in on at for with it its is are was were be been ' +
    'being this that these those i me my mine you your we us our they them their he she his her like ' +
    'feels feel feeling felt song songs sounds sound sounding music track tune makes make made making ' +
    'something someone somewhere just only also when where while as if then than there here from by ' +
    'about into through over under up out off all some any one two got get gets have has had do does did ' +
    'will would could should can may might im its thats theres what which who how why because though ' +
    'still yet even ever much more most such both each other another same own again once am been way ' +
    'thing things time times day days bit lot lots kind sort after before during between around every ' +
    'part vibe vibes mood moods type whole really pretty rather then now').split(/\s+/));

  const INTENSIFIERS = new Set(('very really so extremely super incredibly deeply totally absolutely ' +
    'utterly insanely intensely overwhelmingly pure purely massively hugely painfully').split(' '));
  const DIMINISHERS = new Set(('slightly somewhat little bit kinda sorta mildly faintly vaguely touch hint ' +
    'tinge barely-there subtly').split(' '));
  const NEGATORS = new Set('not no never without hardly lacking none zero'.split(' '));

  function parseSeed(text) {
    return text.split(/\s+/).filter(Boolean).map(entry => {
      const cut = entry.lastIndexOf(':');
      const hasWeight = cut > 0 && /^[\d.]+$/.test(entry.slice(cut + 1));
      return {
        word: (hasWeight ? entry.slice(0, cut) : entry).replace(/_/g, ' '),
        weight: hasWeight ? parseFloat(entry.slice(cut + 1)) : 1,
      };
    });
  }

  const WORDS = {};
  let maxPhraseWords = 1;
  for (const source of [SEED, SHADES]) {
    for (const [feelingId, text] of Object.entries(source)) {
      for (const { word, weight } of parseSeed(text)) {
        (WORDS[word] = WORDS[word] || {})[feelingId] = weight;
        maxPhraseWords = Math.max(maxPhraseWords, word.split(' ').length);
      }
    }
  }
  const ENERGY = {};
  parseSeed(ENERGY_SEED.low).forEach(e => { ENERGY[e.word] = -e.weight; });
  parseSeed(ENERGY_SEED.high).forEach(e => { ENERGY[e.word] = e.weight; });

  // ── Reading text ─────────────────────────────────────────────────────────
  function rawTokens(text) {
    return String(text == null ? '' : text).toLowerCase().replace(/[’‘]/g, "'")
      .match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) || [];
  }

  // Content words only — what similarity between descriptions is built on.
  function tokenize(text) {
    return rawTokens(text).filter(w => !STOPWORDS.has(w) && !INTENSIFIERS.has(w) &&
      !DIMINISHERS.has(w) && !NEGATORS.has(w) && !/n't$/.test(w));
  }

  // Plausible base forms: "hauntingly" → haunting → haunt.
  function variants(word) {
    const out = [word];
    const add = v => { if (v.length >= 3 && !out.includes(v)) out.push(v); };
    for (let i = 0; i < out.length && i < 12; i++) {
      const w = out[i];
      if (w.endsWith('iness')) add(w.slice(0, -5) + 'y');
      if (w.endsWith('ness')) add(w.slice(0, -4));
      if (w.endsWith('ily')) add(w.slice(0, -3) + 'y');
      if (w.endsWith('ly')) add(w.slice(0, -2));
      if (w.endsWith('ing')) { add(w.slice(0, -3)); add(w.slice(0, -3) + 'e'); }
      if (w.endsWith('ed')) { add(w.slice(0, -2)); add(w.slice(0, -1)); }
      if (w.endsWith('ies')) add(w.slice(0, -3) + 'y');
      if (w.endsWith('es')) add(w.slice(0, -2));
      if (w.endsWith('s')) add(w.slice(0, -1));
      if (w.endsWith('ful')) add(w.slice(0, -3));
      if (w.endsWith('ic')) add(w.slice(0, -2) + 'y');
      if (w.endsWith('y')) add(w.slice(0, -1));
      if (w.includes('-')) w.split('-').forEach(add);
    }
    return out;
  }

  function lookup(word, learned) {
    for (const v of variants(word)) {
      if (WORDS[v]) return WORDS[v];
    }
    if (learned) {
      for (const v of variants(word)) {
        if (learned[v]) return learned[v];
      }
    }
    return null;
  }

  function energyOf(word) {
    for (const v of variants(word)) {
      if (ENERGY[v] !== undefined) return ENERGY[v];
    }
    return 0;
  }

  // text → what it feels like. `learned` is Muse's own vocabulary:
  // { word: { feelingId: weight } } for words outside the built-in list.
  function analyze(text, learned) {
    const raw = rawTokens(text);
    const totals = {};
    const known = [];
    const unknown = [];
    let energySum = 0;
    let boost = 1;
    let negate = false;

    const apply = (label, weights) => {
      if (!negate) {
        for (const [id, w] of Object.entries(weights)) totals[id] = (totals[id] || 0) + w * boost;
        if (!known.includes(label)) known.push(label);
      }
      boost = 1;
      negate = false;
    };

    for (let i = 0; i < raw.length;) {
      // Longest phrase starting here ("on top of the world").
      let matched = 0;
      for (let len = Math.min(maxPhraseWords, raw.length - i); len >= 2; len--) {
        const phrase = raw.slice(i, i + len).join(' ');
        if (WORDS[phrase] || ENERGY[phrase] !== undefined) {
          if (ENERGY[phrase] !== undefined && !negate) energySum += ENERGY[phrase];
          if (WORDS[phrase]) apply(phrase, WORDS[phrase]);
          matched = len;
          break;
        }
      }
      if (matched) { i += matched; continue; }

      const word = raw[i++];
      if (NEGATORS.has(word) || /n't$/.test(word)) { negate = true; continue; }
      if (INTENSIFIERS.has(word)) { boost = 1.5; continue; }
      if (DIMINISHERS.has(word)) { boost = 0.55; continue; }
      if (STOPWORDS.has(word)) continue;

      const e = energyOf(word);
      if (e && !negate) energySum += e;
      const weights = lookup(word, learned);
      if (weights) apply(word, weights);
      else {
        if (!e && word.length >= 3 && !unknown.includes(word)) unknown.push(word);
        boost = 1;
        negate = false;
      }
    }

    const max = Math.max(0, ...Object.values(totals));
    const feelings = {};
    if (max > 0) {
      for (const [id, w] of Object.entries(totals)) {
        if (w / max >= 0.15) feelings[id] = w / max;
      }
    }
    const top = Object.keys(feelings).sort((a, b) => feelings[b] - feelings[a]).slice(0, 4);
    return {
      feelings, top, known, unknown,
      energy: energySum <= -1 ? 'low' : energySum >= 1 ? 'high' : 'mid',
      tokens: tokenize(text),
    };
  }

  // ── Comparing feelings ───────────────────────────────────────────────────
  function cosine(a, b) {
    a = a || {}; b = b || {};
    let dot = 0, na = 0, nb = 0;
    for (const id of Object.keys(a)) { na += a[id] * a[id]; if (b[id]) dot += a[id] * b[id]; }
    for (const id of Object.keys(b)) nb += b[id] * b[id];
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
  }

  function describe(feelings, n) {
    const F = global.Feelings;
    return Object.keys(feelings || {})
      .sort((a, b) => feelings[b] - feelings[a])
      .slice(0, n || 3)
      .map(id => ((F && F.getFeeling(id)) || { name: id }).name.toLowerCase())
      .join(', ');
  }

  function isKnownWord(word) { return !!lookup(word, null) || energyOf(word) !== 0; }

  global.Lexicon = { WORDS, analyze, tokenize, variants, cosine, describe, isKnownWord };
})(typeof window !== 'undefined' ? window : globalThis);
