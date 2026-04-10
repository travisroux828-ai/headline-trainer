(function () {
  'use strict';

  // --- DOM refs ---
  const headlineEl = document.getElementById('headline-display');
  const timerEl = document.getElementById('timer-display');
  const tickerInput = document.getElementById('ticker-input');
  const resultEl = document.getElementById('result-display');
  const historyBody = document.getElementById('history-body');

  const statAvg = document.getElementById('stat-avg');
  const statBest = document.getElementById('stat-best');
  const statAccuracy = document.getElementById('stat-accuracy');
  const statRound = document.getElementById('stat-round');

  const settingsBtn = document.getElementById('settings-btn');
  const settingsPanel = document.getElementById('settings-panel');
  const settingsOverlay = document.getElementById('settings-overlay');
  const settingsClose = document.getElementById('settings-close');
  const fileImport = document.getElementById('file-import');
  const importStatus = document.getElementById('import-status');
  const btnLoadDefault = document.getElementById('btn-load-default');
  const btnClearHistory = document.getElementById('btn-clear-history');
  const pastSessionsEl = document.getElementById('past-sessions');
  const toggleDelay = document.getElementById('toggle-delay');
  const toggleNoise = document.getElementById('toggle-noise');

  // --- Constants ---
  const SHORT_KEYS = new Set(['S', 'D', 'A', 'F', 'G']);
  const LONG_KEYS = new Set(['J', 'K', 'H', 'L', ';']);
  const RESULT_DISPLAY_MS = 1500;
  const LS_SESSIONS = 'headline-trainer-sessions';
  const LS_CUSTOM = 'headline-trainer-custom-headlines';
  const LS_BEST = 'headline-trainer-best-all-time';
  const LS_SETTINGS = 'headline-trainer-settings';
  const DELAY_MIN_MS = 1000;
  const DELAY_MAX_MS = 10000;

  // --- Settings ---
  const settings = loadSettings();

  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_SETTINGS));
      return {
        randomDelay: s && typeof s.randomDelay === 'boolean' ? s.randomDelay : true,
        noiseHeadlines: s && typeof s.noiseHeadlines === 'boolean' ? s.noiseHeadlines : true,
      };
    } catch (e) {
      return { randomDelay: true, noiseHeadlines: true };
    }
  }

  function saveSettings() {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
  }

  // --- State ---
  const state = {
    phase: 'idle', // 'idle' | 'waiting' | 'active' | 'locked' | 'result'
    headlines: [],
    currentIndex: 0,
    currentHeadline: null,
    timerStart: null,
    timerRAF: null,
    resultTimeout: null,
    waitingTimeout: null,
    session: {
      results: [],
      startedAt: null,
    },
  };

  // --- Headline Management ---
  function getHeadlines() {
    const custom = localStorage.getItem(LS_CUSTOM);
    if (custom) {
      try {
        const parsed = JSON.parse(custom);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) { /* fall through */ }
    }
    return window.DEFAULT_HEADLINES;
  }

  function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function initSession() {
    let src = getHeadlines();
    if (settings.noiseHeadlines && window.NOISE_HEADLINES) {
      src = src.concat(window.NOISE_HEADLINES);
    }
    state.headlines = shuffleArray(src);
    state.currentIndex = 0;
    state.session = { results: [], startedAt: Date.now() };
    updateStats();
    historyBody.innerHTML = '';
  }

  // --- Timer ---
  function startTimer() {
    state.timerStart = performance.now();
    timerEl.classList.add('running');
    updateTimerDisplay();
  }

  function updateTimerDisplay() {
    if (state.phase !== 'active' && state.phase !== 'locked') return;
    const elapsed = performance.now() - state.timerStart;
    timerEl.textContent = Math.floor(elapsed) + ' ms';
    state.timerRAF = requestAnimationFrame(updateTimerDisplay);
  }

  function stopTimer() {
    if (state.timerRAF) {
      cancelAnimationFrame(state.timerRAF);
      state.timerRAF = null;
    }
    timerEl.classList.remove('running');
  }

  // --- Show Headline ---
  function showHeadline() {
    if (state.currentIndex >= state.headlines.length) {
      endSession();
      return;
    }

    if (settings.randomDelay) {
      // Enter waiting phase with random delay
      state.phase = 'waiting';
      headlineEl.textContent = '';
      headlineEl.classList.add('idle');
      resultEl.textContent = '';
      resultEl.className = '';
      timerEl.textContent = '';
      tickerInput.disabled = true;
      tickerInput.value = '';

      const delay = DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS);
      state.waitingTimeout = setTimeout(function () {
        revealHeadline();
      }, delay);
    } else {
      revealHeadline();
    }
  }

  function revealHeadline() {
    state.currentHeadline = state.headlines[state.currentIndex];
    state.currentIndex++;
    state.phase = 'active';

    headlineEl.textContent = state.currentHeadline.text;
    headlineEl.classList.remove('idle');
    resultEl.textContent = '';
    resultEl.className = '';
    tickerInput.disabled = false;
    tickerInput.value = '';
    tickerInput.focus();

    statRound.textContent = state.currentIndex + ' / ' + state.headlines.length;
    startTimer();
  }

  // --- Submit Round ---
  function submitRound(action) {
    const elapsed = performance.now() - state.timerStart;
    stopTimer();

    const userTicker = tickerInput.value.trim().toUpperCase();
    const expected = state.currentHeadline;
    const timeMs = Math.round(elapsed);

    timerEl.textContent = timeMs + ' ms';
    tickerInput.disabled = true;
    tickerInput.classList.remove('locked');

    const isNoise = !!expected.noise;

    let tickerCorrect, directionCorrect = null;

    if (isNoise) {
      // Noise headline: correct action is to skip
      tickerCorrect = action === 'skip';
      directionCorrect = null;
    } else {
      tickerCorrect = userTicker === expected.ticker.toUpperCase() ||
        (expected.altTickers && expected.altTickers.map(t => t.toUpperCase()).includes(userTicker));

      if (action !== 'skip' && expected.direction !== null && expected.direction !== undefined) {
        directionCorrect = action === expected.direction;
      }
    }

    const result = {
      round: state.session.results.length + 1,
      headline: expected.text,
      expectedTicker: isNoise ? 'SKIP' : expected.ticker,
      userTicker: action === 'skip' ? '(skip)' : (userTicker || '(empty)'),
      expectedDirection: isNoise ? 'skip' : expected.direction,
      userDirection: action,
      tickerCorrect,
      directionCorrect,
      timeMs,
      skipped: action === 'skip',
      noise: isNoise,
    };

    state.session.results.push(result);
    showResult(result);
    addHistoryRow(result);
    updateStats();
    updateAllTimeBest(timeMs, result);

    state.phase = 'result';
    // Don't auto-advance — wait for Space to trigger next headline
  }

  // --- Result Display ---
  function showResult(r) {
    // Noise headline results
    if (r.noise) {
      if (r.skipped) {
        resultEl.textContent = 'CORRECT SKIP — Not actionable | ' + r.timeMs + ' ms';
        resultEl.className = 'correct';
      } else {
        resultEl.textContent = 'WRONG — Should have skipped (noise headline) | ' + r.timeMs + ' ms';
        resultEl.className = 'incorrect';
      }
      return;
    }

    if (r.skipped) {
      resultEl.textContent = 'SKIPPED — ' + r.expectedTicker;
      resultEl.className = 'skipped';
      return;
    }

    const parts = [];

    if (r.tickerCorrect) {
      parts.push(r.userTicker + ' \u2713');
    } else {
      parts.push(r.userTicker + ' \u2717 (was ' + r.expectedTicker + ')');
    }

    parts.push('|');

    const dirLabel = r.userDirection.toUpperCase();
    if (r.directionCorrect === null) {
      parts.push(dirLabel);
    } else if (r.directionCorrect) {
      parts.push(dirLabel + ' \u2713');
    } else {
      parts.push(dirLabel + ' \u2717 (was ' + (r.expectedDirection || 'n/a').toUpperCase() + ')');
    }

    parts.push('|');
    parts.push(r.timeMs + ' ms');

    resultEl.textContent = parts.join(' ');

    const allCorrect = r.tickerCorrect && (r.directionCorrect === null || r.directionCorrect);
    if (allCorrect) {
      resultEl.className = 'correct';
    } else if (r.tickerCorrect || r.directionCorrect) {
      resultEl.className = 'partial';
    } else {
      resultEl.className = 'incorrect';
    }
  }

  // --- History Table ---
  function addHistoryRow(r) {
    const tr = document.createElement('tr');

    const dirClass = r.userDirection === 'long' ? 'dir-long' : r.userDirection === 'short' ? 'dir-short' : '';
    const allCorrect = r.tickerCorrect && (r.directionCorrect === null || r.directionCorrect);

    let resultText, resultClass;
    if (r.skipped) {
      resultText = 'SKIP';
      resultClass = 'result-skip-cell';
    } else if (allCorrect) {
      resultText = '\u2713';
      resultClass = 'result-ok';
    } else {
      resultText = '\u2717';
      resultClass = 'result-fail';
    }

    tr.innerHTML =
      '<td>' + r.round + '</td>' +
      '<td class="headline-cell" title="' + escapeAttr(r.headline) + '">' + escapeHTML(r.headline) + '</td>' +
      '<td>' + r.expectedTicker + '</td>' +
      '<td class="' + (r.tickerCorrect ? 'result-ok' : 'result-fail') + '">' + escapeHTML(r.userTicker) + '</td>' +
      '<td class="' + dirClass + '">' + (r.skipped ? 'skip' : r.userDirection) + '</td>' +
      '<td class="time-cell">' + r.timeMs + ' ms</td>' +
      '<td class="' + resultClass + '">' + resultText + '</td>';

    historyBody.insertBefore(tr, historyBody.firstChild);
  }

  // --- Stats ---
  function updateStats() {
    const results = state.session.results;
    // For stats, count all non-skip results PLUS noise headlines (where skip IS the scored action)
    const scored = results.filter(r => !r.skipped || r.noise);

    if (scored.length === 0) {
      statAvg.textContent = '--';
      statBest.textContent = '--';
      statAccuracy.textContent = '--';
      return;
    }

    const times = scored.map(r => r.timeMs);
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    const best = Math.min(...times);
    const correct = scored.filter(function (r) {
      if (r.noise) return r.skipped; // noise: correct if skipped
      return r.tickerCorrect && (r.directionCorrect === null || r.directionCorrect);
    }).length;
    const accuracy = Math.round((correct / scored.length) * 100);

    statAvg.textContent = avg + ' ms';
    statBest.textContent = best + ' ms';
    statAccuracy.textContent = accuracy + '%';
  }

  function updateAllTimeBest(timeMs, result) {
    if (result.skipped) return;
    const allCorrect = result.tickerCorrect && (result.directionCorrect === null || result.directionCorrect);
    if (!allCorrect) return;

    const stored = parseInt(localStorage.getItem(LS_BEST), 10);
    if (isNaN(stored) || timeMs < stored) {
      localStorage.setItem(LS_BEST, timeMs);
    }
  }

  // --- Stop Session (user pressed Escape mid-session) ---
  function stopSession() {
    if (state.waitingTimeout) clearTimeout(state.waitingTimeout);
    stopTimer();
    state.phase = 'idle';
    tickerInput.disabled = true;
    tickerInput.classList.remove('locked');
    headlineEl.textContent = 'Session stopped. Press SPACE to restart';
    headlineEl.classList.add('idle');
    timerEl.textContent = '';
    saveSession();
  }

  // --- Session End ---
  function endSession() {
    state.phase = 'idle';
    stopTimer();
    tickerInput.disabled = true;
    headlineEl.textContent = 'Session complete! Press SPACE to restart';
    headlineEl.classList.add('idle');
    timerEl.textContent = '';

    saveSession();
  }

  function saveSession() {
    const results = state.session.results;
    const scored = results.filter(r => !r.skipped);
    if (scored.length === 0) return;

    const times = scored.map(r => r.timeMs);
    const correct = scored.filter(r => r.tickerCorrect && (r.directionCorrect === null || r.directionCorrect)).length;

    const summary = {
      date: new Date().toISOString(),
      rounds: results.length,
      avgTime: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
      bestTime: Math.min(...times),
      accuracy: Math.round((correct / scored.length) * 100),
    };

    let sessions = [];
    try {
      sessions = JSON.parse(localStorage.getItem(LS_SESSIONS)) || [];
    } catch (e) { /* ignore */ }

    sessions.unshift(summary);
    if (sessions.length > 50) sessions = sessions.slice(0, 50);
    localStorage.setItem(LS_SESSIONS, JSON.stringify(sessions));
  }

  // --- Key Handling ---
  document.addEventListener('keydown', function (e) {
    // Settings toggle
    if (e.key === 'Escape') {
      e.preventDefault();
      // If in an active session, stop it
      if (state.phase === 'waiting' || state.phase === 'active' || state.phase === 'locked' || state.phase === 'result') {
        stopSession();
        return;
      }
      toggleSettings();
      return;
    }

    // Ignore keys when settings open
    if (!settingsPanel.classList.contains('hidden')) return;

    // Space to start/advance
    if (e.key === ' ' || e.code === 'Space') {
      if (state.phase === 'idle') {
        e.preventDefault();
        initSession();
        showHeadline();
        return;
      }
      if (state.phase === 'result') {
        e.preventDefault();
        showHeadline();
        return;
      }
      // In active/locked phase, space goes into input — don't prevent
      return;
    }

    // --- ACTIVE phase: typing ticker, press Enter to lock it in ---
    if (state.phase === 'active') {
      if (e.key === 'Enter') {
        e.preventDefault();
        // Lock in the ticker, now waiting for direction key
        state.phase = 'locked';
        tickerInput.disabled = true;
        tickerInput.classList.add('locked');
        return;
      }

      if (e.key === 'Delete') {
        e.preventDefault();
        submitRound('skip');
        return;
      }

      // All other keys flow into the input
      if (document.activeElement !== tickerInput) {
        tickerInput.focus();
      }
      return;
    }

    // --- LOCKED phase: ticker submitted, waiting for direction key ---
    if (state.phase === 'locked') {
      if (e.shiftKey) {
        const key = e.key === ';' ? ';' : e.key.toUpperCase();
        if (LONG_KEYS.has(key) || e.key === ';') {
          e.preventDefault();
          submitRound('long');
          return;
        }
        if (SHORT_KEYS.has(key)) {
          e.preventDefault();
          submitRound('short');
          return;
        }
      }

      if (e.key === 'Delete') {
        e.preventDefault();
        submitRound('skip');
        return;
      }
      return;
    }
  });

  // Clicking arena refocuses input
  document.getElementById('arena').addEventListener('click', function () {
    if (state.phase === 'active') {
      tickerInput.focus();
    }
  });

  // --- Settings ---
  function toggleSettings() {
    const isHidden = settingsPanel.classList.contains('hidden');
    if (isHidden) {
      settingsPanel.classList.remove('hidden');
      settingsOverlay.classList.remove('hidden');
      toggleDelay.checked = settings.randomDelay;
      toggleNoise.checked = settings.noiseHeadlines;
      renderPastSessions();
    } else {
      settingsPanel.classList.add('hidden');
      settingsOverlay.classList.add('hidden');
      if (state.phase === 'active') tickerInput.focus();
    }
  }

  settingsBtn.addEventListener('click', toggleSettings);
  settingsClose.addEventListener('click', toggleSettings);
  settingsOverlay.addEventListener('click', toggleSettings);

  // Drill option toggles
  toggleDelay.addEventListener('change', function () {
    settings.randomDelay = toggleDelay.checked;
    saveSettings();
  });

  toggleNoise.addEventListener('change', function () {
    settings.noiseHeadlines = toggleNoise.checked;
    saveSettings();
  });

  // File import
  fileImport.addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (evt) {
      try {
        const data = JSON.parse(evt.target.result);
        const validation = validateHeadlines(data);
        if (!validation.valid) {
          importStatus.textContent = 'Error: ' + validation.error;
          importStatus.className = 'error';
          return;
        }
        localStorage.setItem(LS_CUSTOM, JSON.stringify(data));
        importStatus.textContent = 'Loaded ' + data.length + ' headlines. Start new session to use them.';
        importStatus.className = 'success';
      } catch (err) {
        importStatus.textContent = 'Error: Invalid JSON file';
        importStatus.className = 'error';
      }
    };
    reader.readAsText(file);
  });

  function validateHeadlines(data) {
    if (!Array.isArray(data)) return { valid: false, error: 'Must be a JSON array' };
    if (data.length === 0) return { valid: false, error: 'Array is empty' };
    for (let i = 0; i < data.length; i++) {
      const h = data[i];
      if (!h.text || typeof h.text !== 'string')
        return { valid: false, error: 'Entry ' + i + ': missing "text"' };
      if (!h.ticker || typeof h.ticker !== 'string')
        return { valid: false, error: 'Entry ' + i + ': missing "ticker"' };
      if (h.direction && !['long', 'short'].includes(h.direction))
        return { valid: false, error: 'Entry ' + i + ': direction must be "long" or "short"' };
    }
    return { valid: true };
  }

  btnLoadDefault.addEventListener('click', function () {
    localStorage.removeItem(LS_CUSTOM);
    importStatus.textContent = 'Reset to default headlines. Start new session to apply.';
    importStatus.className = 'success';
    fileImport.value = '';
  });

  // Past sessions
  function renderPastSessions() {
    let sessions = [];
    try {
      sessions = JSON.parse(localStorage.getItem(LS_SESSIONS)) || [];
    } catch (e) { /* ignore */ }

    if (sessions.length === 0) {
      pastSessionsEl.innerHTML = '<div style="color:#666">No past sessions</div>';
      return;
    }

    pastSessionsEl.innerHTML = sessions.map(function (s) {
      const d = new Date(s.date);
      const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return '<div class="session-entry">' +
        '<span class="session-date">' + dateStr + '</span>' +
        '<span class="session-stats">' + s.rounds + 'r | ' + s.avgTime + 'ms avg | ' + s.bestTime + 'ms best | ' + s.accuracy + '%</span>' +
        '</div>';
    }).join('');
  }

  btnClearHistory.addEventListener('click', function () {
    localStorage.removeItem(LS_SESSIONS);
    localStorage.removeItem(LS_BEST);
    renderPastSessions();
  });

  // --- Helpers ---
  function escapeHTML(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // --- Init ---
  headlineEl.classList.add('idle');
  tickerInput.disabled = true;

})();
