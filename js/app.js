import {
  resolveOmniboxInput,
  checkNavigation,
  parseHostList,
  searchProviderHostFromTemplate
} from './security.js';
import {
  getState,
  persist,
  updateStats,
  setPassword,
  verifyPassword,
  parseStrictDomains,
  addUrlToHistory
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
  mode: 'work',
  workCount: 0,
  started: false
};
let heroDocked = false;

const els = {};

function syncNavContextToMain() {
  try {
    window.electronAPI?.sendNavContext?.(navContext());
  } catch {
    /* ignore */
  }
}

let datalistTimer = null;
function populateUrlDatalist() {
  const dl = $('#urlDatalist');
  const input = els.urlInput || $('#urlInput');
  if (!dl || !input) return;
  const q = input.value.trim().toLowerCase();
  state = getState();
  const hist = state.urlHistory || [];
  const allowed = state.allowed || [];
  const strict = state.strictDomains || [];
  const suggestions = [];
  const seen = new Set();
  const push = (v) => {
    if (!v || seen.has(v)) return;
    seen.add(v);
    suggestions.push(v);
  };
  for (const u of hist) {
    if (!q || u.toLowerCase().includes(q)) push(u);
  }
  for (const h of [...allowed, ...strict]) {
    if (!h) continue;
    const full = `https://${h}`;
    if (!q || full.toLowerCase().includes(q) || h.includes(q)) push(full);
  }
  const searchHost = searchProviderHostFromTemplate(state.searchUrlTemplate);
  if (searchHost) {
    const sample = `https://${searchHost}/`;
    if (!q || sample.includes(q)) push(sample);
  }
  dl.innerHTML = '';
  suggestions.slice(0, 30).forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v;
    dl.appendChild(opt);
  });
}

let settingsSaveTimer = null;
function scheduleSaveSettings() {
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(() => {
    saveSettingsUi();
  }, 350);
}

