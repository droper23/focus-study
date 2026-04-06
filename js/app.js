import { parseUserUrl, checkNavigation, parseHostList } from './security.js';
import {
  getState,
  persist,
  updateStats,
  setPassword,
  verifyPassword,
  parseStrictDomains
} from './storage.js';

const $ = (sel) => document.querySelector(sel);

let state = getState();
let sessionStart = 0;
let sessionBlocked = 0;
let sessionFocusMs = 0;
let focusTick = null;
let visitStart = null;
let currentHost = '';
let pomodoro = {
  phase: 'idle',
  remainingSec: 25 * 60,
  timerId: null,
  mode: 'work'
};

const els = {};

function syncNavContextToMain() {
  try {
    window.electronAPI?.sendNavContext?.(navContext());
  } catch {
    /* ignore */
  }
}

function init() {
  els.app = $('#app');
  els.gate = $('#focusGate');
  els.siteFrame = $('#siteFrame');
  els.siteWebview = $('#siteWebview');
  els.urlInput = $('#urlInput');
  els.btnGo = $('#btnGo');
  els.btnBack = $('#btnBack');
  els.iframeBlock = $('#iframeBlockOverlay');
  els.blockReason = $('#blockReason');
  els.sessionClock = $('#sessionClock');
  els.blockedBadge = $('#blockedBadge');
  els.runtimeBadge = $('#runtimeBadge');
  els.browserHint = $('#browserHint');
  els.whitelistMode = $('#whitelistMode');
  els.exitModal = $('#exitModal');
  els.exitDelayPanel = $('#exitDelayPanel');
  els.exitPasswordPanel = $('#exitPasswordPanel');
  els.exitCountdown = $('#exitCountdown');
  els.pomodoroDisplay = $('#pomodoroDisplay');
  els.statsSummary = $('#statsSummary');
  els.smartSuggestions = $('#smartSuggestions');
  els.strictDomains = $('#strictDomains');

  els.useElectron =
    typeof window.electronAPI !== 'undefined' && window.electronAPI.isElectron === true;
  if (els.useElectron) {
    els.siteFrame.classList.add('hidden');
    els.siteWebview.classList.remove('hidden');
    els.browserSurface = els.siteWebview;
    els.siteWebview.src = 'about:blank';
    if (els.runtimeBadge && window.electronAPI.chromeVersion) {
      els.runtimeBadge.textContent = `Chromium ${window.electronAPI.chromeVersion.split('.').slice(0, 2).join('.')}`;
      els.runtimeBadge.classList.remove('hidden');
    }
    if (els.browserHint) {
      els.browserHint.textContent =
        'Desktop: navigations are filtered by Chromium (session-level). In-page links respect your lists.';
    }
    els.siteWebview.addEventListener('did-navigate', onWebviewNavigate);
  } else {
    els.siteWebview.classList.add('hidden');
    els.siteWebview.style.display = 'none';
    els.browserSurface = els.siteFrame;
    els.siteFrame.src = 'about:blank';
    if (els.browserHint) {
      els.browserHint.textContent =
        'Browser build: use the address bar for navigation; cross-origin pages cannot be fully inspected.';
    }
    els.siteFrame.addEventListener('load', onFrameLoad);
  }

  $('#btnEnterFocus').addEventListener('click', enterFocus);
  document.addEventListener('keydown', onGateKey);

  $('#btnExitFocus').addEventListener('click', openExitModal);
  $('#exitBackdrop').addEventListener('click', closeExitModal);
  $('#btnCancelExit').addEventListener('click', closeExitModal);
  $('#btnCancelExit2').addEventListener('click', closeExitModal);
  $('#btnConfirmExit').addEventListener('click', confirmPasswordExit);

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => showPanel(btn.dataset.panel));
  });

  document.addEventListener('keydown', onGlobalShortcut);

  els.btnGo.addEventListener('click', () => navigateFromBar());
  els.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') navigateFromBar();
  });

  els.btnBack.addEventListener('click', () => {
    if (els.useElectron) {
      try {
        if (els.siteWebview.canGoBack()) els.siteWebview.goBack();
      } catch {
        /* ignore */
      }
    } else {
      try {
        els.siteFrame.contentWindow.history.back();
      } catch {
        /* cross-origin */
      }
    }
  });

  els.whitelistMode.addEventListener('change', () => {
    state = persist({ whitelistMode: els.whitelistMode.checked });
    syncNavContextToMain();
  });

  $('#taskForm').addEventListener('submit', onTaskAdd);
  $('#btnSaveSettings').addEventListener('click', saveSettingsUi);

  $('#btnPomStart').addEventListener('click', pomStart);
  $('#btnPomPause').addEventListener('click', pomPause);
  $('#btnPomReset').addEventListener('click', pomReset);
  ['setWork', 'setShort', 'setLong'].forEach((id) => {
    $(`#${id}`).addEventListener('change', savePomSettings);
  });

  window.addEventListener('beforeunload', onBeforeUnload);

  window.open = function () {
    return null;
  };

  hydrateUi();
  syncNavContextToMain();
  updateStatsSummary();
  renderSuggestions();
}

