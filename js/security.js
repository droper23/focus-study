/**
 * URL and host validation — block bypass via schemes, odd hosts, credentials.
 */

const DISALLOWED_SCHEMES = new Set([
  'javascript:', 'data:', 'blob:', 'file:', 'vbscript:', 'mailto:', 'tel:', 'ftp:'
]);

const DEFAULT_BLOCKED = [
  'youtube.com',
  'youtu.be',
  'twitter.com',
  'x.com',
  't.co',
  'instagram.com',
  'tiktok.com',
  'reddit.com',
  'facebook.com',
  'fb.com',
  'snapchat.com',
  'pinterest.com',
  'twitch.tv',
  'netflix.com',
  'discord.com',
  'discord.gg'
];

export function normalizeHostLine(line) {
  if (typeof line !== 'string') return '';
  let s = line.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '');
  s = s.split('/')[0];
  s = s.split(':')[0];
  s = s.replace(/\.$/, '');
  if (s.startsWith('.')) s = s.slice(1);
  return s;
}

export function parseHostList(text, maxLines = 500) {
  if (typeof text !== 'string') return [];
  const lines = text.split(/[\r\n]+/).slice(0, maxLines);
  const out = [];
  const seen = new Set();
  for (const line of lines) {
    const h = normalizeHostLine(line);
    if (!h || h.length > 253) continue;
    if (!/^[\w.-]+$/.test(h)) continue;
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  return out;
}

/**
 * Host used for policy checks (whitelist / strict) for the configured search engine.
 */
export function searchProviderHostFromTemplate(template) {
  const t = typeof template === 'string' && template.includes('%s') ? template : 'https://duckduckgo.com/?q=%s';
  try {
    const u = new URL(t.replace('%s', 'query'));
    return normalizeHostLine(u.hostname) || 'duckduckgo.com';
  } catch {
    return 'duckduckgo.com';
  }
}

function buildSearchNavigation(raw, searchUrlTemplate) {
  const tpl =
    typeof searchUrlTemplate === 'string' && searchUrlTemplate.includes('%s')
      ? searchUrlTemplate.trim().slice(0, 500)
      : 'https://duckduckgo.com/?q=%s';
  const url = tpl.replace('%s', encodeURIComponent(raw.trim()));
  let hostname = '';
  try {
    hostname = normalizeHostLine(new URL(url).hostname);
  } catch {
    return { ok: false, error: 'Invalid search template' };
  }
  if (!hostname) {
    return { ok: false, error: 'Invalid search template' };
  }
  return { ok: true, url, hostname, isSearch: true };
}

/**
 * Chrome-like omnibox: multi-word or non-URL input → search; bare hostnames need a dot to navigate.
 */
export function resolveOmniboxInput(raw, options = {}) {
  const searchTpl = options.searchUrlTemplate;
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Invalid input' };
  }
  const t = raw.trim().slice(0, 2048);
  if (!t) {
    return { ok: false, error: 'Empty input' };
  }

  if (/\s/.test(t)) {
    return buildSearchNavigation(t, searchTpl);
  }

  const parsed = parseUserUrl(t);
  if (parsed.ok) {
    const h = parsed.hostname;
    if (h.includes('.')) {
      return { ...parsed, isSearch: false };
    }
    return buildSearchNavigation(t, searchTpl);
  }

  if (parsed.error && isSecurityUrlRejection(parsed.error)) {
    return { ok: false, error: parsed.error };
  }

  return buildSearchNavigation(t, searchTpl);
}

function isSecurityUrlRejection(msg) {
  return /scheme|credential|localhost|IP literal|Only http/i.test(String(msg));
}

export function parseUserUrl(raw) {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Invalid input' };
  }
  let s = raw.trim().slice(0, 2048);
  if (!s) {
    return { ok: false, error: 'Empty URL' };
  }

  const lowerStart = s.toLowerCase();
  for (const d of DISALLOWED_SCHEMES) {
    if (lowerStart.startsWith(d)) {
      return { ok: false, error: 'Scheme not allowed' };
    }
  }

  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    s = 'https://' + s;
  }

  let u;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, error: 'Only http(s) allowed' };
  }

  if (u.username || u.password) {
    return { ok: false, error: 'Credentials in URL not allowed' };
  }

  let host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253) {
    return { ok: false, error: 'Invalid host' };
  }

  if (host === 'localhost' || host.endsWith('.localhost')) {
    return { ok: false, error: 'Local hosts blocked in focus mode' };
  }

  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4.test(host) || host.includes(':')) {
    return { ok: false, error: 'IP literals blocked' };
  }

  return {
    ok: true,
    url: u.href,
    hostname: host
  };
}

export function hostMatchesEntry(hostname, entry) {
  const h = hostname.toLowerCase();
  const e = entry.toLowerCase();
  if (h === e) return true;
  if (h.endsWith('.' + e)) return true;
  return false;
}

export function isHostBlocked(hostname, blockedPatterns) {
  for (const p of blockedPatterns) {
    if (hostMatchesEntry(hostname, p)) return true;
  }
  return false;
}

export function isHostAllowed(hostname, allowedPatterns) {
  if (!allowedPatterns.length) return false;
  for (const p of allowedPatterns) {
    if (hostMatchesEntry(hostname, p)) return true;
  }
  return false;
}

export function checkNavigation(hostname, ctx) {
  const {
    blocked,
    allowed,
    whitelistMode,
    strictMode,
    strictDomains,
    searchProvider
  } = ctx;

  const sp =
    typeof searchProvider === 'string' && searchProvider.length > 0
      ? searchProvider.toLowerCase()
      : '';

  if (sp && hostMatchesEntry(hostname, sp)) {
    if (isHostBlocked(hostname, blocked)) {
      return { allowed: false, reason: 'Site is blocked' };
    }
    return { allowed: true, reason: '' };
  }

  if (strictMode && strictDomains.length > 0) {
    let ok = false;
    for (const d of strictDomains) {
      if (hostMatchesEntry(hostname, d)) {
        ok = true;
        break;
      }
    }
    if (!ok) {
      return { allowed: false, reason: 'Not in strict allowlist (max 3 domains)' };
    }
  }

  if (whitelistMode) {
    if (!isHostAllowed(hostname, allowed)) {
      return { allowed: false, reason: 'Not on allowed list' };
    }
  }

  if (isHostBlocked(hostname, blocked)) {
    return { allowed: false, reason: 'Site is blocked' };
  }

  return { allowed: true, reason: '' };
}

export function getDefaultBlocked() {
  return [...DEFAULT_BLOCKED];
}