function schedulePopulateUrlDatalist() {
  clearTimeout(datalistTimer);
  datalistTimer = setTimeout(() => populateUrlDatalist(), 100);
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
  els.topbarLeft = $('#topbarLeft');
  els.browserHint = $('#browserHint');
  els.heroTimer = $('#heroTimer');
  els.heroTime = $('#heroTime');
  els.exitModal = $('#exitModal');
  els.exitDelayPanel = $('#exitDelayPanel');
  els.exitPasswordPanel = $('#exitPasswordPanel');
  els.exitCountdown = $('#exitCountdown');
  els.goalMinutes = $('#goalMinutes');
  els.goalFill = $('#goalFill');
  els.goalMeta = $('#goalMeta');
  els.btnPomStart = $('#btnPomStart');
  els.btnPomPause = $('#btnPomPause');
  els.btnPomReset = $('#btnPomReset');
  els.setLongEvery = $('#setLongEvery');
  els.pomodoroDisplay = $('#pomodoroDisplay');
  els.pomodoroProgress = $('#pomodoroProgress');
  els.pomodoroNextTime = $('#pomodoroNextTime');
  els.pomodoroNextLabel = $('#pomodoroNextLabel');
  els.btnPomSkip = $('#btnPomSkip');
  els.wheelSpin = $('#wheelSpin');
  els.taskWheel = $('#taskWheel');
  els.wheelResult = $('#wheelResult');
  els.wheelPopup = $('#wheelPopup');
  els.wheelPopupText = $('#wheelPopupText');
  els.wheelPopupOk = $('#wheelPopupOk');
  els.wheelPopupRemove = $('#wheelPopupRemove');
  els.confettiCanvas = $('#confettiCanvas');
  els.wheelMenuBtn = $('#wheelMenuBtn');
  els.wheelMenu = $('#wheelMenu');
  els.wheelColorList = $('#wheelColorList');
  els.wheelTextScale = $('#wheelTextScale');
  els.wheelTextScaleValue = $('#wheelTextScaleValue');
  els.ambientToggle = $('#ambientToggle');
  els.ambientVolume = $('#ambientVolume');
  els.historyList = $('#historyList');
  els.accentColor = $('#accentColor');
  els.uiScale = $('#uiScale');
  els.uiScaleValue = $('#uiScaleValue');
  els.themeMode = $('#themeMode');
  els.reduceMotion = $('#reduceMotion');
  els.compactMode = $('#compactMode');
  els.statsSummaryLarge = $('#statsSummaryLarge');
  els.focusChart = $('#focusChart');
  els.sessionChart = $('#sessionChart');
  els.chartTooltip = $('#chartTooltip');
  els.statTotal = $('#statTotal');
  els.statSessions = $('#statSessions');
  els.statAvg = $('#statAvg');
  els.statBest = $('#statBest');
  els.statStreak = $('#statStreak');
  els.exitDelayRow = $('#exitDelayRow');
  els.exitPasswordRow = $('#exitPasswordRow');
  els.strictDomains = $('#strictDomains');
  els.completedTasksSection = $('#completedTasksSection');
  els.completedTaskList = $('#completedTaskList');

  els.useElectron =
    (typeof window.electronAPI !== 'undefined' && window.electronAPI.isElectron === true) || navigator.userAgent.includes('FocusStudy-Electron');
  if (els.siteWebview || els.siteFrame) {
    if (els.useElectron && els.siteWebview) {
      // Electron: use the full Chromium <webview> engine
      if (els.siteFrame) els.siteFrame.classList.add('hidden');
      els.siteWebview.classList.remove('hidden');
      els.browserSurface = els.siteWebview;
      els.siteWebview.src = 'about:blank';
      if (els.browserHint) {
        els.browserHint.textContent =
          'Desktop: full Chromium engine — all sites work. Block rules applied to every request.';
      }
      els.siteWebview.addEventListener('did-navigate', onWebviewNavigate);
    } else if (els.siteFrame) {
      // Web fallback
      if (els.siteWebview) {
        els.siteWebview.classList.add('hidden');
        els.siteWebview.style.display = 'none';
      }
      els.siteFrame.classList.remove('hidden');
      els.siteFrame.style.display = 'block';
      els.browserSurface = els.siteFrame;
      els.siteFrame.src = 'about:blank';
      if (els.browserHint) {
        els.browserHint.textContent =
          'Web mode: uses iframe. Many sites may block embedding due to X-Frame-Options.';
      }
      els.siteFrame.addEventListener('load', onFrameLoad);
    }
  }

  $('#btnEnterFocus').addEventListener('click', enterFocus);
  document.addEventListener('keydown', onGateKey);

  $('#btnExitFocus').addEventListener('click', openExitModal);
  $('#exitBackdrop').addEventListener('click', closeExitModal);
  $('#btnCancelExit').addEventListener('click', closeExitModal);
  $('#btnCancelExit2').addEventListener('click', closeExitModal);
  $('#btnConfirmExit').addEventListener('click', confirmPasswordExit);

  // Pressing Enter in the exit password input confirms exit
  $('#exitPasswordInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmPasswordExit();
  });

  // Auto-save settings on change/input
  const settingsPanel = $('#panel-settings');
  if (settingsPanel) {
    settingsPanel.addEventListener('input', scheduleSaveSettings);
    settingsPanel.addEventListener('change', scheduleSaveSettings);
  }

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => showPanel(btn.dataset.panel));
  });

  document.addEventListener('keydown', onGlobalShortcut);
  window.addEventListener('resize', positionHeroTimer);

  if (els.btnGo && els.urlInput) {
    els.btnGo.addEventListener('click', () => navigateFromBar());
    els.urlInput.addEventListener('input', schedulePopulateUrlDatalist);
    els.urlInput.addEventListener('focus', () => populateUrlDatalist());
    els.urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') navigateFromBar();
    });
  }

  if (els.btnBack) {
    els.btnBack.addEventListener('click', () => {
      if (els.useElectron && els.siteWebview) {
        try {
          if (els.siteWebview.canGoBack()) els.siteWebview.goBack();
        } catch {
          /* ignore */
        }
      } else if (els.siteFrame) {
        try {
          els.siteFrame.contentWindow.history.back();
        } catch {
          /* cross-origin */
        }
      }
    });
  }

  if (els.whitelistMode) {
    els.whitelistMode.addEventListener('change', () => {
      state = persist({ whitelistMode: els.whitelistMode.checked });
      syncNavContextToMain();
    });
  }

  $('#taskForm').addEventListener('submit', onTaskAdd);
  const saveBtn = $('#btnSaveSettings');
  if (saveBtn) saveBtn.addEventListener('click', saveSettingsUi);

  $('#btnPomStart').addEventListener('click', pomStart);
  $('#btnPomPause').addEventListener('click', pomPause);
  $('#btnPomReset').addEventListener('click', pomReset);
  if (els.btnPomSkip) els.btnPomSkip.addEventListener('click', pomSkip);
  ['setWork', 'setShort', 'setLong', 'setLongEvery'].forEach((id) => {
    $(`#${id}`).addEventListener('change', savePomSettings);
  });

  if (els.goalMinutes) {
    els.goalMinutes.addEventListener('change', () => {
      const v = clamp(parseInt(els.goalMinutes.value, 10), 5, 240, 50);
      els.goalMinutes.value = String(v);
      state = persist({ goalMinutes: v });
      updateGoalUi();
    });
  }
  if (els.uiScale) {
    els.uiScale.addEventListener('input', () => {
      if (els.uiScaleValue) els.uiScaleValue.textContent = `${els.uiScale.value}%`;
    });
  }

  if (els.wheelSpin) {
    els.wheelSpin.addEventListener('click', spinWheel);
  }
  if (els.wheelMenuBtn) {
    els.wheelMenuBtn.addEventListener('click', () => {
      els.wheelMenu?.classList.toggle('hidden');
    });
  }
  if (els.wheelTextScale) {
    const st = getState();
    els.wheelTextScale.value = String(st.wheelTextScale || 140);
    if (els.wheelTextScaleValue) els.wheelTextScaleValue.textContent = `${els.wheelTextScale.value}%`;
    els.wheelTextScale.addEventListener('input', () => {
      const v = Number(els.wheelTextScale.value);
      persist({ wheelTextScale: v });
      if (els.wheelTextScaleValue) els.wheelTextScaleValue.textContent = `${v}%`;
      drawWheel();
    });
  }
  if (els.wheelPopupOk) els.wheelPopupOk.addEventListener('click', closeWheelPopup);
  if (els.wheelPopupRemove) els.wheelPopupRemove.addEventListener('click', removePickedFromWheel);

  if (els.ambientToggle) {
    els.ambientToggle.addEventListener('click', toggleAmbient);
  }
  if (els.ambientVolume) {
    els.ambientVolume.addEventListener('input', () => {
      const v = clamp(parseInt(els.ambientVolume.value, 10), 0, 100, 30);
      els.ambientVolume.value = String(v);
      state = persist({ ambientVolume: v });
      updateAmbientVolume();
    });
  }
  if (els.ambientType) {
    els.ambientType.addEventListener('change', () => {
      state = persist({ ambientType: els.ambientType.value });
      if (state.ambientEnabled) {
        stopAmbient();
        startAmbient();
      }
    });
  }

  window.addEventListener('beforeunload', onBeforeUnload);

  // In Electron, suppress popups from within the webview via webpreferences.
  // In web mode, window.open is intentionally used by navigateFromBar(), so we do NOT override it.

  hydrateUi();
  syncNavContextToMain();
  populateUrlDatalist();
  updatePomDisplay();
  setPomControls();
  updateGoalUi();
  renderHistory();
  syncAmbientUi();
  applyUiSettings();
  updateSessionClock();
  updateWheelItems();
  showPanel('home');
}

