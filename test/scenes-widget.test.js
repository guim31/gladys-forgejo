import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { MAX_ROWS } from '../src/widgets.js';
import { CONFIG, FakeForge, createDevices, createWorld, idsOf } from './helpers/world.js';

const HOME = 'alice/home-automation';
const FORGEJO = 'forgejo/forgejo';

const widget = async (world, settings = {}, language = 'en') => {
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(validateWidgetContent(ack.data.content), []);
  return ack.data.content;
};
const rows = (content) => content.components.find((c) => c.type === 'status')?.items ?? [];

test('the widget: failing first, CI state, release and issues, Refresh', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.forge.setStatus(HOME, 'ci/test', 'failure');
  await world.hub.pollNow();
  const content = await widget(world, {}, 'fr');
  assert.ok(content.components.length <= 8);
  assert.deepEqual(
    rows(content).map((row) => [row.label, row.value, row.color]),
    [
      [HOME, 'En échec · v1.0.0 · 2 tickets', 'danger'],
      [FORGEJO, 'En cours · v11.0.16 · 0 tickets', 'info'],
    ],
  );
  assert.equal(content.ttl_seconds, 60, 'a CI running: sooner');
  const button = content.components.at(-1);
  assert.equal(button.action.key, 'refresh');
  world.forge.repo(HOME).stars = 99;
  const ack = await world.fake.widgetAction(WIDGET_KEY, 'refresh', {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(world.hub.entries.get(HOME).repo.stars, 99);
});

test('the widget shows the chosen repositories, and says why it is empty', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const chosen = await widget(world, { repositories: [idsOf(world, FORGEJO).device] });
  assert.deepEqual(
    rows(chosen).map((row) => row.label),
    [FORGEJO],
  );

  await world.fake.configUpdated({ ...CONFIG, repositories: '' });
  const empty = await widget(world);
  assert.match(empty.components[0].text, /No repository followed/);

  world.forge.down = 'ECONNREFUSED';
  await world.fake.configUpdated(CONFIG);
  const down = await widget(world);
  assert.equal(down.components[0].text, 'the forge does not answer');
});

test('many repositories: the widget keeps ten rows', async (t) => {
  const forge = new FakeForge();
  const names = Array.from({ length: 14 }, (_, i) => `org/repo-${String(i).padStart(2, '0')}`);
  for (const name of names) {
    forge.addRepo(name);
  }
  const world = await createWorld({ forge, config: { ...CONFIG, repositories: names.join(',') } });
  t.after(() => world.app.stop());
  const content = await widget(world);
  assert.equal(rows(content).length, MAX_ROWS);
  assert.equal(rows(content).at(-1).value, '+5');
});

test('the scene action reads a followed repository', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('get_repository', {
    repository: idsOf(world, HOME).device,
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    repository_name: HOME,
    url: `http://192.0.2.10:3000/${HOME}`,
    stars: 12,
    forks: 2,
    open_issues: 2,
    open_pull_requests: 1,
    latest_release: 'v1.0.0',
    ci_status: 'Passing',
    ci_passing: true,
  });

  // A device whose repository left the list.
  const id = idsOf(world, FORGEJO).device;
  await world.fake.configUpdated({ ...CONFIG, repositories: HOME });
  const refused = await world.fake.sceneAction('get_repository', { repository: id });
  assert.equal(refused.success, false);
  assert.match(refused.error, /not in the list/);

  world.forge.down = 'ECONNREFUSED';
  world.clock.advance(120_000);
  const down = await world.fake.sceneAction('get_repository', {
    repository: idsOf(world, HOME).device,
  });
  assert.equal(down.success, false);
  assert.match(down.error, /does not answer/);
});
