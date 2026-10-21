import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  MAX_REPOSITORIES,
  normalizeConfig,
  parseRepositories,
  parseServerUrl,
} from '../src/config.js';

test('the forge address: host, host:port, copied URL, sub-path', () => {
  assert.equal(parseServerUrl('codeberg.org'), 'https://codeberg.org');
  assert.equal(parseServerUrl(' 192.168.1.2:3000 '), 'http://192.168.1.2:3000');
  assert.equal(parseServerUrl('http://192.168.1.2:3000/'), 'http://192.168.1.2:3000');
  assert.equal(parseServerUrl('https://codeberg.org/explore/repos'), 'https://codeberg.org');
  assert.equal(parseServerUrl('https://example.com/git/'), 'https://example.com/git');
  assert.equal(parseServerUrl('https://example.com/git/api/v1'), 'https://example.com/git');
  for (const bad of ['', 'ftp://x', 'http://user:pass@host', 'http://', 42]) {
    assert.equal(parseServerUrl(bad), null, String(bad));
  }
});

test('the repositories: owner/name or links, duplicates and junk reported', () => {
  assert.deepEqual(
    parseRepositories(
      'forgejo/forgejo, https://codeberg.org/me/my.app.git\nFORGEJO/forgejo; x; a/b/issues ../..',
    ),
    { names: ['forgejo/forgejo', 'me/my.app', 'a/b'], invalid: ['x', '../..'], dropped: 3 },
  );
  const many = Array.from({ length: MAX_REPOSITORIES + 3 }, (_, i) => `o/r${i}`).join(',');
  const config = normalizeConfig({ url: 'codeberg.org', repositories: many });
  assert.equal(config.repositories.length, MAX_REPOSITORIES);
  assert.equal(config.tooMany, true);
});

test('normalized defaults', () => {
  const config = normalizeConfig({});
  assert.equal(config.url, null);
  assert.equal(config.urlTyped, false);
  assert.equal(config.token, '');
  assert.equal(config.pollIntervalMs, Number(DEFAULT_CONFIG.poll_interval) * 60_000);
  assert.equal(config.language, 'fr');
  const typed = normalizeConfig({
    url: 'x y',
    token: ' abc\n',
    poll_interval: '60',
    language: 'de',
  });
  assert.equal(typed.url, null);
  assert.equal(typed.urlTyped, true);
  assert.equal(typed.token, 'abc');
  assert.equal(typed.pollIntervalMs, 3_600_000);
  assert.equal(normalizeConfig({ poll_interval: '1' }).pollIntervalMs, 600_000);
});