function hydrateUi() {
  state = getState();
  if (els.whitelistMode) els.whitelistMode.checked = state.whitelistMode;
  const blockedEl = $('#blockedList');
  if (blockedEl) blockedEl.value = state.blocked.join('\n');
  const allowedEl = $('#allowedList');
  if (allowedEl) allowedEl.value = state.allowed.join('\n');
  const strictEl = $('#strictMode');
  if (strictEl) strictEl.checked = state.strictMode;
  if (els.strictDomains) els.strictDomains.value = state.strictDomains.join('\n');
  $('#setWork').value = state.pomodoro.work;
  $('#setShort').value = state.pomodoro.short;
  $('#setLong').value = state.pomodoro.long;
  if (els.setLongEvery) els.setLongEvery.value = state.pomodoro.longEvery || 4;
  pomodoro.remainingSec = state.pomodoro.work * 60;
  updatePomDisplay();
  if (els.goalMinutes) els.goalMinutes.value = String(state.goalMinutes || 50);
  if (els.ambientVolume) els.ambientVolume.value = String(state.ambientVolume ?? 30);

  const exitModeSwitch = $('#exitModeSwitch');
  if (exitModeSwitch) {
    exitModeSwitch.checked = state.exitMode === 'password';
    exitModeSwitch.addEventListener('change', () => {
      const mode = exitModeSwitch.checked ? 'password' : 'delay';
      state = persist({ exitMode: mode });
      updateExitSettingsUi(mode);
    });
  }
  $('#exitDelay').value = state.exitDelaySec;
  const stEl = $('#searchUrlTemplate');
  if (els.accentColor) els.accentColor.value = state.accentColor || '#e2b714';
  if (els.uiScale) els.uiScale.value = String(state.uiScale || 100);
  if (els.uiScaleValue) els.uiScaleValue.textContent = `${state.uiScale || 100}%`;
  if (els.themeMode) els.themeMode.value = state.themeMode || 'dark';
  if (els.reduceMotion) els.reduceMotion.checked = !!state.reduceMotion;
  if (els.compactMode) els.compactMode.checked = !!state.compactMode;
  if (stEl) stEl.value = state.searchUrlTemplate || 'https://duckduckgo.com/?q=%s';
  updateExitSettingsUi(state.exitMode);

  renderTasks();
  schedulePopulateUrlDatalist();
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
  updateGoalUi();
  updateSessionClock();

  if (focusTick) clearInterval(focusTick);
  focusTick = setInterval(() => {
    sessionFocusMs += 1000;
    updateSessionClock();
  }, 1000);

  document.documentElement.requestFullscreen?.().catch(() => {});

  if (els.urlInput) els.urlInput.focus();
  showPanel('home');
}

function updateSessionClock() {
  const totalSec = Math.floor(sessionFocusMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const label = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (els.heroTime) els.heroTime.textContent = label;
  updateGoalUi();
  updateStatsSummary();
}

function showPanel(name) {
  if (els.app) els.app.dataset.panel = name;
  document.querySelectorAll('.panel').forEach((p) => {
    p.hidden = p.id !== `panel-${name}`;
    p.classList.toggle('active', p.id === `panel-${name}`);
  });
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.panel === name);
  });
  if (name === 'settings') {
    updateExitSettingsUi();
  }
  if (name === 'stats') {
    updateStatsSummary();
    renderHistory();
  }
  if (name === 'home') {
    heroDocked = false;
    if (els.heroTimer) els.heroTimer.classList.remove('docked');
  } else if (els.heroTimer) {
    heroDocked = true;
    els.heroTimer.classList.add('docked');
    positionHeroTimer();
  }
  updateSessionClock();
}

function onGlobalShortcut(e) {
  if (els.gate && !els.gate.classList.contains('hidden')) return;
  if (e.target.matches('input, textarea')) {
    if (e.altKey && e.key === 'Escape') e.target.blur();
    return;
  }
  if (!e.altKey) return;
  const map = { h: 'home', t: 'tasks', p: 'timer', g: 'stats', s: 'settings' };
  const k = e.key.toLowerCase();
  if (map[k]) {
    e.preventDefault();
    showPanel(map[k]);
  }
}

function navContext() {
  state = getState();
  const tpl = state.searchUrlTemplate || 'https://duckduckgo.com/?q=%s';
  return {
    blocked: state.blocked,
    allowed: state.allowed,
    whitelistMode: state.whitelistMode,
    strictMode: state.strictMode,
    strictDomains: state.strictDomains,
    searchProvider: searchProviderHostFromTemplate(tpl)
  };
}

function navigateFromBar() {
  const raw = els.urlInput.value;
  state = getState();
  const parsed = resolveOmniboxInput(raw, {
    searchUrlTemplate: state.searchUrlTemplate
  });
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
  if (!els.iframeBlock || !els.blockReason) return;
  els.iframeBlock.classList.remove('hidden');
  els.blockReason.textContent = msg;
  sessionBlocked += 1;
}

