// The client against the real answers of Forgejo 11.0.16 and Gitea 1.27.3
// (test/fixtures), and every error the forge or the network can give.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CI_STATES, ERROR_KINDS, ForgeClient, ForgeError } from '../src/forge/client.js';

const fixture = (forge, name) =>
  readFile(new URL(`./fixtures/${forge}/${name}.json`, import.meta.url), 'utf8');

/** A client whose every answer is a recorded body, by path. */
async function recorded(forge, extra = {}) {
  const routes = {
    '/api/v1/version': ['version', 200],
    '/api/v1/repos/alice/home-automation': ['repo', 200],
    '/api/v1/repos/alice/home-automation/releases': ['releases', 200],
    '/api/v1/repos/alice/home-automation/commits/main/status': ['status', 200],
    '/api/v1/repos/alice/home-automation/commits/nostatus/status': ['status-none', 200],
    '/api/v1/repos/alice/nope': ['not-found', 404],
    ...extra,
  };
  const requests = [];
  const request = async (url, options) => {
    requests.push({ url, ...options });
    const { pathname, searchParams } = new URL(url);
    let route = routes[pathname];
    if (pathname.endsWith('/issues')) {
      route = [searchParams.get('type') === 'pulls' ? 'pulls' : 'issues', 200];
    }
    const [name, status] = route ?? ['not-found', 404];
    return { status, body: await fixture(forge, name) };
  };
  return {
    client: new ForgeClient({ url: 'http://192.0.2.10:3000', token: 't0k', request }),
    requests,
  };
}

for (const [forge, version] of [
  ['forgejo', '11.0.16+gitea-1.22.0'],
  ['gitea', '1.27.3'],
]) {
  test(`${forge}: the real answers are read`, async () => {
    const { client, requests } = await recorded(forge);
    assert.equal(await client.version(), version);
    const repo = await client.repository('alice/home-automation');
    assert.deepEqual(
      { ...repo, url: undefined },
      {
        id: 1,
        fullName: 'alice/home-automation',
        url: undefined,
        defaultBranch: 'main',
        empty: false,
        archived: false,
        stars: 0,
        forks: 0,
        openIssues: 2,
        openPulls: 1,
      },
    );
    const releases = await client.releases('alice/home-automation');
    assert.deepEqual(
      releases.map((release) => [release.tag, release.prerelease]),
      [
        ['v1.1.0-rc.1', true],
        ['v1.0.0', false],
      ],
      'the draft is left out',
    );
    assert.equal(releases[1].name, 'First release');
    assert.equal(releases[1].author, 'alice');
    assert.ok(releases[1].published > 0);
    const issues = await client.issues('alice/home-automation', 'issues');
    assert.deepEqual(
      issues.map((issue) => [issue.number, issue.title]),
      [
        [2, 'Add a dark mode'],
        [1, 'Light flickers at night'],
      ],
    );
    const pulls = await client.issues('alice/home-automation', 'pulls');
    assert.deepEqual(
      pulls.map((pull) => pull.number),
      [3],
    );
    const status = await client.status('alice/home-automation', 'main');
    assert.equal(status.state, CI_STATES.FAILURE, 'a success and a failure: failing');
    assert.match(status.sha, /^[0-9a-f]{40}$/);
    // Forgejo answers "", Gitea "pending", for a commit without any status.
    assert.equal((await client.status('alice/home-automation', 'nostatus')).state, CI_STATES.NONE);
    assert.ok(requests.every((r) => r.headers.authorization === 'token t0k'));
    assert.ok(requests.every((r) => r.url.startsWith('http://192.0.2.10:3000/api/v1/')));
  });

  test(`${forge}: a repository not found, a token refused`, async () => {
    const { client } = await recorded(forge, {
      '/api/v1/version': ['bad-token', 401],
    });
    await assert.rejects(client.repository('alice/nope'), { kind: ERROR_KINDS.NOT_FOUND });
    await assert.rejects(client.version(), { kind: ERROR_KINDS.AUTH });
  });
}

test('every HTTP and network failure has its kind', async () => {
  const cases = [
    [{ status: 429, body: '' }, '/version', ERROR_KINDS.RATE_LIMITED],
    [{ status: 301, body: '' }, '/version', ERROR_KINDS.REDIRECT],
    [{ status: 307, body: '' }, 'repo', ERROR_KINDS.MOVED],
    [{ status: 404, body: '' }, '/version', ERROR_KINDS.NOT_FORGE],
    [{ status: 403, body: '{}' }, 'repo', ERROR_KINDS.NOT_FOUND],
    [{ status: 500, body: '{}' }, 'repo', ERROR_KINDS.HTTP],
    [{ status: 200, body: '<html>' }, '/version', ERROR_KINDS.NOT_FORGE],
    [{ status: 200, body: '{"foo": 1}' }, '/version', ERROR_KINDS.NOT_FORGE],
    [{ status: 200, body: '{"message": "x"}' }, 'releases', ERROR_KINDS.NOT_FORGE],
  ];
  for (const [answer, what, kind] of cases) {
    const client = new ForgeClient({ url: 'http://192.0.2.10', request: async () => answer });
    const call =
      what === 'repo'
        ? client.repository('a/b')
        : what === 'releases'
          ? client.releases('a/b')
          : client.version();
    await assert.rejects(call, (err) => err instanceof ForgeError && err.kind === kind, kind);
  }
  const failing = (error) =>
    new ForgeClient({
      url: 'http://192.0.2.10',
      request: async () => {
        throw error;
      },
    });
  for (const [error, kind] of [
    [Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }), 'unreachable'],
    [Object.assign(new Error('timeout'), { name: 'TimeoutError' }), 'timeout'],
    [
      Object.assign(new Error('fetch failed'), { cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' } }),
      'tls',
    ],
  ]) {
    await assert.rejects(failing(error).version(), { kind });
  }
});

test('anonymous: no authorization header; names are escaped in the path', async () => {
  const urls = [];
  const client = new ForgeClient({
    url: 'https://codeberg.org',
    request: async (url, { headers }) => {
      urls.push(url);
      assert.equal(headers.authorization, undefined);
      return { status: 200, body: '[]' };
    },
  });
  await client.issues('my.org/my-repo', 'pulls');
  await client.status('a/b', 'feat/x');
  assert.deepEqual(urls, [
    'https://codeberg.org/api/v1/repos/my.org/my-repo/issues?state=all&type=pulls&limit=5',
    'https://codeberg.org/api/v1/repos/a/b/commits/feat%2Fx/status',
  ]);
});
