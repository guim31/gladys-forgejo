// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from the real
// answers of Forgejo 11.0.16 and Gitea 1.27.3 (test/fixtures: a repository with
// issues, a pull request, releases and a failing CI, and an empty repository),
// in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { Store } from '../src/store.js';

process.env.LOG_LEVEL ??= 'silent';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const fixture = (forge, name) =>
  readFile(new URL(`./fixtures/${forge}/${name}.json`, import.meta.url), 'utf8');

/** The recorded answers of a forge, by request. */
function recorded(forge) {
  return async (url) => {
    const { pathname, searchParams } = new URL(url);
    const empty = pathname.includes('/empty-repo');
    let name = 'not-found';
    if (pathname === '/api/v1/version') {
      name = 'version';
    } else if (/\/repos\/alice\/[\w-]+$/.test(pathname)) {
      name = empty ? 'repo-empty' : 'repo';
    } else if (pathname.endsWith('/releases')) {
      return { status: 200, body: empty ? '[]' : await fixture(forge, 'releases') };
    } else if (pathname.endsWith('/issues')) {
      if (empty) {
        return { status: 200, body: '[]' };
      }
      name = searchParams.get('type') === 'pulls' ? 'pulls' : 'issues';
    } else if (pathname.endsWith('/status')) {
      name = 'status';
    }
    const body = await fixture(
      forge === 'gitea' && name === 'repo-empty' ? 'forgejo' : forge,
      name,
    );
    return { status: name === 'not-found' ? 404 : 200, body };
  };
}

async function discover(language, forge) {
  const gladys = createFakeGladys({
    config: {
      url: 'http://192.0.2.10:3000',
      token: 'x'.repeat(40),
      repositories: 'alice/home-automation, alice/empty-repo',
      language,
    },
  });
  const app = registerHandlers(gladys, {
    store: new Store(mkdtempSync(join(tmpdir(), 'gladys-forgejo-rules-'))),
    timers: false,
    request: recorded(forge),
  });
  await gladys.connect();
  await app.ready;
  // The states, too: added devices, every value checked by the fake Gladys.
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
  await app.stop();
  return gladys.fake;
}

const scenarios = [
  { label: 'Forgejo, English names', language: 'en', forge: 'forgejo' },
  { label: 'Gitea, French names', language: 'fr', forge: 'gitea' },
  { label: 'Forgejo, German names', language: 'de', forge: 'forgejo' },
  { label: 'Gitea, Spanish names', language: 'es', forge: 'gitea' },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const fake = await discover(scenario.language, scenario.forge);
    const devices = fake.discoveredDevices;
    assert.equal(devices.length, 2, 'the two repositories of the fixture');
    assert.ok(fake.states.length >= 12, 'states accepted by the fake Gladys');
    assert.ok(
      fake.states.every((state) => state.text === undefined || state.text.length > 0),
      'no empty text',
    );
    assert.equal(
      new Set(devices.map((device) => device.external_id)).size,
      devices.length,
      'unique device external ids',
    );

    for (const device of devices) {
      const where = device.name;

      // should_poll: true if and only if poll_frequency is provided, in ms.
      if (device.poll_frequency === undefined) {
        assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
      } else {
        assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
        assert.ok(
          table.poll_frequencies_ms.includes(device.poll_frequency),
          `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
        );
      }

      assert.ok(device.features.length > 0, `${where}: no feature`);
      const externalIds = new Set();
      const names = new Set();
      for (const feature of device.features) {
        const at = `${where} / ${feature.name}`;
        const pair = table.pairs[`${feature.category}/${feature.type}`];
        assert.ok(pair, `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`);
        assert.ok(
          pair.label_en && pair.label_fr && pair.icon,
          `${at}: couple without label or icon`,
        );

        assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
        assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
        assert.ok(
          Number.isFinite(feature.min) && Number.isFinite(feature.max),
          `${at}: finite min/max`,
        );
        assert.ok(feature.min <= feature.max, `${at}: min > max`);
        assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
        assert.equal(
          typeof feature.has_feedback,
          'boolean',
          `${at}: has_feedback must be a boolean`,
        );
        if (feature.unit !== undefined) {
          assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
        }

        assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
        externalIds.add(feature.external_id);
        assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
        names.add(feature.name);
      }
    }
  });
}