function hideBlock() {
  if (els.iframeBlock) els.iframeBlock.classList.add('hidden');
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
    return; // cross-origin, can't read location
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
    addUrlToHistory(href);
    schedulePopulateUrlDatalist();
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
    addUrlToHistory(e.url);
    schedulePopulateUrlDatalist();
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
  renderHistory();
  updateStatsSummary();

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
  const existingIds = new Set((state.tasks || []).map((t) => t.id));
  let id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  while (existingIds.has(id)) {
    id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  const tasks = [
    ...state.tasks,
    { id, text, done: false }
  ];
  state = persist({ tasks });
  input.value = '';
  renderTasks();
}

function setWheelButtonState(btn, removedSet, taskId) {
  btn.textContent = removedSet.has(taskId) ? 'Add to wheel' : 'Remove from wheel';
}

function updateTaskWheelButton(taskId) {
  const btn = document.querySelector(`button[data-task-id="${taskId}"]`);
  if (!btn) return;
  const st = getState();
  const removed = new Set(st.wheelRemovedIds || []);
  setWheelButtonState(btn, removed, taskId);
}

function renderTasks() {
  state = getState();
  const activeUl = $('#taskList');
  const compUl = $('#completedTaskList');
  if (!activeUl || !compUl) return;

  activeUl.innerHTML = '';
  compUl.innerHTML = '';

  const activeTasks = state.tasks.filter((t) => !t.done);
  const doneTasks = state.tasks.filter((t) => t.done);

  if (els.completedTasksSection) {
    els.completedTasksSection.classList.toggle('hidden', doneTasks.length === 0);
  }

  [...activeTasks].reverse().forEach((task) => {
    const li = createTaskLi(task);
    activeUl.appendChild(li);
  });

  [...doneTasks].reverse().forEach((task) => {
    const li = createTaskLi(task);
    compUl.appendChild(li);
  });

  updateWheelItems();
}

function createTaskLi(task) {
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
    if (cb.checked) {
      launchConfetti(true);
    }
    renderTasks();
  });
  const span = document.createElement('span');
  span.textContent = task.text;
  if (task.done) span.style.textDecoration = 'line-through';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.dataset.taskId = task.id;
  addBtn.addEventListener('click', () => {
    const st = getState();
    const removed = new Set(st.wheelRemovedIds || []);
    if (removed.has(task.id)) {
      removed.delete(task.id);
    } else {
      removed.add(task.id);
    }
    persist({ wheelRemovedIds: Array.from(removed) });
    setWheelButtonState(addBtn, removed, task.id);
    updateWheelItems();
  });
  const del = document.createElement('button');
  del.type = 'button';
  del.textContent = 'Remove task';
  del.addEventListener('click', () => {
    state = getState();
    persist({ tasks: state.tasks.filter((t) => t.id !== task.id) });
    renderTasks();
  });
  const st = getState();
  const removed = new Set(st.wheelRemovedIds || []);
  setWheelButtonState(addBtn, removed, task.id);
  const actions = document.createElement('div');
  actions.className = 'task-actions';
  actions.append(addBtn, del);
  li.append(cb, span, actions);
  return li;
}

function updateExitSettingsUi(mode) {
  const m = mode || getState().exitMode;
  if (els.exitDelayRow) {
    els.exitDelayRow.hidden = m !== 'delay';
    els.exitDelayRow.style.display = m === 'delay' ? '' : 'none';
  }
  if (els.exitPasswordRow) {
    els.exitPasswordRow.hidden = m !== 'password';
    els.exitPasswordRow.style.display = m === 'password' ? '' : 'none';
  }
}

function saveSettingsUi() {
  const blockedEl = $('#blockedList');
  const allowedEl = $('#allowedList');
  const strictDomEl = $('#strictDomains');
  const strictModeEl = $('#strictMode');
  const blocked = blockedEl ? parseHostList(blockedEl.value) : getState().blocked;
  const allowed = allowedEl ? parseHostList(allowedEl.value) : getState().allowed;
  const strictDomains = strictDomEl ? parseStrictDomains(strictDomEl.value) : getState().strictDomains;
  const strictMode = strictModeEl ? strictModeEl.checked : getState().strictMode;
  const accentColor = (els.accentColor?.value || '#e2b714').trim().slice(0, 9);
  const uiScale = clamp(parseInt(els.uiScale?.value, 10), 85, 140, 100);
  const themeMode = els.themeMode?.value === 'light' ? 'light' : 'dark';
  const reduceMotion = !!els.reduceMotion?.checked;
  const compactMode = !!els.compactMode?.checked;
  const exitDelaySec = clamp(
    parseInt($('#exitDelay').value, 10),
    5,
    600,
    30
  );
  const exitModeSwitch = $('#exitModeSwitch');
  const exitMode = (exitModeSwitch && exitModeSwitch.checked) ? 'password' : 'delay';


  const cur = getState();
  const searchTplEl = $('#searchUrlTemplate');
  const searchUrlTemplate = searchTplEl
    ? (searchTplEl.value || '').trim().slice(0, 500)
    : cur.searchUrlTemplate;

  state = persist({
    blocked,
    allowed,
    strictMode,
    strictDomains,
    exitDelaySec,
    exitMode,
    searchUrlTemplate,
    accentColor,
    uiScale,
    themeMode,
    reduceMotion,
    compactMode
  });
  updateExitSettingsUi(exitMode);

  const pw = $('#exitPassword').value;
  if (pw) {
    setPassword(pw).then(() => {
      $('#exitPassword').value = '';
    });
  }

  updateStatsSummary();
  syncNavContextToMain();
  populateUrlDatalist();
  applyUiSettings();
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
      long: clamp(parseInt($('#setLong').value, 10), 1, 60, 15),
      longEvery: clamp(parseInt($('#setLongEvery').value, 10), 2, 8, 4)
    }
  });
  if (!pomodoro.timerId) {
    pomodoro.remainingSec = state.pomodoro.work * 60;
    pomodoro.mode = 'work';
    pomodoro.workCount = 0;
    updatePomDisplay();
  }
}

