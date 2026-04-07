import { getState, persist } from './storage.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  setPersistence,
  inMemoryPersistence,
  sendPasswordResetEmail,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const cfg = window.FIREBASE_CONFIG || null;
let app = null;
let auth = null;
let db = null;
let syncTimer = null;
let lastRemote = null;

function enabled() {
  return !!(cfg && cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId);
}

function init() {
  if (!enabled() || app) return;
  app = initializeApp(cfg);
  auth = getAuth(app);
  db = getFirestore(app);
}

function qs(id) {
  return document.getElementById(id);
}

function setStatus(text) {
  const el = qs('authStatus');
  if (el) el.textContent = text || '';
}

function setAuthed(isAuthed, email) {
  const emailRow = qs('authEmailRow');
  const signBtn = qs('authSignIn');
  const logoutBtn = qs('authLogout');
  const badge = qs('authBadge');
  if (emailRow) emailRow.style.display = isAuthed ? 'none' : 'flex';
  if (signBtn) signBtn.disabled = isAuthed;
  if (logoutBtn) logoutBtn.disabled = !isAuthed;
  const label = isAuthed ? `Logged in: ${email || 'OK'}` : 'Not logged in';
  if (badge) badge.textContent = label;
  setStatus(isAuthed ? `Signed in: ${email || 'OK'}` : 'Signed out');
}

function emptyStats() {
  return { totalFocusMs: 0, totalBlocked: 0, sessions: [] };
}

function hasData(stats, tasks) {
  const s = stats || {};
  const t = Array.isArray(tasks) ? tasks : [];
  return (
    t.length > 0 ||
    (s.totalFocusMs || 0) > 0 ||
    (s.totalBlocked || 0) > 0 ||
    (Array.isArray(s.sessions) && s.sessions.length > 0)
  );
}

