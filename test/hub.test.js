import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TRIGGERS, WIDGET_KEY, forgeName, transportOf } from '../src/hub.js';
import {
  BASE,
  CONFIG,
  TOKEN,
  createClock,
  createDevices,
  createWorld,
  idsOf,
  sampleForge,
} from './helpers/world.js';

const HOME = 'alice/home-automation';
const FORGEJO = 'forgejo/forgejo';

const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);

async function captureLogs(t, level, fn) {
  const lines = [];
  const write = (chunk) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  const before = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const stdout = t.mock.method(process.stdout, 'write', write);
  const stderr = t.mock.method(process.stderr, 'write', write);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = before;
  }
  return lines;
}

test('one device per followed repository, nothing polled by Gladys, no event at first', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => device.name),
    [HOME, FORGEJO],
  );
  assert.ok(devices.every((device) => device.should_poll === false && !device.poll_frequency));
  assert.equal(world.fake.sceneEvents.length, 0, 'the past is not announced');
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('the states of an added device: figures, latest stable release, CI', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const home = idsOf(world, HOME);
  const state = (key) => world.fake.lastState(home.feature(key));
  assert.equal(state('stars'), 12);
  assert.equal(state('forks'), 2);
  assert.equal(state('open_issues'), 2);
  assert.equal(state('open_pull_requests'), 1);
  // The draft v2.0.0 and the pre-release are newer: the stable one is shown.
  assert.equal(state('latest_release'), 'v1.0.0');
  assert.match(state('latest_release_date'), /^\d{2}\/\d{2}\/2026$/);
  assert.equal(state('ci_status'), 'Passing');
  assert.equal(state('ci_passing'), 1);
  // Running: the binary keeps its last value (none yet).
  const forgejo = idsOf(world, FORGEJO);
  assert.equal(world.fake.lastState(forgejo.feature('ci_status')), 'Running');
  assert.equal(world.fake.lastState(forgejo.feature('ci_passing')), undefined);
  assert.ok(world.fake.widgetRefreshes.includes(WIDGET_KEY));
  // 192.0.2.10 is a documentation address, not a private one: cloud.
  assert.equal(world.fake.transports.at(-1).transport, transportOf(BASE));
});

test('new releases, issues and pull requests fire their triggers, once', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.forge.addRelease(HOME, 'v1.2.0-beta', { prerelease: true });
  world.forge.addRelease(HOME, 'v3.0.0', { draft: true });
  world.forge.addIssue(HOME, 'Opened and closed at once', { closed: true });
  world.forge.addIssue(HOME, 'Add Matter', { pull: true });
  await world.hub.pollNow();
  await world.hub.pollNow();
  const [release] = events(world, TRIGGERS.RELEASE);
  assert.equal(events(world, TRIGGERS.RELEASE).length, 1, 'a draft is not a release');
  assert.equal(release.data.release_type, 'prerelease');
  assert.equal(release.data.tag, 'v1.2.0-beta');
  assert.equal(release.data.repository, idsOf(world, HOME).device);
  assert.equal(release.data.summary, `New release of ${HOME}: v1.2.0-beta`);
  assert.deepEqual(
    events(world, TRIGGERS.ISSUE).map((event) => [event.data.number, event.data.title]),
    [[4, 'Opened and closed at once']],
  );
  assert.deepEqual(
    events(world, TRIGGERS.PULL).map((event) => event.data.number),
    [5],
  );
});

test('a burst of issues fires three events at most, oldest first', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (let i = 1; i <= 6; i += 1) {
    world.forge.addIssue(FORGEJO, `Imported ${i}`);
  }
  await world.hub.pollNow();
  assert.deepEqual(
    events(world, TRIGGERS.ISSUE).map((event) => event.data.title),
    ['Imported 4', 'Imported 5', 'Imported 6'],
  );
  // The first issue of a repository that had none counts too.
  assert.equal(events(world, TRIGGERS.ISSUE)[0].data.repository_name, FORGEJO);
});