function updatePomDisplay() {
  if (!els.pomodoroDisplay) return;
  const m = Math.floor(pomodoro.remainingSec / 60);
  const s = pomodoro.remainingSec % 60;
  els.pomodoroDisplay.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const total =
    pomodoro.mode === 'work'
      ? (getState().pomodoro.work * 60)
      : (pomodoro.mode === 'long' ? getState().pomodoro.long * 60 : getState().pomodoro.short * 60);
  const pct = total > 0 ? Math.min(1, 1 - pomodoro.remainingSec / total) : 0;
  if (els.pomodoroProgress) {
    els.pomodoroProgress.style.width = `${Math.round(pct * 100)}%`;
  }
  const next = (() => {
    const st = getState();
    if (pomodoro.mode === 'work') {
      const longEvery = st.pomodoro.longEvery || 4;
      const isLong = (pomodoro.workCount + 1) % longEvery === 0;
      return { sec: (isLong ? st.pomodoro.long : st.pomodoro.short) * 60, label: isLong ? 'long break' : 'short break' };
    }
    return { sec: st.pomodoro.work * 60, label: 'focus' };
  })();
  if (els.pomodoroNextTime) {
    const nm = Math.floor(next.sec / 60);
    const ns = next.sec % 60;
    els.pomodoroNextTime.textContent = `${String(nm).padStart(2, '0')}:${String(ns).padStart(2, '0')}`;
  }
  if (els.pomodoroNextLabel) {
    els.pomodoroNextLabel.textContent = `(${next.label})`;
  }
}

function positionHeroTimer() {
  if (!els.heroTimer || !els.topbarLeft) return;
  const r = els.topbarLeft.getBoundingClientRect();
  els.heroTimer.style.setProperty('--hero-left', `${Math.round(r.left)}px`);
  els.heroTimer.style.setProperty('--hero-top', `${Math.round(r.top)}px`);
}

function updateGoalUi() {
  state = getState();
  const goalMin = state.goalMinutes || 50;
  const doneMin = Math.floor(sessionFocusMs / 60000);
  const pct = goalMin > 0 ? Math.min(1, sessionFocusMs / (goalMin * 60000)) : 0;
  if (els.goalFill) els.goalFill.style.width = `${Math.round(pct * 100)}%`;
  if (els.goalMeta) els.goalMeta.textContent = `${doneMin} / ${goalMin} min`;
}

function renderHistory() {
  if (!els.historyList) return;
  state = getState();
  const sessions = [...(state.stats.sessions || [])].slice(-10).reverse();
  if (!sessions.length) {
    els.historyList.innerHTML = '<li class="muted">No sessions yet.</li>';
    return;
  }
  els.historyList.innerHTML = sessions
    .map((s) => {
      const mins = Math.max(1, Math.round((s.focusMs || 0) / 60000));
      const when = new Date(s.end || Date.now());
      const label = when.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `<li><span>${label}</span><span class="mono">${mins} min</span></li>`;
    })
    .join('');
  updateStatsSummary();
}

let ambientCtx = null;
let ambientSource = null;
let ambientGain = null;

function startAmbient() {
  if (ambientCtx) return;
  let ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return;
  }
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const type = (getState().ambientType || 'white').toLowerCase();
  if (type === 'pink') {
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      data[i] = pink * 0.11;
    }
  } else if (type === 'brown') {
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  } else {
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = ((state.ambientVolume ?? 30) / 100);
  source.connect(gain).connect(ctx.destination);
  source.start(0);
  ambientCtx = ctx;
  ambientSource = source;
  ambientGain = gain;
}

function stopAmbient() {
  try {
    ambientSource?.stop();
  } catch {
    /* ignore */
  }
  ambientSource = null;
  ambientGain = null;
  if (ambientCtx) {
    ambientCtx.close().catch(() => {});
    ambientCtx = null;
  }
}

function updateAmbientVolume() {
  if (ambientGain) {
    ambientGain.gain.value = ((state.ambientVolume ?? 30) / 100);
  }
}

function syncAmbientUi() {
  state = getState();
  if (els.ambientToggle) {
    els.ambientToggle.textContent = state.ambientEnabled ? 'Ambient: On' : 'Ambient: Off';
  }
  if (state.ambientEnabled) {
    startAmbient();
  } else {
    stopAmbient();
  }
}

function applyUiSettings() {
  state = getState();
  const root = document.documentElement;
  const accent = state.accentColor || '#e2b714';
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-muted', accent);
  root.classList.toggle('theme-light', state.themeMode === 'light');
  const base = 15;
  const scale = state.uiScale || 100;
  root.style.fontSize = `${Math.round(base * scale / 100)}px`;
  if (els.uiScaleValue) els.uiScaleValue.textContent = `${scale}%`;
  root.classList.toggle('reduce-motion', !!state.reduceMotion);
  document.body.classList.toggle('compact', !!state.compactMode);
}

function toggleAmbient() {
  state = getState();
  const next = !state.ambientEnabled;
  state = persist({ ambientEnabled: next });
  syncAmbientUi();
}

function pomStart() {
  state = getState();
  if (pomodoro.timerId) return;
  pomodoro.started = true;
  setPomControls();
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
      pomodoro.workCount += 1;
      const longEvery = state.pomodoro.longEvery || 4;
      const isLong = pomodoro.workCount % longEvery === 0;
      pomodoro.mode = isLong ? 'long' : 'short';
      pomodoro.remainingSec = (isLong ? state.pomodoro.long : state.pomodoro.short) * 60;
    } else {
      pomodoro.mode = 'work';
      pomodoro.remainingSec = state.pomodoro.work * 60;
    }
    updatePomDisplay();
  }, 1000);
  setPomControls();
  if (els.btnPomStart) els.btnPomStart.classList.add('hidden');
  if (els.btnPomPause) els.btnPomPause.classList.remove('hidden');
  if (els.btnPomReset) els.btnPomReset.classList.remove('hidden');
  if (els.btnPomSkip) els.btnPomSkip.classList.remove('hidden');
  if (els.btnPomStart) els.btnPomStart.style.display = 'none';
  if (els.btnPomPause) els.btnPomPause.style.display = 'inline-flex';
  if (els.btnPomReset) els.btnPomReset.style.display = 'inline-flex';
  if (els.btnPomSkip) els.btnPomSkip.style.display = 'inline-flex';
}

