// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One forge: its address (a self-hosted Forgejo or Gitea, or Codeberg), an
// optional read-only access token, and the repositories to follow.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in minutes.
export const POLL_INTERVALS = ['5', '10', '15', '30', '60'];

// Repositories followed, at most: five requests each per reading.
export const MAX_REPOSITORIES = 20;

export const DEFAULT_CONFIG = {
  url: '',
  token: '',
  repositories: '',
  poll_interval: '10',
  language: 'fr',
};

// Pages of the web interface: a URL copied from the browser may point at one.
const INTERFACE_PATH = /\/(api|explore|user|admin|repo|notifications|-)(\/.*)?$/i;

/**
 * Parse the address typed by the user into a base URL: a host
 * (`codeberg.org`, HTTPS then), `host:port` (HTTP), or a URL copied from the
 * browser. A sub-path (reverse proxy) is kept.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    // A bare name with a port is a local forge (HTTP), without one a public
    // host such as codeberg.org (HTTPS).
    url = new URL(hasScheme ? text : `${/^[^/]+:\d+/.test(text) ? 'http' : 'https'}://${text}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  const path = url.pathname.replace(INTERFACE_PATH, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

// An owner or a repository name, as the forges allow them.
const NAME = /^[\w.-]{1,100}$/;

/**
 * The repositories typed by the user: `owner/name`, or a repository URL
 * copied from the browser, separated by commas, spaces, semicolons or new
 * lines. Anything else is reported, never guessed.
 * @returns {{ names: string[], invalid: string[] }}
 */
export function parseRepositories(raw) {
  const names = [];
  const invalid = [];
  const text = typeof raw === 'string' ? raw : '';
  for (const part of text.split(/[\s,;]+/)) {
    if (!part) {
      continue;
    }
    let path = part;
    if (/^https?:\/\//i.test(part)) {
      try {
        path = new URL(part).pathname;
      } catch {
        path = '';
      }
    }
    const [owner, name] = path
      .replace(/^\/+/, '')
      .replace(/\.git$/i, '')
      .split('/')
      .filter(Boolean);
    if (owner && name && NAME.test(owner) && NAME.test(name) && !/^\.+$/.test(name)) {
      const fullName = `${owner}/${name}`;
      if (!names.some((known) => known.toLowerCase() === fullName.toLowerCase())) {
        names.push(fullName);
      }
    } else {
      invalid.push(part.slice(0, 40));
    }
  }
  return { names: names.slice(0, MAX_REPOSITORIES), invalid, dropped: names.length };
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pollInterval = POLL_INTERVALS.includes(String(source.poll_interval))
    ? String(source.poll_interval)
    : DEFAULT_CONFIG.poll_interval;
  const typed = text('url');
  const repositories = parseRepositories(source.repositories);
  return {
    // null: nothing typed, or not understood (see hub.connectionStatus).
    url: typed ? parseServerUrl(typed) : null,
    urlTyped: Boolean(typed),
    // A pasted token often carries a trailing space or new line.
    token: text('token'),
    repositories: repositories.names,
    invalidRepositories: repositories.invalid,
    tooMany: repositories.dropped > MAX_REPOSITORIES,
    pollIntervalMs: Number(pollInterval) * 60_000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