test('the CI trigger: failing, still failing, running, back to green', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const states = () => events(world, TRIGGERS.CI).map((event) => event.data.state);
  world.forge.setStatus(HOME, 'ci/test', 'failure');
  await world.hub.pollNow();
  assert.deepEqual(states(), ['failure']);
  const failing = events(world, TRIGGERS.CI)[0].data;
  assert.equal(failing.branch, 'main');
  assert.equal(failing.url, `${BASE}/${HOME}/commit/${failing.sha}`);
  world.forge.setStatus(HOME, 'ci/test', 'error');
  await world.hub.pollNow();
  world.forge.push(HOME);
  world.forge.setStatus(HOME, 'ci/test', 'pending');
  await world.hub.pollNow();
  assert.deepEqual(states(), ['failure'], 'still failing, then running: nothing');
  world.forge.setStatus(HOME, 'ci/test', 'success');
  await world.hub.pollNow();
  world.forge.push(HOME);
  world.forge.setStatus(HOME, 'ci/test', 'warning');
  await world.hub.pollNow();
  assert.deepEqual(states(), ['failure', 'success'], 'a warning passes');
  assert.equal(
    events(world, TRIGGERS.CI)[1].data.summary,
    `The CI of ${HOME} (main) is passing again`,
  );
  // The first CI ever of a repository: a success is not "back to green".
  world.forge.setStatus(FORGEJO, 'ci/test', 'success');
  await world.hub.pollNow();
  assert.equal(states().length, 2);
});

test('a restart neither misses an event nor announces one twice', async (t) => {
  const forge = sampleForge();
  const first = await createWorld({ forge });
  await first.app.stop();
  forge.addRelease(HOME, 'v1.1.0');
  forge.setStatus(HOME, 'ci/build', 'failure');
  const second = await createWorld({ forge, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.deepEqual(
    second.fake.sceneEvents.map((event) => event.key),
    [TRIGGERS.RELEASE, TRIGGERS.CI],
  );
  await second.app.stop();
  const third = await createWorld({ forge, dataDir: first.dataDir });
  t.after(() => third.app.stop());
  assert.equal(third.fake.sceneEvents.length, 0);
  const saved = JSON.parse(await readFile(`${first.dataDir}/forgejo-state.json`, 'utf8'));
  assert.equal(saved.url, BASE);
  assert.equal(JSON.stringify(saved).includes(TOKEN), false, 'no token in /data');
});

test('a repository added later starts silent; one removed is forgotten', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, repositories: HOME } });
  t.after(() => world.app.stop());
  await world.fake.configUpdated({ ...CONFIG, repositories: `${HOME}, ${FORGEJO}` });
  assert.equal(world.fake.discoveredDevices.length, 2);
  assert.equal(world.fake.sceneEvents.length, 0);
  await world.fake.configUpdated({ ...CONFIG, repositories: FORGEJO });
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => device.name),
    [FORGEJO],
  );
  assert.deepEqual(Object.keys(world.hub.saved.repos), [String(world.forge.repo(FORGEJO).id)]);
});

test('a repository not found, private, or renamed does not stop the others', async (t) => {
  const world = await createWorld({
    config: { ...CONFIG, token: '', repositories: `${HOME}, alice/secret, nobody/nothing` },
  });
  t.after(() => world.app.stop());
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => device.name),
    [HOME],
  );
  assert.ok(world.forge.requests.every((request) => !request.headers.authorization));
  const report = (await world.fake.action('test_connection', {})).data.message.en;
  assert.match(report, /without a token/);
  assert.match(report, /alice\/secret: repository not found, or private/);

  // With the token, the private one is read.
  await world.fake.configUpdated({ ...CONFIG, repositories: `${HOME}, alice/secret` });
  assert.equal(world.fake.discoveredDevices.length, 2);

  await createDevices(world);
  world.forge.rename(HOME, 'domotique');
  await world.hub.pollNow();
  assert.equal(world.fake.discoveredDevices.length, 2, 'the device stays');
  assert.equal(world.hub.entries.get(HOME).error, 'moved');
  const transport = world.fake.transports
    .filter((entry) => entry.device_external_id === idsOf(world, 'alice/domotique').device)
    .at(-1);
  assert.equal(transport.transport, 'unreachable');
  // The new name keeps the same device (same repository id).
  await world.fake.configUpdated({ ...CONFIG, repositories: 'alice/domotique, alice/secret' });
  assert.equal(world.fake.discoveredDevices[0].external_id, idsOf(world, 'alice/domotique').device);
  assert.equal(world.fake.sceneEvents.length, 0);
});