function pomPause() {
  if (pomodoro.timerId) {
    clearInterval(pomodoro.timerId);
    pomodoro.timerId = null;
  }
  setPomControls();
}

function pomReset() {
  pomPause();
  state = getState();
  pomodoro.remainingSec = state.pomodoro.work * 60;
  pomodoro.mode = 'work';
  pomodoro.workCount = 0;
  pomodoro.started = false;
  updatePomDisplay();
  setPomControls();
}

function setPomControls() {
  if (!els.btnPomStart || !els.btnPomPause || !els.btnPomReset) return;
  if (!pomodoro.started) {
    els.btnPomStart.textContent = 'Start';
    els.btnPomStart.classList.remove('hidden');
    els.btnPomPause.classList.add('hidden');
    els.btnPomReset.classList.add('hidden');
    if (els.btnPomSkip) els.btnPomSkip.classList.add('hidden');
    els.btnPomStart.style.display = 'inline-flex';
    els.btnPomPause.style.display = 'none';
    els.btnPomReset.style.display = 'none';
    if (els.btnPomSkip) els.btnPomSkip.style.display = 'none';
    return;
  }
  if (pomodoro.timerId) {
    els.btnPomStart.classList.add('hidden');
    els.btnPomPause.classList.remove('hidden');
    els.btnPomReset.classList.remove('hidden');
    if (els.btnPomSkip) els.btnPomSkip.classList.remove('hidden');
    els.btnPomStart.style.display = 'none';
    els.btnPomPause.style.display = 'inline-flex';
    els.btnPomReset.style.display = 'inline-flex';
    if (els.btnPomSkip) els.btnPomSkip.style.display = 'inline-flex';
    return;
  }
  els.btnPomStart.textContent = 'Start';
  els.btnPomStart.classList.remove('hidden');
  els.btnPomPause.classList.add('hidden');
  els.btnPomReset.classList.remove('hidden');
  if (els.btnPomSkip) els.btnPomSkip.classList.remove('hidden');
  els.btnPomStart.style.display = 'inline-flex';
  els.btnPomPause.style.display = 'none';
  els.btnPomReset.style.display = 'inline-flex';
  if (els.btnPomSkip) els.btnPomSkip.style.display = 'inline-flex';
}

function pomSkip() {
  state = getState();
  if (pomodoro.mode === 'work') {
    pomodoro.workCount += 1;
    const longEvery = state.pomodoro.longEvery || 4;
    const isLong = pomodoro.workCount % longEvery === 0;
    pomodoro.mode = isLong ? 'long' : 'short';
    pomodoro.remainingSec = (isLong ? state.pomodoro.long : state.pomodoro.short) * 60;
  } else {
    pomodoro.mode = 'work';
    pomodoro.remainingSec = state.pomodoro.work * 60;
  }
  updatePomDisplay();
}

function updateStatsSummary() {
  state = getState();
  const m = Math.floor((state.stats.totalFocusMs || 0) / 60000);
  if (els.statsSummaryLarge) {
    const sessions = state.stats.sessions || [];
    const last = sessions[sessions.length - 1];
    const lastMin = last ? Math.max(1, Math.round((last.focusMs || 0) / 60000)) : 0;
    els.statsSummaryLarge.textContent = `TOTAL ${m} MIN · LAST ${lastMin} MIN`;
  }
  renderStats();
}

const wheelState = {
  items: [],
  angle: 0,
  spinning: false,
  velocity: 0,
  target: 0,
  idleSpin: null,
  removed: new Set(),
  manual: new Set(),
  pickedId: null,
  spinRaf: null,
  colors: ['#e2b714', '#6c8cff', '#46c37b', '#f58c7b', '#b16cff', '#f1c75b'],
  colorById: new Map()
};

function updateWheelItems() {
  if (!els.taskWheel) return;
  state = getState();
  wheelState.removed = new Set(state.wheelRemovedIds || []);
  let items = [...(state.tasks || [])].reverse();
  items = items.filter((t) => !t.done && !wheelState.removed.has(t.id));
  wheelState.items = items.map((t) => ({ id: t.id, text: t.text }));
  wheelState.colors = buildWheelColors(wheelState.items);
  drawWheel();
  renderWheelColorMenu();
  if (!wheelState.spinning && !els.wheelPopup?.classList.contains('hidden')) {
    return;
  }
  startIdleSpin();
}

function getFontSizeToFit(ctx, text, maxWidth, maxSize, minSize) {
  const fontFam = getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace';
  let size = maxSize;
  while (size > minSize) {
    ctx.font = `700 ${size}px ${fontFam}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return Math.max(size, minSize);
}

function drawWheel() {
  if (!els.taskWheel) return;
  const canvas = els.taskWheel;
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  const items = wheelState.items;
  if (!items.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 8, 0, Math.PI * 2);
    ctx.fill();
    if (els.wheelResult) els.wheelResult.textContent = 'Add tasks to spin.';
    return;
  }
  const angleStep = (Math.PI * 2) / items.length;
  const radius = Math.min(w, h) / 2 - 8;
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  const colors = wheelState.colors.length ? wheelState.colors : ['#e2b714', '#6c8cff', '#46c37b', '#f58c7b', '#b16cff', '#f1c75b'];
  
  const textRadius = radius * 0.94;
  const maxWidth = radius * 0.82;
  const scale = Math.max(0.6, Math.min(2.2, (getState().wheelTextScale || 140) / 100));
  const baseMax = Math.max(60, radius * 0.28) * scale;
  const baseMin = 12 * scale;
  
  let globalFontSize = baseMax;
  for (let i = 0; i < items.length; i += 1) {
    const text = items[i].text.slice(0, 48);
    if (!text) continue;
    const size = getFontSizeToFit(ctx, text, maxWidth, baseMax, baseMin);
    if (size < globalFontSize) globalFontSize = size;
  }
  const fontFam = getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace';

  for (let i = 0; i < items.length; i += 1) {
    const start = wheelState.angle + i * angleStep;
    const end = start + angleStep;
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2);
    ctx.arc(w / 2, h / 2, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    ctx.stroke();
    const text = items[i].text.slice(0, 48);
    if (!text) continue;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(start);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, 0, angleStep);
    ctx.closePath();
    ctx.clip();
    ctx.rotate(angleStep / 2);
    ctx.font = `700 ${globalFontSize}px ${fontFam}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#3b3b3b';
    ctx.fillText(text, textRadius, 0);
    ctx.restore();
  }
}

