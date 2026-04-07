import { getDefaultBlocked, parseHostList, normalizeHostLine } from './security.js';

const KEY = 'deep-focus-v2';

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Storage failed', e);
  }
}

export function getState() {
  const d = load();
  if (!d || typeof d !== 'object') {
    return defaultState();
  }
  return mergeDefaults(d);
}

function defaultState() {
  return {
    blocked: getDefaultBlocked(),
    allowed: [],
    whitelistMode: false,
    strictMode: false,
    strictDomains: [],
    exitMode: 'delay',
    exitDelaySec: 30,
    passwordHash: '',
    goalMinutes: 50,
    ambientEnabled: false,
    ambientVolume: 30,
    ambientType: 'white',
    accentColor: '#e2b714',
    uiScale: 100,
    themeMode: 'dark',
    reduceMotion: false,
    compactMode: false,
    autoStartSession: true,
    pomodoro: { work: 25, short: 5, long: 15 },
    tasks: [],
    stats: {
      totalFocusMs: 0,
      totalBlocked: 0,
      sessions: []
    },
    smart: {
      visits: [],
      switchLog: []
    },
    wheelRemovedIds: [],
    wheelTextScale: 140,
    urlHistory: [],
    searchUrlTemplate: 'https://duckduckgo.com/?q=%s'
  };
}

function sanitizeSearchTemplate(s) {
  const def = 'https://duckduckgo.com/?q=%s';
  if (typeof s !== 'string') return def;
  const t = s.trim().slice(0, 500);
  if (!t.includes('%s') || !/^https:\/\//i.test(t)) return def;
  try {
    const sample = t.replace('%s', 'q');
    const u = new URL(sample);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return def;
    return t;
  } catch {
    return def;
  }
}

function normHosts(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((h) => normalizeHostLine(String(h))).filter(Boolean);
}

function mergeDefaults(d) {
  const def = defaultState();
  const blockedNorm = normHosts(d.blocked);
  return {
    blocked: blockedNorm.length ? blockedNorm : def.blocked,
    allowed: normHosts(d.allowed),
    whitelistMode: !!d.whitelistMode,
    strictMode: !!d.strictMode,
    strictDomains: normHosts(d.strictDomains).slice(0, 3),
    exitMode: d.exitMode === 'password' ? 'password' : 'delay',
    exitDelaySec: clampNum(d.exitDelaySec, 5, 600, 30),
    passwordHash: typeof d.passwordHash === 'string' ? d.passwordHash : '',
    goalMinutes: clampNum(d.goalMinutes, 5, 240, def.goalMinutes),
    ambientEnabled: !!d.ambientEnabled,
    ambientVolume: clampNum(d.ambientVolume, 0, 100, def.ambientVolume),
    ambientType: typeof d.ambientType === 'string' ? d.ambientType : def.ambientType,
    accentColor: typeof d.accentColor === 'string' && d.accentColor.startsWith('#') ? d.accentColor.slice(0, 9) : def.accentColor,
    uiScale: clampNum(d.uiScale, 85, 140, def.uiScale),
    themeMode: d.themeMode === 'light' ? 'light' : 'dark',
    reduceMotion: !!d.reduceMotion,
    compactMode: !!d.compactMode,
    autoStartSession: d.autoStartSession !== false,
    pomodoro: {
      work: clampNum(d.pomodoro?.work, 1, 120, 25),
      short: clampNum(d.pomodoro?.short, 1, 60, 5),
      long: clampNum(d.pomodoro?.long, 1, 60, 15),
      longEvery: clampNum(d.pomodoro?.longEvery, 2, 8, 4)
    },
    tasks: Array.isArray(d.tasks) ? sanitizeTasks(d.tasks) : [],
    stats: {
      totalFocusMs: Math.max(0, Number(d.stats?.totalFocusMs) || 0),
      totalBlocked: Math.max(0, Number(d.stats?.totalBlocked) || 0),
      sessions: Array.isArray(d.stats?.sessions) ? d.stats.sessions.slice(-100) : []
    },
    smart: {
      visits: Array.isArray(d.smart?.visits) ? d.smart.visits.slice(-200) : [],
      switchLog: Array.isArray(d.smart?.switchLog) ? d.smart.switchLog.slice(-500) : []
    },
    wheelRemovedIds: Array.isArray(d.wheelRemovedIds) ? d.wheelRemovedIds.slice(0, 500) : [],
    wheelTextScale: clampNum(d.wheelTextScale, 60, 220, 140),
    urlHistory: Array.isArray(d.urlHistory)
      ? d.urlHistory.filter((x) => typeof x === 'string' && x.startsWith('http')).slice(0, 120)
      : [],
    searchUrlTemplate: sanitizeSearchTemplate(d.searchUrlTemplate)
  };
}

function clampNum(n, min, max, fallback) {
  const x = Number(n);
  if (Number.isNaN(x)) return fallback;
  return Math.min(max, Math.max(min, x));
}

function sanitizeTasks(tasks) {
  return tasks
    .filter((t) => t && typeof t.text === 'string')
    .slice(0, 200)
    .map((t, i) => ({
      id: String(t.id || `t-${i}-${Date.now()}`),
      text: t.text.slice(0, 500),
      done: !!t.done
    }));
}

export function persist(partial) {
  const cur = getState();
  const next = { ...cur, ...partial };
  save(next);
  try {
    if (partial && (
      Object.prototype.hasOwnProperty.call(partial, 'stats') || 
      Object.prototype.hasOwnProperty.call(partial, 'tasks') ||
      Object.prototype.hasOwnProperty.call(partial, 'accentColor')
    )) {
      window.backendSyncState?.({ stats: next.stats, tasks: next.tasks, accentColor: next.accentColor });
    }
  } catch {
    /* ignore */
  }
  try {
    window.onStateChanged?.(next, partial);
  } catch {
    /* ignore */
  }
  return next;
}

export function updateStats(fn) {
  const cur = getState();
  const stats = fn(cur.stats);
  return persist({ stats });
}

export function hashPassword(plain) {
  const salt = 'deep-focus-salt-v1';
  const enc = new TextEncoder();
  return crypto.subtle.digest('SHA-256', enc.encode(plain + salt)).then((buf) =>
    Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  );
}

export async function setPassword(plain) {
  if (!plain || typeof plain !== 'string') {
    return persist({ passwordHash: '' });
  }
  const h = await hashPassword(plain.slice(0, 128));
  return persist({ passwordHash: h });
}

export async function verifyPassword(plain) {
  const st = getState();
  if (!st.passwordHash) return true;
  const h = await hashPassword(String(plain).slice(0, 128));
  return h === st.passwordHash;
}

export function parseStrictDomains(text) {
  const lines = parseHostList(text || '', 10);
  return lines.slice(0, 3);
}

export function addUrlToHistory(url) {
  if (typeof url !== 'string' || !url.startsWith('http')) return;
  const cur = getState();
  const rest = (cur.urlHistory || []).filter((x) => x !== url);
  rest.unshift(url);
  persist({ urlHistory: rest.slice(0, 120) });
}

export { parseHostList, normalizeHostLine };