function sameData(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function resetLocalState() {
  persist({
    tasks: [],
    stats: emptyStats()
  });
}

function mergeTasks(localTasks, remoteTasks) {
  const out = [];
  const seen = new Set();
  const add = (t) => {
    if (!t || typeof t.text !== 'string') return;
    const key = `${t.id || ''}|${t.text}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  (Array.isArray(localTasks) ? localTasks : []).forEach(add);
  (Array.isArray(remoteTasks) ? remoteTasks : []).forEach(add);
  return out.slice(-200);
}

function mergeStats(localStats, remoteStats) {
  const l = localStats || emptyStats();
  const r = remoteStats || emptyStats();
  const sessions = [...(l.sessions || []), ...(r.sessions || [])].slice(-100);
  return {
    totalFocusMs: (l.totalFocusMs || 0) + (r.totalFocusMs || 0),
    totalBlocked: (l.totalBlocked || 0) + (r.totalBlocked || 0),
    sessions
  };
}

function showSyncModal() {
  const modal = qs('syncModal');
  if (!modal) return Promise.resolve('remote');
  modal.classList.remove('hidden');
  return new Promise((resolve) => {
    const close = (choice) => {
      modal.classList.add('hidden');
      resolve(choice);
    };
    qs('syncUseRemote')?.addEventListener('click', () => close('remote'), { once: true });
    qs('syncKeepLocal')?.addEventListener('click', () => close('local'), { once: true });
    qs('syncMerge')?.addEventListener('click', () => close('merge'), { once: true });
  });
}

async function pullState(uid) {
  if (!db || !uid) return;
  const ref = doc(db, 'user_stats', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    lastRemote = null;
    return;
  }
  const data = snap.data() || {};
  const remote = {
    stats: data.stats || emptyStats(),
    tasks: Array.isArray(data.tasks) ? data.tasks : []
  };
  lastRemote = remote;
  const local = getState();
  const localState = {
    stats: local?.stats || emptyStats(),
    tasks: Array.isArray(local?.tasks) ? local.tasks : []
  };

  const remoteHas = hasData(remote.stats, remote.tasks);
  const localHas = hasData(localState.stats, localState.tasks);
  const differs = !sameData(remote, localState);

  if (remoteHas && localHas && differs) {
    const choice = await showSyncModal();
    if (choice === 'remote') {
      persist(remote);
    } else if (choice === 'local') {
      await pushState(localState);
    } else {
      const merged = {
        stats: mergeStats(localState.stats, remote.stats),
        tasks: mergeTasks(localState.tasks, remote.tasks)
      };
      persist(merged);
      await pushState(merged);
    }
    return;
  }
  if (remoteHas) {
    persist(remote);
    return;
  }
  if (localHas) {
    await pushState(localState);
    return;
  }
  resetLocalState();
}

async function pushState(payload) {
  if (!db || !auth?.currentUser) return;
  const uid = auth.currentUser.uid;
  const email = auth.currentUser.email || '';
  const ref = doc(db, 'user_stats', uid);
  const stats = payload?.stats;
  const tasks = payload?.tasks;
  await setDoc(
    ref,
    { stats, tasks, email, updated_at: new Date().toISOString() },
    { merge: true }
  );
}

function debouncePushState(payload) {
  if (!enabled()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => pushState(payload), 800);
}

async function signInOrUp(email, password) {
  if (!auth) return;
  try {
    await createUserWithEmailAndPassword(auth, email, password);
  } catch (e) {
    const code = e?.code || '';
    if (code === 'auth/email-already-in-use') {
      await signInWithEmailAndPassword(auth, email, password);
      return;
    }
    throw e;
  }
}

function formatAuthError(err) {
  const code = err?.code || '';
  if (code === 'auth/email-already-in-use') return 'Incorrect password.';
  if (code === 'auth/wrong-password') return 'Incorrect password.';
  if (code === 'auth/invalid-credential') return 'Incorrect password.';
  if (code === 'auth/invalid-email') return 'Invalid email.';
  if (code === 'auth/weak-password') return 'Password must be at least 6 characters.';
  return err?.message || 'Sign-in failed.';
}

async function initAuthUi() {
  if (!enabled()) {
    setStatus('Backend disabled (add Firebase config).');
    return;
  }
  init();
  try {
    await setPersistence(auth, inMemoryPersistence);
  } catch {
    /* ignore */
  }

  const emailInput = qs('authEmail');
  const passInput = qs('authPassword');
  const signBtn = qs('authSignIn');
  const resetBtn = qs('authReset');
  const logoutBtn = qs('authLogout');

  if (signBtn && emailInput && passInput) {
    signBtn.addEventListener('click', async () => {
      const email = emailInput.value.trim();
      const password = passInput.value;
      if (!email || !password) {
        setStatus('Enter email and password.');
        return;
      }
      if (password.length < 6) {
        setStatus('Password must be at least 6 characters.');
        return;
      }
      signBtn.disabled = true;
      try {
        setStatus('Signing in...');
        await signInOrUp(email, password);
      } catch (e) {
        setStatus(formatAuthError(e));
      }
      signBtn.disabled = false;
    });
    passInput.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const email = emailInput.value.trim();
      const password = passInput.value;
      if (!email || !password) {
        setStatus('Enter email and password.');
        return;
      }
      if (password.length < 6) {
        setStatus('Password must be at least 6 characters.');
        return;
      }
      signBtn.disabled = true;
      try {
        setStatus('Signing in...');
        await signInOrUp(email, password);
      } catch (err) {
        setStatus(formatAuthError(err));
      }
      signBtn.disabled = false;
    });
  }
  if (resetBtn && emailInput) {
    resetBtn.addEventListener('click', async () => {
      const email = emailInput.value.trim();
      if (!email) {
        setStatus('Enter your email to reset password.');
        return;
      }
      try {
        await sendPasswordResetEmail(auth, email);
        setStatus('Password reset email sent.');
      } catch (e) {
        setStatus(formatAuthError(e));
      }
    });
  }
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await signOut(auth);
        if (emailInput) emailInput.value = '';
        if (passInput) passInput.value = '';
        setAuthed(false);
        setStatus('Signed out.');
      } catch (e) {
        setStatus(formatAuthError(e));
      }
    });
  }

  onAuthStateChanged(auth, async (user) => {
    setAuthed(!!user, user?.email);
    if (user) {
      await pullState(user.uid);
      return;
    }
    lastRemote = null;
  });
}

window.backendSyncState = debouncePushState;
window.backendSyncStats = (stats) => debouncePushState({ stats });

document.addEventListener('DOMContentLoaded', () => {
  initAuthUi();
});