function hydrateUi() {
  state = getState();
  els.whitelistMode.checked = state.whitelistMode;
  $('#blockedList').value = state.blocked.join('\n');
  $('#allowedList').value = state.allowed.join('\n');
  $('#strictMode').checked = state.strictMode;
  els.strictDomains.value = state.strictDomains.join('\n');
  $('#setWork').value = state.pomodoro.work;
  $('#setShort').value = state.pomodoro.short;
  $('#setLong').value = state.pomodoro.long;
  pomodoro.remainingSec = state.pomodoro.work * 60;
  updatePomDisplay();

  const exitRadios = document.querySelectorAll('input[name="exitMode"]');
  exitRadios.forEach((r) => {
    r.checked = r.value === state.exitMode;
    r.addEventListener('change', () => {
      state = persist({ exitMode: r.value });
    });
  });
  $('#exitDelay').value = state.exitDelaySec;

  renderTasks();
}

function onGateKey(e) {
  if (els.gate.classList.contains('hidden')) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    enterFocus();
  }
}

function enterFocus() {
  els.gate.classList.add('hidden');
  els.app.classList.remove('hidden');
  sessionStart = Date.now();
  sessionBlocked = 0;
  sessionFocusMs = 0;
  visitStart = null;
  currentHost = '';

  if (focusTick) clearInterval(focusTick);
  focusTick = setInterval(() => {
    sessionFocusMs += 1000;
    updateSessionClock();
  }, 1000);

  document.documentElement.requestFullscreen?.().catch(() => {});

  els.urlInput.focus();
  showPanel('browser');
}

function updateSessionClock() {
  const totalSec = Math.floor(sessionFocusMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  els.sessionClock.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function showPanel(name) {
  document.querySelectorAll('.panel').forEach((p) => {
    p.hidden = p.id !== `panel-${name}`;
    p.classList.toggle('active', p.id === `panel-${name}`);
  });
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.panel === name);
  });
  if (name === 'settings') {
    updateStatsSummary();
    renderSuggestions();
  }
}

function onGlobalShortcut(e) {
  if (els.gate && !els.gate.classList.contains('hidden')) return;
  if (e.target.matches('input, textarea')) {
    if (e.altKey && e.key === 'Escape') e.target.blur();
    return;
  }
  if (!e.altKey) return;
  const map = { b: 'browser', t: 'tasks', p: 'timer', s: 'settings' };
  const k = e.key.toLowerCase();
  if (map[k]) {
    e.preventDefault();
    showPanel(map[k]);
  }
}

function navContext() {
  state = getState();
  return {
    blocked: state.blocked,
    allowed: state.allowed,
    whitelistMode: state.whitelistMode,
    strictMode: state.strictMode,
    strictDomains: state.strictDomains
  };
}

function navigateFromBar() {
  const raw = els.urlInput.value;
  const parsed = parseUserUrl(raw);
  if (!parsed.ok) {
    showBlock(parsed.error);
    recordBlockedAttempt('invalid');
    return;
  }

  endVisitTracking();

  const res = checkNavigation(parsed.hostname, navContext());
  if (!res.allowed) {
    showBlock(res.reason);
    recordBlockedAttempt(parsed.hostname);
    logSwitch(parsed.hostname, false);
    return;
  }

  hideBlock();
  if (els.useElectron) {
    els.siteWebview.src = parsed.url;
  } else {
    els.siteFrame.src = parsed.url;
    currentHost = parsed.hostname;
    visitStart = Date.now();
  }
  logSwitch(parsed.hostname, true);
}

function showBlock(msg) {
  els.iframeBlock.classList.remove('hidden');
  els.blockReason.textContent = msg;
  sessionBlocked += 1;
  els.blockedBadge.textContent = `${sessionBlocked} blocked`;
}

function hideBlock() {
  els.iframeBlock.classList.add('hidden');
}

function recordBlockedAttempt(host) {
  updateStats((s) => ({
    ...s,
    totalBlocked: (s.totalBlocked || 0) + 1
  }));
}

