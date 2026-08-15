/* Shared helpers for every overlay and the control page.
 *
 * Loaded as a plain <script> — no modules, no build step, matching the rest of
 * the project. Everything hangs off the global `OV`.
 */
(function () {
  'use strict';

  var P = new URLSearchParams(location.search);
  var NAME_MODES = ['full', 'short', 'initials'];

  var urlMode = NAME_MODES.indexOf(P.get('names')) >= 0 ? P.get('names') : null;

  var OV = {
    params:    P,
    eventId:   P.get('eventId') || '',
    refreshMs: (parseInt(P.get('refresh'), 10) || 30) * 1000,
    nameMode:  urlMode || 'short',  // provisional until the server answers
    young:     false
  };

  // Appended to /api/* calls so an overlay can pin a different event.
  OV.query = OV.eventId ? '?eventId=' + encodeURIComponent(OV.eventId) : '';

  // ── text ───────────────────────────────────────────────────────────────────

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  OV.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  };

  // GEM writes "Schauer, Alexander"; the CSVs sometimes write "Alexander Schauer".
  function normalizeName(n) {
    var s = String(n == null ? '' : n).trim();
    if (!s) return '';
    if (s.indexOf(',') === -1) return s;
    return s.split(',').reverse().map(function (x) { return x.trim(); })
            .filter(Boolean).join(' ');
  }

  /* Name display, GDPR-relevant:
   *   full     → Alexander Schauer
   *   short    → Alexander S.        (default)
   *   initials → A. S.
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

  // ── hero artwork ───────────────────────────────────────────────────────────

  // Young heroes (Blitz, Draft, Sealed, Commoner) have their own printing and
  // artwork; Classic Constructed uses the adult one.
  OV.setFormat = function (format) {
    OV.young = /blitz|draft|sealed|versiegelt|booster|commoner|limited/i.test(String(format || ''));
  };

  OV.heroImageUrl = function (name, young) {
    var y = (young === undefined) ? OV.young : young;
    return '/api/hero-image?name=' + encodeURIComponent(name) + (y ? '&young=1' : '');
  };

  // Square hero portrait: placeholder letter behind, artwork fades in on top.
  OV.hw = function (name, px, opts) {
    var o = opts || {};
    var size = px + 'px';
    var cls  = 'hero-wrap' + (o.className ? ' ' + o.className : '');
    var ph   = '<div class="hero-ph">' + OV.esc(String(name || '?').charAt(0)) + '</div>';
    var box  = '<div class="' + cls + '" style="width:' + size + ';height:' + size + '">';

    if (!name) return box + ph + '</div>';

    return box + ph +
      '<img class="hero-img" alt="" src="' + OV.esc(OV.heroImageUrl(name, o.young)) + '" ' +
      'onload="this.style.opacity=1" onerror="this.style.display=\'none\'"></div>';
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

  OV.badgeOk = function (sec) {
    var sb = badgeEl();
    if (sb) sb.className = '';
    OV.startCountdown(sec);
  };

  // ── live channel (SSE) ─────────────────────────────────────────────────────

  var es = null;
  var handlers = { match: [], settings: [], state: [] };

  function emit(kind, payload) {
    handlers[kind].forEach(function (fn) {
      try { fn(payload); } catch (err) { console.error('[OV]', kind, 'handler failed:', err); }
    });
  }

  // EventSource reconnects on its own using the server's `retry:` hint, so a
  // dropped Wi-Fi link or an OBS scene switch heals without any code here.
  function connectLive() {
    if (es) return;
    try { es = new EventSource('/api/live'); } catch (err) { return; }

    es.addEventListener('match', function (e) {
      emit('state', 'live');
      emit('match', JSON.parse(e.data));
    });
    es.addEventListener('settings', function (e) { emit('settings', JSON.parse(e.data)); });
    es.addEventListener('open',  function () { emit('state', 'live'); });
    es.addEventListener('error', function () { emit('state', 'offline'); });
  }

  OV.onMatch    = function (fn) { handlers.match.push(fn);    connectLive(); };
  OV.onSettings = function (fn) { handlers.settings.push(fn); connectLive(); };
  OV.onLiveState = function (fn) { handlers.state.push(fn);   connectLive(); };

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
        if (!res.ok) throw new Error(data.error || 'Falscher PIN');
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
          throw new Error('PIN erforderlich');
        }
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
          return data;
        });
      });
  };

  // ── settings ───────────────────────────────────────────────────────────────

  function applySettings(s, onChange) {
    var next = urlMode || s.nameMode;                 // ?names= always wins
    if (!next || next === OV.nameMode) return;
    OV.nameMode = next;
    if (onChange) onChange();
  }

  /* Picks up the global name mode and keeps listening, so switching it in the
   * config UI re-renders every open overlay without an OBS refresh.
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
