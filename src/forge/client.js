// -----------------------------------------------------------------------------
// Forgejo / Gitea client: the REST API v1 both forges share (Codeberg runs
// Forgejo), authenticated by an access token (`Authorization: token …`), or
// anonymous for public repositories.
//
//   GET /api/v1/version                          the forge answers (Forgejo:
//                                                "11.0.6+gitea-1.22.0")
//   GET /api/v1/repos/<o>/<r>                    stars, forks, open issues and
//                                                pull requests, default branch
//   GET /api/v1/repos/<o>/<r>/releases?limit=…   newest first, drafts included
//                                                for a writer: skipped here
//   GET /api/v1/repos/<o>/<r>/issues?type=…      newest first (issues and pull
//                                                requests share the numbers)
//   GET /api/v1/repos/<o>/<r>/commits/<b>/status combined CI state of a branch
//                                                (Forgejo / Gitea Actions post
//                                                their results there too)
//
// Read-only: the integration never writes to the forge. Redirects are not
// followed: the token would go wherever the address points (an http:// address
// redirected to https://, a renamed repository, are reported instead).
// -----------------------------------------------------------------------------

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TIMEOUT: 'timeout', // no answer in time
  TLS: 'tls', // the certificate does not verify
  AUTH: 'auth', // token refused
  NOT_FORGE: 'not_forge', // something answers, not the Forgejo / Gitea API
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  RATE_LIMITED: 'rate_limited', // too many requests (HTTP 429)
  NOT_FOUND: 'not_found', // the repository does not exist, or is not visible
  MOVED: 'moved', // the repository was renamed or transferred
  HTTP: 'http', // any other HTTP error
});

export class ForgeError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'ForgeError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

// A page of five releases or issues stays far below this (the 256 MB of the
// sandbox too): a release body or an issue body can be long, not that long.
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