function onFrameLoad() {
  hideBlock();
  let href = '';
  try {
    href = els.siteFrame.contentWindow.location.href;
  } catch {
    return;
  }

  if (!href || href === 'about:blank') return;

  let hostname = '';
  try {
    hostname = new URL(href).hostname.toLowerCase();
  } catch {
    return;
  }

  const res = checkNavigation(hostname, navContext());
  if (!res.allowed) {
    els.siteFrame.src = 'about:blank';
    showBlock(res.reason);
    recordBlockedAttempt(hostname);
  } else {
    endVisitTracking();
    currentHost = hostname;
    visitStart = Date.now();
  }
}

function onWebviewNavigate(e) {
  if (!e.url || e.url.startsWith('about:')) return;
  hideBlock();
  try {
    const hostname = new URL(e.url).hostname.toLowerCase();
    const res = checkNavigation(hostname, navContext());
    if (!res.allowed) {
      els.siteWebview.src = 'about:blank';
      showBlock(res.reason);
      recordBlockedAttempt(hostname);
      return;
    }
    endVisitTracking();
    currentHost = hostname;
    visitStart = Date.now();
  } catch {
    /* ignore */
  }
}

function endVisitTracking() {
  if (visitStart && currentHost) {
    const dur = Date.now() - visitStart;
    const st = getState();
    const visits = [...(st.smart?.visits || [])];
    visits.push({ host: currentHost, durationMs: dur, t: Date.now() });
    persist({
      smart: {
        ...st.smart,
        visits: visits.slice(-200)
      }
    });
  }
  visitStart = null;
}

function logSwitch(host, allowed) {
  const st = getState();
  const log = [...(st.smart?.switchLog || [])];
  log.push({ t: Date.now(), host, allowed });
  persist({
    smart: {
      ...st.smart,
      switchLog: log.slice(-500)
    }
  });
}

function openExitModal() {
  endVisitTracking();
  state = getState();
  if (state.exitMode === 'password' && state.passwordHash) {
    els.exitPasswordPanel.hidden = false;
    els.exitDelayPanel.hidden = true;
    $('#exitPasswordInput').value = '';
  } else {
    els.exitPasswordPanel.hidden = true;
    els.exitDelayPanel.hidden = false;
    startExitCountdown();
  }
  els.exitModal.classList.remove('hidden');
  if (!els.exitPasswordPanel.hidden) {
    $('#exitPasswordInput').focus();
  }
}

let exitTimer = null;
function startExitCountdown() {
  if (exitTimer) clearInterval(exitTimer);
  let left = state.exitDelaySec || 30;
  els.exitCountdown.textContent = String(left);
  exitTimer = setInterval(() => {
    left -= 1;
    els.exitCountdown.textContent = String(left);
    if (left <= 0) {
      clearInterval(exitTimer);
      exitTimer = null;
      finalizeExit();
    }
  }, 1000);
}

function closeExitModal() {
  if (exitTimer) {
    clearInterval(exitTimer);
    exitTimer = null;
  }
  els.exitModal.classList.add('hidden');
}

async function confirmPasswordExit() {
  const pw = $('#exitPasswordInput').value;
  const ok = await verifyPassword(pw);
  if (ok) {
    finalizeExit();
  } else {
    $('#exitPasswordInput').value = '';
    $('#exitPasswordInput').placeholder = 'Wrong password';
  }
}

function finalizeExit() {
  closeExitModal();
  if (focusTick) {
    clearInterval(focusTick);
    focusTick = null;
  }
  pomPause();

  updateStats((s) => ({
    ...s,
    totalFocusMs: (s.totalFocusMs || 0) + sessionFocusMs,
    sessions: [
      ...(s.sessions || []),
      {
        end: Date.now(),
        focusMs: sessionFocusMs,
        blocked: sessionBlocked
      }
    ].slice(-100)
  }));

  document.exitFullscreen?.().catch(() => {});

  els.app.classList.add('hidden');
  els.gate.classList.remove('hidden');
}

function onBeforeUnload(e) {
  if (!els.app.classList.contains('hidden')) {
    e.preventDefault();
    e.returnValue = '';
  }
}

function onTaskAdd(e) {
  e.preventDefault();
  const input = $('#taskInput');
  const text = input.value.trim().slice(0, 500);
  if (!text) return;
  state = getState();
  const tasks = [
    ...state.tasks,
    { id: `t-${Date.now()}`, text, done: false }
  ];
  state = persist({ tasks });
  input.value = '';
  renderTasks();
}

