/* Shared helpers for every overlay and the control page.
 *
 * Loaded as a plain <script> — no modules, no build step, matching the rest of
 * the project. Everything hangs off the global `OV`.
 */
(function () {
  'use strict';

  var P = new URLSearchParams(location.search);
  var NAME_MODES = ['full', 'short', 'initials'];

  var LANGS = ['en', 'de'];

  var urlMode = NAME_MODES.indexOf(P.get('names')) >= 0 ? P.get('names') : null;
  var urlLang = LANGS.indexOf(P.get('lang')) >= 0 ? P.get('lang') : null;
  // Theme ids come from the server's list, so any well-formed id is accepted.
  var urlTheme = /^[a-z0-9-]{1,24}$/.test(P.get('theme') || '') ? P.get('theme') : null;


  var THEME_KEY = 'fab-theme';
  function stored(key) {
    try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
  }
  function storedTheme() { return stored(THEME_KEY); }

  var OV = {
    params:    P,
    eventId:   P.get('eventId') || '',
    refreshMs: (parseInt(P.get('refresh'), 10) || 30) * 1000,
    nameMode:  urlMode || 'short',  // provisional until the server answers
    lang:      urlLang || 'en',     // likewise
    // The last theme this browser saw, so a reload does not flash the wrong one.
    theme:     urlTheme || storedTheme() || 'usurp',
    scale:     parseFloat(P.get('scale')) || 1,
    debug:     P.get('debug') === '1',
    young:     false
  };

  // Every board and floating overlay sizes itself in em off this, so ?scale=
  // works everywhere without touching a layout.
  document.documentElement.style.setProperty('--scale', OV.scale);
  if (OV.debug) document.documentElement.classList.add('debug');
  if (P.get('fx') === '0') document.documentElement.classList.add('no-fx');

  /* Themes. Boards, tickers and the broadcast frame wear the global theme as a
   * `theme-<id>` class on <body>; the tokens behind it live in overlay.css.
   * The banner and badges that float over the camera keep their dark surface
   * whatever the theme, and so does anything else that does not opt in.
   */
  OV.paintTheme = function () {
    var b = document.body;
    if (!b) return;
    var c = b.classList;
    if (!(c.contains('board') || c.contains('ticker') || c.contains('themed'))) return;
    Array.prototype.slice.call(c).forEach(function (name) {
      if (name.indexOf('theme-') === 0) c.remove(name);
    });
    c.add('theme-' + OV.theme);
  };
  OV.paintTheme();

  /* Background animation, on every overlay.
   *
   *   OV.fx(host, { motes: 30, glows: true })
   *
   * puts a layer behind the content of `host`: motes of light rising through
   * it, and — for the full-frame boards — large soft patches of light
   * drifting slowly. Panels that float over the camera get the motes only,
   * plus the band of light their stylesheet gives them. It should read as
   * "alive", never as something to look at; ?fx=0 turns it off for a source.
   *
   * Only transform and opacity are animated and nothing is blurred live (the
   * softness is in the gradients), so it costs next to nothing in OBS.
   */
  OV.fxOff = P.get('fx') === '0';

  OV.fx = function (host, opts) {
    if (OV.fxOff || !host) return;
    for (var c = host.firstElementChild; c; c = c.nextElementSibling) {
      if (c.classList.contains('fx')) return;              // already there
    }
    var o = opts || {};
    var h = host.clientHeight || window.innerHeight || 1080;
    var n = o.motes == null ? 30 : o.motes;

    var fx = document.createElement('div');
    fx.className = 'fx';
    fx.style.setProperty('--rise', Math.round(h * 1.12) + 'px');

    var html = o.glows
      ? '<i class="fx-glow a"></i><i class="fx-glow b"></i><i class="fx-glow c"></i><i class="fx-glow d"></i>' : '';
    for (var i = 0; i < n; i++) {
      var size = 2.5 + Math.random() * 5.5;                // px
      // 28–62 px a second, but never a flicker: a low panel gets a slow rise.
      var dur  = Math.max(7, h / (28 + Math.random() * 34));
      var sway = (Math.random() * 2 - 1) * Math.min(150, h * 0.45);
      html += '<i class="fx-mote" style="' +
        'left:' + (Math.random() * 100).toFixed(1) + '%;' +
        'width:' + size.toFixed(1) + 'px;height:' + size.toFixed(1) + 'px;' +
        '--sway:' + sway.toFixed(0) + 'px;' +
        'animation-duration:' + dur.toFixed(1) + 's;' +
        'animation-delay:-' + (Math.random() * dur).toFixed(1) + 's"></i>';   // already under way
    }

    // Scenery that only some themes show (see "Usurp the Shadow Throne" in
    // overlay.css): two arcane circles turning against each other, and shards
    // of rock adrift. Hidden — and costing nothing — everywhere else.
    if (o.glows) {
      html += '<i class="fx-sigil a"></i><i class="fx-sigil b"></i>';
      for (var k = 0; k < 10; k++) {
        var dur2 = 16 + Math.random() * 22;
        html += '<i class="fx-shard s' + (1 + k % 3) + '" style="' +
          'left:' + (Math.random() * 96).toFixed(1) + '%;top:' + (Math.random() * 92).toFixed(1) + '%;' +
          'width:' + (1.2 + Math.random() * 3.6).toFixed(2) + 'vmax;' +
          '--r0:' + (Math.random() * 360).toFixed(0) + 'deg;--r1:' + (Math.random() * 360).toFixed(0) + 'deg;' +
          '--dx:' + (Math.random() * 6 - 3).toFixed(1) + 'vmax;--dy:' + (Math.random() * 8 - 4).toFixed(1) + 'vmax;' +
          'animation-duration:' + dur2.toFixed(1) + 's;animation-delay:-' + (Math.random() * dur2).toFixed(1) + 's"></i>';
      }
      // "Mastery Pack Assassin": mist along the floor and the glint of a
      // blade — each on a rhythm of its own, so they never come as a volley.
      html += '<i class="fx-mist m1"></i><i class="fx-mist m2"></i><i class="fx-mist m3"></i>';
      for (var s = 0; s < 3; s++) {
        var every = 19 + s * 8 + Math.random() * 6;        // seconds between glints
        html += '<i class="fx-slash" style="' +
          'top:' + (25 + Math.random() * 70).toFixed(0) + '%;' +
          '--a:' + (-(14 + Math.random() * 22)).toFixed(0) + 'deg;' +
          'animation-duration:' + every.toFixed(1) + 's;' +
          'animation-delay:-' + (Math.random() * every).toFixed(1) + 's"></i>';
      }
    }
    fx.innerHTML = html;

    host.classList.add('fx-host');
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.insertBefore(fx, host.firstChild);
  };

  // The boards get theirs here; pages with floating panels call OV.fx themselves.
  if (document.body && document.body.classList.contains('board')) {
    OV.fx(document.querySelector('.overlay-frame'), { motes: 34, glows: true });
  }

  // Appended to /api/* calls so an overlay can pin a different event.
  OV.query = OV.eventId ? '?eventId=' + encodeURIComponent(OV.eventId) : '';

  // ── text ───────────────────────────────────────────────────────────────────

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  OV.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  };

  /* GEM writes "Ironsong, Dorinthea"; the CSVs sometimes write "Dorinthea
   * Ironsong". Players also fill a nickname into their own GEM profile, which
   * arrives as part of the name: 'Rhinar, Katsu "Rhino"'.
   *
   * The nickname is stripped, not abbreviated — otherwise its opening quote
   * contributes a bogus initial ("K. \". R."), being just another
   * whitespace-separated token. Same rule as abbreviateName in the
   * fab-analyser-extension. Apostrophes are deliberately not delimiters, they
   * belong to O'Brien and D'Angelo. src/name.js strips the same pattern to
   * join heroes and standings across GEM's two spellings.
   */
  var NICK_RE = /\s*["“„«(\[][^"“”„«»()\[\]]*["”“»)\]]\s*/g;

  function normalizeName(n) {
    var s = String(n == null ? '' : n).replace(NICK_RE, ' ').trim();
    if (!s) return '';
    if (s.indexOf(',') !== -1) {
      s = s.split(',').reverse().map(function (x) { return x.trim(); })
           .filter(Boolean).join(' ');
    }
    return s.replace(/\s+/g, ' ').trim();
  }

  /* Name display, GDPR-relevant:
   *              "Ironsong, Dorinthea"   'Rhinar, Katsu "Rhino"'
   *   full     → Dorinthea Ironsong      Katsu Rhinar
   *   short    → Dorinthea I.            Katsu R.              (default)
   *   initials → D. I.                   K. R.
   */
  OV.fmtName = function (n, mode) {
    var s = normalizeName(n);
    if (!s) return '–';

    var m = mode || OV.nameMode;
    if (m === 'full') return s;

    var parts = s.split(/\s+/).filter(Boolean);
    var initials = function (list) {
      return list.map(function (p) { return p.charAt(0).toUpperCase() + '.'; }).join(' ');
    };

    if (m === 'initials') return initials(parts);
    if (parts.length === 1) return parts[0];
    return parts[0] + ' ' + initials(parts.slice(1));
  };

  /* Join key that survives word order, nicknames, punctuation and accents —
   * the run page writes "Ironsong, Dorinthea", the coverage CSVs "Dorinthea
   * Ironsong". Must stay in step with nameKey in src/name.js (the test suite
   * runs both against the same cases).
   */
  var FOLD = { '\u0131': 'i', '\u0130': 'i', '\u00f8': 'o', '\u0153': 'oe', '\u00e6': 'ae',
               '\u00df': 'ss', '\u0142': 'l', '\u0111': 'd', '\u00f0': 'd', '\u00fe': 'th' };
  var FOLD_RE = new RegExp('[' + Object.keys(FOLD).join('') + ']', 'g');

  OV.nameKey = function (name) {
    return String(name == null ? '' : name)
      .replace(NICK_RE, ' ')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(FOLD_RE, function (c) { return FOLD[c]; })
      .replace(/['\u2019\u02bc`]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/).filter(Boolean)
      .sort()
      .join(' ');
  };

  /* heroes CSV rows -> lookup(gemId, name). The gemId wins; the name key is
   * the fallback for rows GEM delivers without one.
   */
  OV.heroIndex = function (heroes) {
    var byId = {}, byKey = {};
    (Array.isArray(heroes) ? heroes : []).forEach(function (h) {
      if (!h || !h.hero) return;
      if (h.gemId) byId[h.gemId] = h.hero;
      var k = OV.nameKey(h.name);
      if (k) byKey[k] = h.hero;
    });
    return function (gemId, name) {
      return (gemId && byId[gemId]) || byKey[OV.nameKey(name)] || null;
    };
  };

  /* Everyone's record, counted off the pairings themselves:
   *   recOf(gemId, name) -> { w, l, d } or null
   * This is the one place that knows losses and draws — GEM's standings CSV
   * carries wins only. `upTo` leaves out rounds from that number on, for the
   * record a player brought INTO a round.
   */
  OV.records = function (tdata, upTo) {
    var byId = {}, byKey = {};
    var slot = function (gemId, name) {
      var k = OV.nameKey(name);
      var r = (gemId && byId[gemId]) || (k && byKey[k]) || { w: 0, l: 0, d: 0 };
      if (gemId) byId[gemId] = r;
      if (k) byKey[k] = r;
      return r;
    };
    ((tdata && tdata.rounds) || []).forEach(function (round) {
      if (round.elimination || (upTo && round.round >= upTo)) return;
      round.pairings.forEach(function (p) {
        var a = slot(p.p1GemId, p.p1), b = slot(p.p2GemId, p.p2);
        if (!p.done) return;
        if (p.winner === 'p1')      { a.w++; b.l++; }
        else if (p.winner === 'p2') { b.w++; a.l++; }
        else                        { a.d++; b.d++; }
      });
    });
    return function (gemId, name) {
      return (gemId && byId[gemId]) || byKey[OV.nameKey(name)] || null;
    };
  };

  // "7–1", or "7–1–1" once there is a draw to report.
  OV.fmtRecord = function (r) {
    if (!r) return '';
    return r.w + '–' + r.l + (r.d ? '–' + r.d : '');
  };

  // pairing.table is a number when GEM's cell parsed cleanly, the raw string
  // otherwise.
  OV.tableNo = function (p) {
    if (typeof p.table === 'number') return p.table;
    return parseInt(String(p.table).replace(/\D/g, ''), 10) || null;
  };

  // ── language ───────────────────────────────────────────────────────────────
  //
  // Only what viewers see on stream is translated. The status badge is an
  // operator diagnostic and stays English.

  var T = {
    en: {
      round: 'Round {n}', table: 'Table {n}', pairings: 'Pairings', standings: 'Standings',
      afterRound: 'after round {n}', topCut: 'Top Cut', breakdown: 'Hero Breakdown',
      'stage.r16': 'Round of 16', 'stage.qf': 'Quarterfinals', 'stage.sf': 'Semifinals', 'stage.f': 'Finals',
      running: 'running', finished: 'finished', completed: 'completed', vs: 'vs',
      tablesDone: 'tables finished', players: 'players', heroes: 'heroes',
      champion: 'Champion', others: 'Other heroes ({n})',
      noPairings: 'No pairings yet', noStandings: 'No standings yet',
      noBracket: 'No elimination rounds yet', noHeroes: 'No hero data yet', noRound: 'No round yet',
      tournament: 'Tournament',
      lblEvent: 'Event', lblFormat: 'Format', lblRound: 'Round', lblTable: 'Table',
      places: 'Places {a}–{b}', place: 'Place {a}',
      lblRecord: 'Record', lblLife: 'Life', lblClass: 'Class', winner: 'Winner'
    },
    de: {
      round: 'Runde {n}', table: 'Tisch {n}', pairings: 'Paarungen', standings: 'Tabelle',
      afterRound: 'nach Runde {n}', topCut: 'Top Cut', breakdown: 'Helden-Verteilung',
      'stage.r16': 'Achtelfinale', 'stage.qf': 'Viertelfinale', 'stage.sf': 'Halbfinale', 'stage.f': 'Finale',
      running: 'l\u00e4uft', finished: 'beendet', completed: 'abgeschlossen', vs: 'vs',
      tablesDone: 'Tische fertig', players: 'Spieler', heroes: 'Helden',
      champion: 'Sieger', others: 'Weitere Helden ({n})',
      noPairings: 'Noch keine Paarungen', noStandings: 'Noch keine Tabelle',
      noBracket: 'Noch keine K.-o.-Runden', noHeroes: 'Noch keine Heldendaten', noRound: 'Noch keine Runde',
      tournament: 'Turnier',
      lblEvent: 'Event', lblFormat: 'Format', lblRound: 'Runde', lblTable: 'Tisch',
      places: 'Platz {a}–{b}', place: 'Platz {a}',
      lblRecord: 'Bilanz', lblLife: 'Leben', lblClass: 'Klasse', winner: 'Sieger'
    }
  };

  OV.t = function (key, vars) {
    var s = (T[OV.lang] || T.en)[key];
    if (s == null) s = T.en[key];
    if (s == null) return key;
    return s.replace(/\{(\w+)\}/g, function (_, k) { return vars && vars[k] != null ? vars[k] : ''; });
  };

  var STAGES = ['r16', 'qf', 'sf', 'f'];

  // Which stage of the top cut a round is, from the size of its first round.
  OV.stageOf = function (tdata, r) {
    if (!r || !r.elimination) return null;
    var elim = tdata.rounds.filter(function (x) { return x.elimination; })
                           .sort(function (a, b) { return a.round - b.round; });
    var idx = elim.map(function (x) { return x.round; }).indexOf(r.round);
    var first = (elim[0] && elim[0].pairings.length) || 0;
    var start = first >= 8 ? 0 : first >= 4 ? 1 : first >= 2 ? 2 : 3;
    return STAGES[Math.min(start + Math.max(idx, 0), STAGES.length - 1)];
  };

  OV.roundName = function (tdata, r) {
    var stage = OV.stageOf(tdata, r);
    return stage ? OV.t('stage.' + stage) : OV.t('round', { n: r.round });
  };

  // Same for the featured match, whose stage the server resolves.
  OV.matchRoundName = function (m) {
    if (!m) return '';
    if (m.roundStage) return OV.t('stage.' + m.roundStage);
    if (m.round) return OV.t('round', { n: m.round });
    return m.roundLabel || '';
  };

  // ── hero artwork ───────────────────────────────────────────────────────────

  // Young heroes (Blitz, Draft, Sealed, Commoner) have their own printing and
  // artwork; Classic Constructed uses the adult one.
  OV.setFormat = function (format) {
    OV.young = /blitz|draft|sealed|versiegelt|booster|commoner|limited/i.test(String(format || ''));
  };

  OV.heroImageUrl = function (name, young) {
    var y = (young === undefined) ? OV.young : young;
    // The answer is cached for a day by the browser. `v` is bumped whenever
    // the server starts choosing a different picture for the same hero, so an
    // OBS that has been running does not go on showing the old one.
    return '/api/hero-image?v=2&name=' + encodeURIComponent(name) + (y ? '&young=1' : '');
  };

  /* Square hero portrait: placeholder letter behind, artwork fades in on top.
   * `size` is a pixel number or any CSS length ("2.4em"); pass null to size it
   * from the stylesheet instead.
   */
  OV.hw = function (name, size, opts) {
    var o = opts || {};
    var len  = typeof size === 'number' ? size + 'px' : size;
    var cls  = 'hero-wrap' + (o.className ? ' ' + o.className : '');
    var ph   = '<div class="hero-ph">' + OV.esc(String(name || '?').charAt(0)) + '</div>';
    var box  = '<div class="' + cls + '"' +
               (len ? ' style="width:' + len + ';height:' + len + '"' : '') + '>';

    if (!name) return box + ph + '</div>';

    return box + ph +
      '<img class="hero-img" alt="" src="' + OV.esc(OV.heroImageUrl(name, o.young)) + '" ' +
      'onload="this.style.opacity=1" onerror="OV.imgRetry(this)"></div>';
  };

  /* A portrait that failed to load gets a few more tries before the
   * placeholder letter is left standing. Boards skip re-rendering unchanged
   * data, so without this one hiccup of the artwork host would stick until
   * the pairings change.
   */
  OV.imgRetry = function (img) {
    var n = parseInt(img.getAttribute('data-try'), 10) || 0;
    if (n >= 3) { img.style.display = 'none'; return; }
    img.setAttribute('data-try', n + 1);
    setTimeout(function () {
      if (!img.isConnected) return;
      img.src = img.src.replace(/&r=\d+$/, '') + '&r=' + (n + 1);
    }, 4000 * (n + 1));
  };

  /* Shows a card from a list of candidate image URLs — several printings on
   * different hosts, not all of them alive — moving on whenever one fails.
   * `done(ok)` is optional.
   */
  OV.loadCardImage = function (img, urls, done) {
    var list = (urls || []).slice();
    var token = (img.__token = (img.__token || 0) + 1);       // a newer call wins
    var next = function () {
      if (img.__token !== token) return;
      if (!list.length) { if (done) done(false); return; }
      img.onload  = function () { if (img.__token === token && done) done(true); };
      img.onerror = next;
      img.src = list.shift();
    };
    next();
  };

  /* The card on show, with its entrances and exits:
   *
   *   var stage = OV.cardStage(host);   stage.set(card | null);
   *
   *   nothing -> card   dealt: comes up from below at an angle and settles
   *   card -> card      turned over: the old one flips away, the new one flips in
   *   card -> nothing   drawn away downwards
   *
   * Whatever the entrance, the card ends up lying perfectly straight. A new
   * card only starts moving once its picture has loaded, so nothing ever
   * animates in empty; setting the same card again does nothing.
   */
  OV.cardStage = function (host) {
    host.classList.add('card-stage');
    var shown = null;        // the <img> on screen
    var wanted = '';         // key of the card asked for last
    var loading = null;      // the <img> still fetching, if any

    function leave(img, how) {
      img.classList.remove('in', 'flip-in');
      img.classList.add(how);
      setTimeout(function () { if (img.parentNode) img.parentNode.removeChild(img); }, 800);
    }

    return {
      set: function (card) {
        var key = card && card.images ? card.images.join('|') : '';
        if (key === wanted) return;
        wanted = key;
        loading = null;                                   // drops a load under way

        if (!card) {
          if (shown) { leave(shown, 'out'); shown = null; }
          return;
        }

        var img = document.createElement('img');
        img.alt = '';
        img.className = 'card-img';
        loading = img;

        OV.loadCardImage(img, card.images, function (ok) {
          if (loading !== img) return;                    // a newer card overtook this one
          loading = null;
          var old = shown;
          shown = null;
          if (!ok) { if (old) leave(old, 'out'); return; }

          host.appendChild(img);
          shown = img;
          if (old) { leave(old, 'flip-out'); img.classList.add('flip-in'); }
          else     { img.classList.add('in'); }
        });
      }
    };
  };

  // ── status badge ───────────────────────────────────────────────────────────

  var cdTimer = null;
  function badgeEl() { return document.getElementById('status-badge'); }

  OV.startCountdown = function (sec) {
    var sb = badgeEl();
    if (!sb) return;
    clearInterval(cdTimer);
    var t = Math.max(1, Math.round(sec));
    sb.textContent = t + 's';
    cdTimer = setInterval(function () {
      t--;
      if (t <= 0) clearInterval(cdTimer); else sb.textContent = t + 's';
    }, 1000);
  };

  OV.badge = function (text, isError) {
    var sb = badgeEl();
    if (!sb) return;
    clearInterval(cdTimer);
    sb.textContent = text;
    sb.className = isError ? 'error' : '';
  };

  /* Healthy state. The badge is hidden then — a ticking counter has no place
   * on a broadcast — unless the source is opened with ?debug=1. Problems
   * (OV.badge) always show.
   */
  OV.badgeOk = function (sec) {
    var sb = badgeEl();
    if (!sb) return;
    clearInterval(cdTimer);
    sb.className = 'ok';
    if (sec) OV.startCountdown(sec); else sb.textContent = 'OK';
  };

  // ── event data ─────────────────────────────────────────────────────────────

  /* One call for what every board needs. Resolves to
   *   { tdata, heroes, heroOf(gemId, name), standings }
   * and rejects with a readable message; the caller keeps its last good frame.
   */
  OV.loadEvent = function (opts) {
    var q = OV.query;
    var reqs = [fetch('/api/tournament' + q), fetch('/api/heroes' + q)];
    if (opts && opts.standings) reqs.push(fetch('/api/standings' + q));

    return Promise.all(reqs).then(function (rs) {
      return Promise.all(rs.map(function (r) {
        return r.json().catch(function () { return null; });
      })).then(function (js) {
        var t = js[0];
        if (rs[0].status === 401) throw new Error('Not logged in to GEM');
        if (!rs[0].ok || !t || t.error) throw new Error((t && t.error) || ('HTTP ' + rs[0].status));

        OV.setFormat(t.meta && t.meta.format);
        return {
          tdata:     t,
          heroes:    Array.isArray(js[1]) ? js[1] : [],
          heroOf:    OV.heroIndex(js[1]),
          standings: Array.isArray(js[2]) ? js[2] : []
        };
      });
    });
  };

  // ── auto-scrolling list ────────────────────────────────────────────────────

  /* Scrolls `track` inside `viewport` when the content does not fit, wrapping
   * seamlessly — vertically for the boards, horizontally for the tickers.
   *
   * show(html, count):
   *   - identical content is a no-op: no re-render, no artwork flicker
   *   - same `count` of rows as on screen (a result came in, the next round was
   *     paired): swapped in place, the scroll carries on where it was
   *   - a different count is a different list (another stage, another event):
   *     shown at once, starting from the beginning. It used to wait for the
   *     seam — on a 64-table ticker that is minutes of showing the old round.
   *
   * opts.axis   'y' (default) or 'x'
   * opts.speed  px per second at scale 1 (default 48)
   * opts.fit    add class "fit" to the track when everything fits
   */
  OV.scroller = function (viewport, track, opts) {
    var o = opts || {};
    var horiz = o.axis === 'x';
    var speed = (o.speed || 48) * OV.scale;
    var pos = 0, size = 0, measuring = false, prev = null;
    var current = null, currentCount = null, queued = null;
    var first = true;      // the first list makes an entrance (.fresh), later ones do not

    function natural() { return horiz ? track.scrollWidth : track.scrollHeight; }
    function room()    { return horiz ? viewport.clientWidth : viewport.clientHeight; }
    function place()   {
      track.style.transform = (horiz ? 'translateX(' : 'translateY(') + (-pos) + 'px)';
    }

    function show(html, count) {
      // Measuring takes two frames (and as long as it likes in a hidden tab);
      // whatever arrives meanwhile is applied right after — the latest wins.
      if (measuring) { queued = { html: html, count: count }; return; }
      if (html === current) return;
      if (size > 0 && count != null && count === currentCount) swap(html, count);
      else set(html, count);
    }

    function set(html, count) {
      current = html; currentCount = count;
      measuring = true;
      track.classList.toggle('fresh', first);
      first = false;
      pos = 0; size = 0; place();
      track.classList.remove('fit');            // measure the natural size
      track.innerHTML = html;
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        var n = natural();
        if (n <= room()) {
          if (o.fit) track.classList.add('fit');
        } else {
          size = n;
          track.innerHTML = html + html;        // second copy for the wrap
        }
        // From here on portraits appear without the fade-in: content swaps
        // must not make the whole list blink.
        track.classList.add('quiet');
        measuring = false;
        if (queued) { var q = queued; queued = null; show(q.html, q.count); }
      }); });
    }

    // Same number of rows: replace both copies where they stand.
    function swap(html, count) {
      current = html; currentCount = count;
      track.classList.remove('fresh');
      track.innerHTML = html + html;
      requestAnimationFrame(function () {
        var half = natural() / 2;
        if (half > 0) size = half;
        if (pos >= size) pos = 0;
      });
    }

    function tick(ts) {
      requestAnimationFrame(tick);
      if (measuring || size <= 0) { prev = ts; return; }
      var dt = Math.min((ts - (prev || ts)) / 1000, 0.05);
      prev = ts;
      pos += speed * dt;
      if (pos >= size) pos -= size;
      place();
    }
    requestAnimationFrame(tick);

    return { show: show };
  };

  // ── ticker mode ────────────────────────────────────────────────────────────

  /* ?mode=ticker turns Pairings and Standings into a band that runs across the
   * frame, one cell per table — sized off the source's height, so a 1920x140
   * browser source is all it needs. It wears the global theme (?theme= overrides it).
   * ?pos=top pins it to the top edge when the source is taller than the strip.
   */
  OV.ticker = P.get('mode') === 'ticker';
  OV.speed  = parseFloat(P.get('speed')) || null;   // px per second, either mode

  OV.initTicker = function () {
    if (!OV.ticker) return null;
    var b = document.body;
    b.classList.remove('board');
    b.classList.add('ticker');
    OV.paintTheme();
    if (P.get('pos') === 'top') b.classList.add('pos-top');
    OV.fx(document.querySelector('.tk'), { motes: 26 });
    return OV.scroller(document.getElementById('tk-view'), document.getElementById('tk-track'),
                       { axis: 'x', speed: OV.speed || 90 });
  };

  // ── live channel (SSE) ─────────────────────────────────────────────────────

  var es = null;
  var handlers = { match: [], settings: [], state: [], refresh: [] };

  function emit(kind, payload) {
    handlers[kind].forEach(function (fn) {
      try { fn(payload); } catch (err) { console.error('[OV]', kind, 'handler failed:', err); }
    });
  }

  /* One stream for all pages.
   *
   * A browser allows six connections per host, and an open EventSource keeps
   * one of them for good. OBS runs every browser source in the same browser,
   * so with seven or more overlays the first six streams took every slot and
   * no page could fetch anything any more — all sources stayed blank.
   *
   * So only one page per browser — the "leader", whoever holds the Web Lock —
   * opens the stream and passes each event on over a BroadcastChannel. When
   * the leader goes away the lock falls to the next page, which takes over.
   * Where those APIs are missing (the tablet on plain http is not a secure
   * context) the page simply opens its own stream, as before.
   */
  var started = false, leader = false, channel = null;
  var last = { match: null, settings: null, state: null };   // for late joiners
  var heard = 0;                                             // last sign of the leader

  function deliver(kind, data) {
    if (kind === 'match') emit('state', 'live');
    emit(kind, data);
  }

  // EventSource reconnects on its own using the server's `retry:` hint, so a
  // dropped Wi-Fi link or an OBS scene switch heals without any code here.
  function openStream(relay) {
    if (es) return;
    try { es = new EventSource('/api/live'); } catch (err) { return; }

    var on = function (kind, data) {
      if (kind in last) last[kind] = data;
      deliver(kind, data);
      if (relay) relay(kind, data);
    };

    es.addEventListener('match',    function (e) { on('match', JSON.parse(e.data)); });
    es.addEventListener('settings', function (e) { on('settings', JSON.parse(e.data)); });
    es.addEventListener('refresh',  function ()  { on('refresh'); });
    es.addEventListener('open',     function ()  { on('state', 'live'); });
    es.addEventListener('error',    function ()  { on('state', 'offline'); });
  }

  function connectLive() {
    if (started) return;
    started = true;

    var canShare = typeof BroadcastChannel === 'function' &&
                   navigator.locks && typeof navigator.locks.request === 'function';
    if (!canShare) { openStream(null); return; }

    try { channel = new BroadcastChannel('fab-live'); } catch (err) { openStream(null); return; }
    var post = function (msg) { try { channel.postMessage(msg); } catch (err) {} };

    channel.onmessage = function (ev) {
      var m = ev.data || {};
      if (m.t === 'event' && !leader) {
        heard = Date.now();
        deliver(m.kind, m.data);
      } else if (m.t === 'beat' && !leader) {
        heard = Date.now();
      } else if (m.t === 'hello' && leader) {
        // A page that just loaded: hand it the current state right away.
        ['state', 'settings', 'match'].forEach(function (k) {
          if (last[k] !== null) post({ t: 'event', kind: k, data: last[k] });
        });
      }
    };

    navigator.locks.request('fab-live', function () {
      leader = true;
      openStream(function (kind, data) { post({ t: 'event', kind: kind, data: data }); });
      setInterval(function () { post({ t: 'beat' }); }, 5000);
      return new Promise(function () {});          // hold the lock for good
    }).catch(function () { openStream(null); });

    heard = Date.now();
    post({ t: 'hello' });

    // Safety net: a follower that hears nothing from a leader for a while
    // stops trusting the shared channel and opens its own stream.
    setInterval(function () {
      if (!leader && !es && Date.now() - heard > 20000) openStream(null);
    }, 5000);
  }

  OV.onMatch    = function (fn) { handlers.match.push(fn);    connectLive(); };
  OV.onSettings = function (fn) { handlers.settings.push(fn); connectLive(); };
  OV.onLiveState = function (fn) { handlers.state.push(fn);   connectLive(); };
  // The event itself changed (another one selected, or the demo advanced):
  // re-read now rather than on the next poll.
  OV.onRefresh  = function (fn) { handlers.refresh.push(fn);  connectLive(); };

  // ── control token ──────────────────────────────────────────────────────────
  //
  // Reading is always open — OBS browser sources must never face a prompt.
  // Every write goes through here, on the config page and the tablet alike.

  var TOKEN_KEY = 'fab-control-token';

  OV.getToken = function () {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  };
  OV.setToken = function (t) {
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  };

  // Resolves to true once the PIN is accepted; the caller shows its own prompt.
  OV.login = function (pin) {
    return fetch('/api/control/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pin })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || 'Wrong PIN');
        OV.setToken(data.token || '');
        return data;
      });
    });
  };

  // Header bag for reads that return more once unlocked (/api/status,
  // /api/settings). Reads never fail without it, they just say less.
  OV.authHeaders = function () {
    var t = OV.getToken();
    return t ? { 'X-Control-Token': t } : {};
  };

  OV.getJson = function (path) {
    return fetch(path, { headers: OV.authHeaders() }).then(function (r) { return r.json(); });
  };

  /* POST helper for every guarded endpoint. On 403 it clears the stale token
   * and calls `onDenied` so the page can re-open its PIN prompt. */
  OV.post = function (path, body, onDenied) {
    var token = OV.getToken();
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-Control-Token'] = token;

    return fetch(path, { method: 'POST', headers: headers, body: JSON.stringify(body || {}) })
      .then(function (res) {
        if (res.status === 403) {
          OV.setToken('');
          if (onDenied) onDenied();
          // Callers test `err.denied`: the PIN prompt is already open, so
          // there is nothing left to report.
          var denied = new Error('PIN required');
          denied.denied = true;
          throw denied;
        }
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
          return data;
        });
      });
  };

  // ── settings ───────────────────────────────────────────────────────────────

  function applySettings(s, onChange) {
    var mode = urlMode || s.nameMode || OV.nameMode;  // ?names= always wins
    var lang = urlLang || (LANGS.indexOf(s.lang) >= 0 ? s.lang : OV.lang);   // so does ?lang=

    var theme = urlTheme || s.theme || OV.theme;      // and ?theme=
    if (theme !== OV.theme) {
      OV.theme = theme;
      OV.paintTheme();
    }
    if (s.theme) { try { localStorage.setItem(THEME_KEY, s.theme); } catch (e) {} }

    if (mode === OV.nameMode && lang === OV.lang) return;
    OV.nameMode = mode;
    OV.lang = lang;
    if (onChange) onChange();
  }

  /* Picks up the global name mode and language and keeps listening, so
   * switching either in the config UI re-renders every open overlay without
   * an OBS refresh.
   */
  OV.initSettings = function (onChange) {
    OV.onSettings(function (s) { applySettings(s, onChange); });
    return fetch('/api/settings')
      .then(function (r) { return r.json(); })
      .then(function (s) { applySettings(s, onChange); })
      .catch(function () { /* SSE will deliver it instead */ });
  };

  window.OV = OV;
})();