test('errors: forge down, token refused, rate limited — one log line each', async (t) => {
  const clock = createClock();
  const world = await createWorld({ clock });
  t.after(() => world.app.stop());
  await createDevices(world);
  world.forge.down = 'ECONNREFUSED';
  const lines = await captureLogs(t, 'info', async () => {
    await world.hub.pollNow();
    clock.advance(600_000);
    await world.hub.pollNow();
  });
  assert.equal(lines.length, 1, 'one line for an outage, not one per read');
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.equal(world.fake.connectionStatus.message.en, 'the forge does not answer');
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(world.fake.discoveredDevices.length, 2, 'the list is kept');
  world.forge.down = null;
  await world.hub.pollNow();
  assert.equal(world.fake.connectionStatus.connected, true);

  world.forge.status = 429;
  await world.hub.pollNow();
  assert.match(world.fake.connectionStatus.message.en, /too many requests/);
  world.forge.status = null;

  await world.fake.configUpdated({ ...CONFIG, token: 'wrong' });
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /access token refused/);
});

test('the configuration is checked before anything is read', async (t) => {
  for (const [config, message] of [
    [{}, /Enter the address/],
    [{ url: 'ftp://x' }, /Address not understood/],
  ]) {
    const world = await createWorld({ config });
    t.after(() => world.app.stop());
    assert.equal(world.fake.connectionStatus.connected, false);
    assert.match(world.fake.connectionStatus.message.en, message);
    assert.equal(world.forge.requests.length, 0);
  }
});

test('a normal reading cycle writes nothing at the info level, never a token', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const lines = await captureLogs(t, 'info', async () => {
    await world.hub.pollNow();
    world.forge.repo(HOME).stars += 1;
    await world.hub.pollNow();
  });
  assert.deepEqual(lines, []);
  const debug = await captureLogs(t, 'debug', () => world.hub.pollNow());
  assert.equal(debug.join('\n').includes(TOKEN), false);
});

test('the container reads the forge by itself, without onPoll', async (t) => {
  const world = await createWorld({ timers: true });
  t.after(() => world.app.stop());
  await createDevices(world);
  world.hub.config = { ...world.hub.config, pollIntervalMs: 20 };
  world.hub.schedulePoll();
  world.forge.repo(HOME).stars = 40;
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(world.fake.lastState(idsOf(world, HOME).feature('stars')), 40);
});

test('Gladys reconnecting gets every state again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const before = world.fake.states.length;
  await world.hub.resync(world.hub.config);
  assert.ok(world.fake.states.length >= before + 8);
});

test('local or cloud badge, and the name of the forge', () => {
  for (const url of ['http://192.168.1.2:3000', 'http://10.0.0.5', 'http://gitea:3000']) {
    assert.equal(transportOf(url), 'local', url);
  }
  for (const url of ['http://git.local:3000', 'http://[fd00::1]:3000']) {
    assert.equal(transportOf(url), 'local', url);
  }
  for (const url of ['https://codeberg.org', 'https://git.example.com', 'http://203.0.113.4']) {
    assert.equal(transportOf(url), 'cloud', url);
  }
  assert.equal(forgeName('11.0.16+gitea-1.22.0'), 'Forgejo 11.0.16');
  assert.equal(forgeName('1.27.3'), 'Gitea 1.27.3');
});
