// -----------------------------------------------------------------------------
// An in-memory Forgejo / Gitea, behind the `request` seam of
// src/forge/client.js: the API v1 as Forgejo 11.0.16 answers it. Its bodies
// start from the real answers in test/fixtures/forgejo (repository, release,
// issue, combined status), with the fields the scenario changes; drafts are
// listed (to a writer), a renamed repository answers 307, an unknown one 404,
// a branch without status `{"state": "", "total_count": 0}`.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const BASE = 'http://192.0.2.10:3000';
export const TOKEN = 'f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/forgejo/${name}.json`, import.meta.url), 'utf8'));
const REPO = fixture('repo');
const [, , RELEASE] = fixture('releases');
const [ISSUE] = fixture('issues');
const STATUS = fixture('status');
const NO_STATUS = fixture('status-none');

const json = (status, value) => ({ status, body: JSON.stringify(value) });
const iso = (time) => new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');

export class FakeForge {
  constructor() {
    this.repos = [];
    this.moved = new Set();
    this.nextId = 1;
    this.requests = [];
    this.down = null; // an error code: every request fails
    this.status = null; // an HTTP status: every request answers it
    this.version = '11.0.16+gitea-1.22.0';
    this.time = Date.UTC(2026, 9, 20, 9, 0, 0);
    this.request = this.request.bind(this);
  }

  addRepo(fullName, { stars = 0, forks = 0, private: isPrivate = false, empty = false } = {}) {
    const [owner, name] = fullName.split('/');
    const repo = {
      id: this.nextId++,
      owner,
      name,
      stars,
      forks,
      private: isPrivate,
      empty,
      releases: [],
      issues: [],
      pulls: [],
      statuses: [],
      sha: 'a'.repeat(40),
      number: 0,
    };
    this.repos.push(repo);
    return repo;
  }

  repo(fullName) {
    return this.repos.find((repo) => `${repo.owner}/${repo.name}` === fullName);
  }

  addRelease(fullName, tag, { prerelease = false, draft = false } = {}) {
    const repo = this.repo(fullName);
    this.time += 60_000;
    const release = { id: this.nextId++, tag, prerelease, draft, at: this.time };
    repo.releases.unshift(release);
    return release;
  }

  addIssue(fullName, title, { pull = false, closed = false } = {}) {
    const repo = this.repo(fullName);
    this.time += 60_000;
    const issue = { number: ++repo.number, title, closed, at: this.time };
    (pull ? repo.pulls : repo.issues).unshift(issue);
    return issue;
  }

  /** A new commit on the default branch, without status yet. */
  push(fullName) {
    const repo = this.repo(fullName);
    repo.sha = (Number.parseInt(repo.sha.slice(0, 8), 16) + 1).toString(16).padStart(40, 'b');
    repo.statuses = [];
  }

  setStatus(fullName, context, state) {
    const repo = this.repo(fullName);
    repo.statuses = [...repo.statuses.filter((s) => s.context !== context), { context, state }];
  }

  rename(fullName, newName) {
    const repo = this.repo(fullName);
    this.moved.add(fullName);
    repo.name = newName;
  }

  repoBody(repo) {
    const url = `${BASE}/${repo.owner}/${repo.name}`;
    return {
      ...REPO,
      id: repo.id,
      name: repo.name,
      full_name: `${repo.owner}/${repo.name}`,
      owner: { ...REPO.owner, login: repo.owner, username: repo.owner },
      html_url: url,
      private: repo.private,
      empty: repo.empty,
      stars_count: repo.stars,
      forks_count: repo.forks,
      open_issues_count: repo.issues.filter((issue) => !issue.closed).length,
      open_pr_counter: repo.pulls.filter((pull) => !pull.closed).length,
      release_counter: repo.releases.filter((release) => !release.draft).length,
    };
  }