async function readCapped(response, max) {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > max) {
    await response.body?.cancel();
    throw Object.assign(new Error('Response too large'), { code: 'TOO_LARGE' });
  }
  if (!response.body) {
    return '';
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > max) {
      throw Object.assign(new Error('Response too large'), { code: 'TOO_LARGE' });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The one function that talks to the network (fetch). The client takes it as
 * a parameter: the tests replace it with an in-memory forge
 * (test/helpers/fakeForge.js).
 * @returns {Promise<{ status: number, body: string }>}
 */
export async function httpRequest(
  url,
  { method = 'GET', headers = {}, timeoutMs = 15_000, maxBytes = MAX_BODY_BYTES } = {},
) {
  const response = await fetch(url, {
    method,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, body: await readCapped(response, maxBytes) };
}

// Combined CI states of a commit. "warning" (Gitea 1.18+) counts as passed:
// the forge itself shows it amber, not red.
export const CI_STATES = Object.freeze({
  SUCCESS: 'success',
  FAILURE: 'failure',
  PENDING: 'pending',
  NONE: 'none',
});

const CI_OF = {
  success: CI_STATES.SUCCESS,
  warning: CI_STATES.SUCCESS,
  skipped: CI_STATES.SUCCESS,
  failure: CI_STATES.FAILURE,
  error: CI_STATES.FAILURE,
  pending: CI_STATES.PENDING,
};

const dateOf = (value) => {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time > 0 ? time : null;
};

const positiveId = (value) => (Number.isInteger(value) && value > 0 ? value : null);
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
const textOf = (value, max = 255) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function normalizeRepository(raw) {
  const id = positiveId(raw?.id);
  const fullName = textOf(raw?.full_name);
  if (!id || !fullName) {
    return null;
  }
  return {
    id,
    fullName,
    url: textOf(raw.html_url, 500),
    defaultBranch: textOf(raw.default_branch) || null,
    empty: raw.empty === true,
    archived: raw.archived === true,
    stars: count(raw.stars_count),
    forks: count(raw.forks_count),
    // Gitea counts the pull requests apart: `open_issues_count` is issues only.
    openIssues: count(raw.open_issues_count),
    openPulls: count(raw.open_pr_counter),
  };
}

/** A release, without its body nor its assets. Null for a draft. */
export function normalizeRelease(raw) {
  const id = positiveId(raw?.id);
  const tag = textOf(raw?.tag_name);
  if (!id || !tag || raw.draft === true) {
    return null;
  }
  return {
    id,
    tag,
    name: textOf(raw.name) || tag,
    prerelease: raw.prerelease === true,
    published: dateOf(raw.published_at) ?? dateOf(raw.created_at),
    author: textOf(raw.author?.login),
    url: textOf(raw.html_url, 500),
  };
}

/** An issue or a pull request, without its body. */
export function normalizeIssue(raw) {
  const number = positiveId(raw?.number);
  if (!number) {
    return null;
  }
  return {
    number,
    title: textOf(raw.title),
    author: textOf(raw.user?.login),
    url: textOf(raw.html_url, 500),
    created: dateOf(raw.created_at),
  };
}

/** The combined status of a commit: its CI state, and the commit. */
export function normalizeStatus(raw) {
  const total = count(raw?.total_count);
  const statuses = Array.isArray(raw?.statuses) ? raw.statuses : [];
  const state =
    total === 0 && statuses.length === 0
      ? CI_STATES.NONE
      : (CI_OF[raw?.state] ?? CI_STATES.PENDING);
  return { state, sha: textOf(raw?.sha, 64) };
}

const parse = (body) => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

const segment = encodeURIComponent;

export class ForgeClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host[:port][/path]`
   * @param {string} [options.token] access token; anonymous when empty
   * @param {Function} [options.request] test seam (httpRequest)
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, token = '', request = httpRequest, timeoutMs = 15_000 }) {
    this.url = url;
    this.token = token;
    this.request = request;
    this.timeoutMs = timeoutMs;
  }

  async call(path) {
    const headers = { accept: 'application/json' };
    if (this.token) {
      headers.authorization = `token ${this.token}`;
    }
    try {
      return await this.request(`${this.url}/api/v1${path}`, {
        headers,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      const code = err.cause?.code ?? err.code;
      if (TLS_CODES.has(code)) {
        throw new ForgeError(ERROR_KINDS.TLS, `Certificate refused (${code})`);
      }
      if (err.name === 'TimeoutError' || code === 23) {
        throw new ForgeError(ERROR_KINDS.TIMEOUT, 'No answer in time');
      }
      throw new ForgeError(ERROR_KINDS.UNREACHABLE, String(code ?? err.name ?? err.message));
    }
  }

  /**
   * @param {string} path
   * @param {object} [options]
   * @param {boolean} [options.repository] a repository path: 404 is "not
   *   found", a redirect is "moved" (the forge redirects a renamed one)
   */
  async getJson(path, { repository = false } = {}) {
    const { status, body } = await this.call(path);
    if (status === 401) {
      throw new ForgeError(ERROR_KINDS.AUTH, 'Token refused (HTTP 401)', { status });
    }
    if (status === 429) {
      throw new ForgeError(ERROR_KINDS.RATE_LIMITED, 'Too many requests (HTTP 429)', { status });
    }
    if (status >= 300 && status < 400) {
      const kind = repository ? ERROR_KINDS.MOVED : ERROR_KINDS.REDIRECT;
      throw new ForgeError(kind, `Redirected (HTTP ${status})`, { status });
    }
    // A private repository is a 404 to whom may not read it (403 too, with
    // a token lacking the repository scope).
    if (repository && (status === 404 || status === 403)) {
      throw new ForgeError(ERROR_KINDS.NOT_FOUND, `Not found (HTTP ${status})`, { status });
    }
    if (status === 404) {
      throw new ForgeError(ERROR_KINDS.NOT_FORGE, 'No Forgejo / Gitea API here (HTTP 404)', {
        status,
      });
    }
    if (status < 200 || status >= 300) {
      throw new ForgeError(ERROR_KINDS.HTTP, `Unexpected answer (HTTP ${status})`, { status });
    }
    const data = parse(body);
    if (!data || typeof data !== 'object') {
      throw new ForgeError(ERROR_KINDS.NOT_FORGE, 'The answer is not the Forgejo / Gitea API');
    }
    return data;
  }

  /** The version of the forge: "1.24.6" (Gitea), "11.0.6+gitea-1.22.0" (Forgejo). */
  async version() {
    const data = await this.getJson('/version');
    if (typeof data.version !== 'string') {
      throw new ForgeError(ERROR_KINDS.NOT_FORGE, 'The answer is not the Forgejo / Gitea API');
    }
    return data.version.slice(0, 60);
  }

  repoPath(fullName) {
    const [owner, name] = fullName.split('/');
    return `/repos/${segment(owner)}/${segment(name)}`;
  }

  async repository(fullName) {
    const repo = normalizeRepository(
      await this.getJson(this.repoPath(fullName), { repository: true }),
    );
    if (!repo) {
      throw new ForgeError(ERROR_KINDS.NOT_FORGE, 'The answer is not a repository');
    }
    return repo;
  }

  async list(path, normalize) {
    const data = await this.getJson(path, { repository: true });
    if (!Array.isArray(data)) {
      throw new ForgeError(ERROR_KINDS.NOT_FORGE, 'The answer is not a list');
    }
    return data.map(normalize).filter(Boolean);
  }

  /** The newest releases, drafts left out. */
  releases(fullName, limit = 5) {
    return this.list(`${this.repoPath(fullName)}/releases?limit=${limit}`, normalizeRelease);
  }

  /**
   * The newest issues (`type: issues`) or pull requests (`type: pulls`),
   * open or closed: one opened and closed between two reads still counts.
   */
  issues(fullName, type, limit = 5) {
    return this.list(
      `${this.repoPath(fullName)}/issues?state=all&type=${type}&limit=${limit}`,
      normalizeIssue,
    );
  }

  /** The combined CI state of a branch. */
  async status(fullName, branch) {
    return normalizeStatus(
      await this.getJson(`${this.repoPath(fullName)}/commits/${segment(branch)}/status`, {
        repository: true,
      }),
    );
  }
}