function startIdleSpin() {
  if (wheelState.idleSpin) return;
  const tick = () => {
    if (wheelState.spinning || !wheelState.items.length) {
      wheelState.idleSpin = null;
      return;
    }
    wheelState.angle += 0.0022;
    drawWheel();
    wheelState.idleSpin = requestAnimationFrame(tick);
  };
  wheelState.idleSpin = requestAnimationFrame(tick);
}

function spinWheel() {
  if (wheelState.spinning) return;
  if (!wheelState.items.length) return;
  if (wheelState.idleSpin) {
    cancelAnimationFrame(wheelState.idleSpin);
    wheelState.idleSpin = null;
  }
  wheelState.angle = ((wheelState.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const spinTurns = 7;
  const angleStep = (Math.PI * 2) / wheelState.items.length;
  const targetIndex = cryptoPick(wheelState.items.length);
  const targetAngle = (Math.PI * 2) - (targetIndex * angleStep + angleStep / 2);
  const finalAngle = spinTurns * Math.PI * 2 + targetAngle;
  const start = wheelState.angle;
  const duration = 3800;
  const startTime = performance.now();
  wheelState.spinning = true;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const tick = (now) => {
    const t = Math.min(1, (now - startTime) / duration);
    wheelState.angle = start + (finalAngle - start) * easeOut(t);
    drawWheel();
    if (t < 1) {
      wheelState.spinRaf = requestAnimationFrame(tick);
    } else {
      wheelState.spinning = false;
      const pickedIndex = getIndexFromAngle(wheelState.angle);
      const picked = wheelState.items[pickedIndex];
      wheelState.pickedId = picked?.id || null;
      if (els.wheelResult) els.wheelResult.textContent = picked ? `Next: ${picked.text}` : 'Spin again.';
      if (picked) showWheelPopup(picked.text);
    }
  };
  wheelState.spinRaf = requestAnimationFrame(tick);
}

function getIndexFromAngle(angle) {
  const n = wheelState.items.length;
  if (!n) return 0;
  const angleStep = (Math.PI * 2) / n;
  const pointer = -Math.PI / 2;
  const normalized = ((pointer - angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  return Math.floor(normalized / angleStep) % n;
}

function cryptoPick(max) {
  if (max <= 1) return 0;
  const buf = new Uint32Array(1);
  window.crypto.getRandomValues(buf);
  return buf[0] % max;
}

function showWheelPopup(text) {
  if (els.wheelPopupText) els.wheelPopupText.textContent = text;
  if (els.wheelPopup) els.wheelPopup.classList.remove('hidden');
  launchConfetti();
}

function closeWheelPopup() {
  if (els.wheelPopup) els.wheelPopup.classList.add('hidden');
  startIdleSpin();
}

function removePickedFromWheel() {
  if (!wheelState.pickedId) {
    closeWheelPopup();
    return;
  }
  const id = wheelState.pickedId;
  wheelState.removed.add(id);
  wheelState.pickedId = null;
  state = persist({
    wheelRemovedIds: Array.from(wheelState.removed)
  });
  closeWheelPopup();
  updateTaskWheelButton(id);
  updateWheelItems();
}

function renderWheelColorMenu() {
  if (!els.wheelColorList) return;
  els.wheelColorList.innerHTML = '';
  wheelState.items.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'wheel-color-row';
    const label = document.createElement('span');
    label.textContent = item.text;
    const input = document.createElement('input');
    input.type = 'color';
    input.value = wheelState.colors[idx % wheelState.colors.length] || '#e2b714';
    input.addEventListener('input', () => {
      wheelState.colorById.set(item.id, input.value);
      wheelState.colors[idx] = input.value;
      drawWheel();
    });
    row.append(label, input);
    els.wheelColorList.appendChild(row);
  });
}

function buildWheelColors(items) {
  const palette = ['#e2b714', '#6c8cff', '#46c37b', '#f58c7b', '#b16cff', '#f1c75b'];
  const out = [];
  for (let i = 0; i < items.length; i += 1) {
    const id = items[i].id;
    const saved = wheelState.colorById.get(id);
    let color = saved || palette[i % palette.length];
    if (i > 0 && color === out[i - 1]) {
      color = palette[(i + 1) % palette.length];
    }
    out.push(color);
    if (saved) wheelState.colorById.set(id, color);
  }
  if (out.length > 1 && out[0] === out[out.length - 1]) {
    out[out.length - 1] = palette[(palette.indexOf(out[out.length - 1]) + 1) % palette.length];
  }
  return out;
}

function launchConfetti(isBurst = false) {
  const canvas = els.confettiCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = (canvas.width = window.innerWidth);
  const h = (canvas.height = window.innerHeight);
  
  let pieces = [];
  if (isBurst) {
    // Burst from sides
    const colors = ['#e2b714', '#6c8cff', '#46c37b', '#f58c7b', '#b16cff'];
    for (let i = 0; i < 60; i++) {
       // Left side
       pieces.push({
         x: 0,
         y: h * 0.8,
         r: 4 + Math.random() * 4,
         vy: -5 - Math.random() * 10,
         vx: 5 + Math.random() * 10,
         color: colors[Math.floor(Math.random() * colors.length)]
       });
       // Right side
       pieces.push({
         x: w,
         y: h * 0.8,
         r: 4 + Math.random() * 4,
         vy: -5 - Math.random() * 10,
         vx: -5 - Math.random() * 10,
         color: colors[Math.floor(Math.random() * colors.length)]
       });
    }
  } else {
    pieces = Array.from({ length: 120 }).map(() => ({
      x: Math.random() * w,
      y: -20 - Math.random() * h,
      r: 3 + Math.random() * 4,
      vy: 2 + Math.random() * 3,
      vx: -1 + Math.random() * 2,
      color: ['#e2b714', '#6c8cff', '#46c37b', '#f58c7b', '#b16cff'][Math.floor(Math.random() * 5)]
    }));
  }

  const start = performance.now();
  const dur = isBurst ? 2500 : 1600;
  const gravity = 0.35;

  const frame = (now) => {
    const elapsed = now - start;
    ctx.clearRect(0, 0, w, h);
    pieces.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      if (isBurst) {
        p.vy += gravity;
        p.vx *= 0.99;
      }
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
    if (elapsed < dur || pieces.some((p) => p.y < h + 20)) {
      requestAnimationFrame(frame);
    } else {
      ctx.clearRect(0, 0, w, h);
    }
  };
  requestAnimationFrame(frame);
}

function renderStats() {
  if (!els.focusChart || !els.sessionChart) return;
  state = getState();
  const sessions = [...(state.stats.sessions || [])];
  const totalSessions = sessions.length;
  const focusMins = sessions.map((s) => Math.max(0, Math.round((s.focusMs || 0) / 60000)));
  let totalFocus = focusMins.reduce((a, b) => a + b, 0);
  const currentMin = Math.floor((sessionFocusMs || 0) / 60000);
  if (sessionStart) {
    totalFocus += currentMin;
  }
  const avg = totalSessions ? Math.round(totalFocus / totalSessions) : 0;
  const best = focusMins.length ? Math.max(...focusMins) : 0;
  if (els.statTotal) els.statTotal.textContent = `${totalFocus} min`;
  if (els.statSessions) els.statSessions.textContent = `${totalSessions}`;
  if (els.statAvg) els.statAvg.textContent = `${avg} min`;
  if (els.statBest) els.statBest.textContent = `${best} min`;
  if (els.statStreak) els.statStreak.textContent = `${calcStreakDays(sessions)} days`;

  const daily = lastNDays(sessions, 7);
  if (sessionStart) {
    const today = new Date().toISOString().slice(0, 10);
    const row = daily.find((d) => d.key === today);
    if (row) {
      row.minutes += currentMin;
    }
  }
  drawBars(els.focusChart, daily.map((d) => d.minutes), daily.map((d) => d.key));
  drawBars(els.sessionChart, daily.map((d) => d.sessions), daily.map((d) => d.key));
  bindChartTooltip(els.focusChart, daily.map((d) => d.minutes), daily.map((d) => d.key), 'min');
  bindChartTooltip(els.sessionChart, daily.map((d) => d.sessions), daily.map((d) => d.key), 'sessions');
}

function lastNDays(sessions, days) {
  const out = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ key, minutes: 0, sessions: 0 });
  }
  const map = new Map(out.map((d) => [d.key, d]));
  sessions.forEach((s) => {
    const day = new Date(s.end || Date.now()).toISOString().slice(0, 10);
    const row = map.get(day);
    if (row) {
      row.minutes += Math.max(0, Math.round((s.focusMs || 0) / 60000));
      row.sessions += 1;
    }
  });
  return out;
}