  combined(repo) {
    if (repo.statuses.length === 0) {
      return NO_STATUS;
    }
    const states = repo.statuses.map((s) => s.state);
    // The worst state wins, as in the forge.
    const state = ['error', 'failure', 'pending', 'warning', 'success'].find((s) =>
      states.includes(s),
    );
    return {
      ...STATUS,
      state,
      sha: repo.sha,
      total_count: repo.statuses.length,
      statuses: repo.statuses.map((s, index) => ({
        ...STATUS.statuses[0],
        id: index + 1,
        status: s.state,
        context: s.context,
      })),
    };
  }

  async request(url, { headers = {} } = {}) {
    this.requests.push({ url, headers });
    if (this.down) {
      throw Object.assign(new Error('fetch failed'), { cause: { code: this.down } });
    }
    if (this.status) {
      return json(this.status, { message: 'error' });
    }
    if (headers.authorization && headers.authorization !== `token ${TOKEN}`) {
      return json(401, { message: 'user does not exist [uid: 0, name: ]' });
    }
    const authorized = headers.authorization === `token ${TOKEN}`;
    const { pathname, searchParams } = new URL(url);
    if (pathname === '/api/v1/version') {
      return json(200, { version: this.version });
    }
    const match = pathname.match(/^\/api\/v1\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
    if (!match) {
      return json(404, { message: 'not found' });
    }
    const fullName = `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`;
    if (this.moved.has(fullName)) {
      return { status: 307, body: '' };
    }
    const repo = this.repo(fullName);
    if (!repo || (repo.private && !authorized)) {
      return json(404, { message: "The target couldn't be found.", errors: [] });
    }
    const rest = match[3] ?? '';
    const limit = Number(searchParams.get('limit') ?? 30);
    const page = `${BASE}/${fullName}`;
    if (rest === '') {
      return json(200, this.repoBody(repo));
    }
    if (rest === '/releases') {
      return json(
        200,
        repo.releases.slice(0, limit).map((release) => ({
          ...RELEASE,
          id: release.id,
          tag_name: release.tag,
          name: release.tag,
          draft: release.draft,
          prerelease: release.prerelease,
          html_url: `${page}/releases/tag/${release.tag}`,
          created_at: iso(release.at),
          published_at: iso(release.at),
        })),
      );
    }
    if (rest === '/issues') {
      const list = searchParams.get('type') === 'pulls' ? repo.pulls : repo.issues;
      return json(
        200,
        list.slice(0, limit).map((issue) => ({
          ...ISSUE,
          id: issue.number,
          number: issue.number,
          title: issue.title,
          state: issue.closed ? 'closed' : 'open',
          html_url: `${page}/issues/${issue.number}`,
          created_at: iso(issue.at),
        })),
      );
    }
    const status = rest.match(/^\/commits\/([^/]+)\/status$/);
    if (status) {
      if (repo.empty) {
        return json(500, { message: 'no open git repo found in context' });
      }
      return json(200, this.combined(repo));
    }
    return json(404, { message: 'not found' });
  }
}

/** Two public repositories with history, one private. */
export function sampleForge() {
  const forge = new FakeForge();
  forge.addRepo('alice/home-automation', { stars: 12, forks: 2 });
  forge.addRepo('forgejo/forgejo', { stars: 3400, forks: 600 });
  forge.addRepo('alice/secret', { private: true });
  forge.addRelease('alice/home-automation', 'v1.0.0');
  forge.addRelease('alice/home-automation', 'v1.1.0-rc.1', { prerelease: true });
  forge.addRelease('alice/home-automation', 'v2.0.0', { draft: true });
  forge.addIssue('alice/home-automation', 'Light flickers at night');
  forge.addIssue('alice/home-automation', 'Add a dark mode');
  forge.addIssue('alice/home-automation', 'Feature: scenes', { pull: true });
  forge.setStatus('alice/home-automation', 'ci/build', 'success');
  forge.addRelease('forgejo/forgejo', 'v11.0.16');
  forge.setStatus('forgejo/forgejo', 'ci/test', 'pending');
  return forge;
}
