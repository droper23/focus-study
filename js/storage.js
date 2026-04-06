import { getDefaultBlocked, parseHostList, normalizeHostLine } from './security.js';

const KEY = 'focus-study-v1';

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
    }
  };
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
    pomodoro: {
      work: clampNum(d.pomodoro?.work, 1, 120, 25),
      short: clampNum(d.pomodoro?.short, 1, 60, 5),
      long: clampNum(d.pomodoro?.long, 1, 60, 15)
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
    }
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
  return next;
}

export function updateStats(fn) {
  const cur = getState();
  const stats = fn(cur.stats);
  persist({ stats });
}

export function hashPassword(plain) {
  const salt = 'focus-study-salt-v1';
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

export { parseHostList, normalizeHostLine };