function renderTasks() {
  state = getState();
  const ul = $('#taskList');
  ul.innerHTML = '';
  state.tasks.forEach((task) => {
    const li = document.createElement('li');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = task.done;
    cb.addEventListener('change', () => {
      state = getState();
      const tasks = state.tasks.map((t) =>
        t.id === task.id ? { ...t, done: cb.checked } : t
      );
      persist({ tasks });
    });
    const span = document.createElement('span');
    span.textContent = task.text;
    if (task.done) span.style.textDecoration = 'line-through';
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Remove';
    del.addEventListener('click', () => {
      state = getState();
      persist({ tasks: state.tasks.filter((t) => t.id !== task.id) });
      renderTasks();
    });
    li.append(cb, span, del);
    ul.appendChild(li);
  });
}

function saveSettingsUi() {
  const blocked = parseHostList($('#blockedList').value);
  const allowed = parseHostList($('#allowedList').value);
  const strictDomains = parseStrictDomains($('#strictDomains').value);
  const strictMode = $('#strictMode').checked;
  const exitDelaySec = clamp(
    parseInt($('#exitDelay').value, 10),
    5,
    600,
    30
  );
  const exitMode =
    document.querySelector('input[name="exitMode"]:checked')?.value === 'password'
      ? 'password'
      : 'delay';

  state = persist({
    blocked,
    allowed,
    strictMode,
    strictDomains,
    exitDelaySec,
    exitMode
  });

  const pw = $('#exitPassword').value;
  if (pw) {
    setPassword(pw).then(() => {
      $('#exitPassword').value = '';
    });
  }

  updateStatsSummary();
  renderSuggestions();
  syncNavContextToMain();
}

function clamp(n, a, b, d) {
  if (Number.isNaN(n)) return d;
  return Math.min(b, Math.max(a, n));
}

function savePomSettings() {
  state = persist({
    pomodoro: {
      work: clamp(parseInt($('#setWork').value, 10), 1, 120, 25),
      short: clamp(parseInt($('#setShort').value, 10), 1, 60, 5),
      long: clamp(parseInt($('#setLong').value, 10), 1, 60, 15)
    }
  });
}

function updatePomDisplay() {
  const m = Math.floor(pomodoro.remainingSec / 60);
  const s = pomodoro.remainingSec % 60;
  els.pomodoroDisplay.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function pomStart() {
  state = getState();
  if (pomodoro.timerId) return;
  pomodoro.timerId = setInterval(() => {
    state = getState();
    if (pomodoro.remainingSec <= 0) {
      updatePomDisplay();
      return;
    }
    pomodoro.remainingSec -= 1;
    updatePomDisplay();
    if (pomodoro.remainingSec > 0) return;
    if (pomodoro.mode === 'work') {
      pomodoro.mode = 'short';
      pomodoro.remainingSec = state.pomodoro.short * 60;
    } else {
      pomodoro.mode = 'work';
      pomodoro.remainingSec = state.pomodoro.work * 60;
    }
    updatePomDisplay();
  }, 1000);
}

function pomPause() {
  if (pomodoro.timerId) {
    clearInterval(pomodoro.timerId);
    pomodoro.timerId = null;
  }
}

function pomReset() {
  pomPause();
  state = getState();
  pomodoro.remainingSec = state.pomodoro.work * 60;
  pomodoro.mode = 'work';
  updatePomDisplay();
}

function updateStatsSummary() {
  state = getState();
  const m = Math.floor((state.stats.totalFocusMs || 0) / 60000);
  els.statsSummary.textContent = `Total focus ~${m} min · Lifetime blocked ${state.stats.totalBlocked || 0}`;
}

function renderSuggestions() {
  state = getState();
  const log = state.smart?.switchLog || [];
  const now = Date.now();
  const recent = log.filter((x) => now - x.t < 5 * 60 * 1000);
  const hosts = new Set(recent.map((x) => x.host).filter(Boolean));
  const lines = [];
  if (hosts.size >= 5) {
    lines.push('Frequent switching detected — consider strict mode (1–3 domains) or blocking more hosts.');
  }

  const visits = state.smart?.visits || [];
  const shortCounts = {};
  for (const v of visits.slice(-50)) {
    if (v.durationMs < 15000 && v.durationMs > 0) {
      shortCounts[v.host] = (shortCounts[v.host] || 0) + 1;
    }
  }
  for (const [h, c] of Object.entries(shortCounts)) {
    if (c >= 3) {
      lines.push(`Short visits to ${h} — consider adding to blocklist.`);
    }
  }

  if (!lines.length) {
    els.smartSuggestions.innerHTML = '<p class="muted small">No suggestions yet.</p>';
  } else {
    els.smartSuggestions.innerHTML = '<ul>' + lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('') + '</ul>';
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

init();