function calcStreakDays(sessions) {
  if (!sessions.length) return 0;
  const days = new Set(
    sessions.map((s) => new Date(s.end || Date.now()).toISOString().slice(0, 10))
  );
  let streak = 0;
  const d = new Date();
  const today = d.toISOString().slice(0, 10);
  d.setDate(d.getDate() - 1);
  const yesterday = d.toISOString().slice(0, 10);
  
  if (days.has(today)) {
    d.setDate(d.getDate() + 1);
  } else if (!days.has(yesterday)) {
    return 0;
  }

  while (true) {
    const key = d.toISOString().slice(0, 10);
    if (!days.has(key)) break;
    streak += 1;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function drawBars(svg, values, labels = []) {
  const w = 200;
  const h = 60;
  const max = Math.max(1, ...values);
  const n = Math.max(1, values.length);
  const gap = 4;
  const barW = Math.max(6, Math.floor((w - gap * (n - 1)) / n));
  let x = 0;
  const bars = values.map((v, i) => {
    const barH = Math.max(2, Math.round((v / max) * (h - 10)));
    const y = h - barH;
    const label = labels[i] || '';
    const rect = `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3" ry="3" fill="var(--accent)" data-value="${v}" data-label="${label}"/>`;
    x += barW + gap;
    return rect;
  });
  if (!bars.length) {
    svg.innerHTML = `<rect x="0" y="${h - 2}" width="${w}" height="2" fill="rgba(255,255,255,0.08)"/>`;
    return;
  }
  svg.innerHTML = bars.join('');
}

function bindChartTooltip(svg, values, labels, unit) {
  if (!els.chartTooltip) return;
  svg.onmousemove = (e) => {
    const t = e.target;
    if (!t || t.tagName !== 'rect') return;
    const v = t.getAttribute('data-value');
    const l = t.getAttribute('data-label');
    els.chartTooltip.textContent = `${l}: ${v} ${unit}`;
    els.chartTooltip.style.left = `${e.clientX + 12}px`;
    els.chartTooltip.style.top = `${e.clientY + 12}px`;
    els.chartTooltip.classList.remove('hidden');
  };
  svg.onmouseleave = () => {
    els.chartTooltip.classList.add('hidden');
  };
}

init();
