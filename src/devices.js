// -----------------------------------------------------------------------------
// Gladys devices, proposed in the Discovery tab: one per followed repository,
// identified by the numeric id the forge gives it (a rename or a transfer
// keeps the device).
//
//   stars               counter-sensor/integer
//   forks               counter-sensor/integer
//   open_issues         counter-sensor/integer  issues only
//   open_pull_requests  counter-sensor/integer
//   latest_release      text/text     tag of the latest release (stable
//                                     first, else the latest pre-release)
//   latest_release_date text/text     its publication date, day/month/year
//   ci_status           text/text     CI of the default branch: "Passing",
//                                     "Failing", "Running", "No CI"
//   ci_passing          input/binary  1 when it passes, 0 when it fails
//                                     (input/binary is green at 1); not
//                                     changed while it runs
//
// Read-only: no command. Published with should_poll: false, the integration
// reads the forge on its own timer (src/hub.js).
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { CI_STATES } from './forge/client.js';
import { CI_TEXT, NO_RELEASE, formatDate, pick } from './texts.js';

export const REPOSITORY_TYPE = 'repo';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  STARS: 'stars',
  FORKS: 'forks',
  OPEN_ISSUES: 'open_issues',
  OPEN_PULLS: 'open_pull_requests',
  LATEST_RELEASE: 'latest_release',
  LATEST_RELEASE_DATE: 'latest_release_date',
  CI_STATUS: 'ci_status',
  CI_PASSING: 'ci_passing',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.STARS]: 'Stars',
    [FEATURE_KEYS.FORKS]: 'Forks',
    [FEATURE_KEYS.OPEN_ISSUES]: 'Open issues',
    [FEATURE_KEYS.OPEN_PULLS]: 'Open pull requests',
    [FEATURE_KEYS.LATEST_RELEASE]: 'Latest release',
    [FEATURE_KEYS.LATEST_RELEASE_DATE]: 'Latest release date',
    [FEATURE_KEYS.CI_STATUS]: 'CI status',
    [FEATURE_KEYS.CI_PASSING]: 'CI passing',
  },
  fr: {
    [FEATURE_KEYS.STARS]: 'Étoiles',
    [FEATURE_KEYS.FORKS]: 'Forks',
    [FEATURE_KEYS.OPEN_ISSUES]: 'Tickets ouverts',
    [FEATURE_KEYS.OPEN_PULLS]: 'Demandes de fusion ouvertes',
    [FEATURE_KEYS.LATEST_RELEASE]: 'Dernière version',
    [FEATURE_KEYS.LATEST_RELEASE_DATE]: 'Date de la dernière version',
    [FEATURE_KEYS.CI_STATUS]: 'État de la CI',
    [FEATURE_KEYS.CI_PASSING]: 'CI réussie',
  },
  de: {
    [FEATURE_KEYS.STARS]: 'Sterne',
    [FEATURE_KEYS.FORKS]: 'Forks',
    [FEATURE_KEYS.OPEN_ISSUES]: 'Offene Issues',
    [FEATURE_KEYS.OPEN_PULLS]: 'Offene Pull-Requests',
    [FEATURE_KEYS.LATEST_RELEASE]: 'Neuestes Release',
    [FEATURE_KEYS.LATEST_RELEASE_DATE]: 'Datum des neuesten Release',
    [FEATURE_KEYS.CI_STATUS]: 'CI-Status',
    [FEATURE_KEYS.CI_PASSING]: 'CI erfolgreich',
  },
  es: {
    [FEATURE_KEYS.STARS]: 'Estrellas',
    [FEATURE_KEYS.FORKS]: 'Forks',
    [FEATURE_KEYS.OPEN_ISSUES]: 'Incidencias abiertas',
    [FEATURE_KEYS.OPEN_PULLS]: 'Pull requests abiertas',
    [FEATURE_KEYS.LATEST_RELEASE]: 'Última versión',
    [FEATURE_KEYS.LATEST_RELEASE_DATE]: 'Fecha de la última versión',
    [FEATURE_KEYS.CI_STATUS]: 'Estado de la CI',
    [FEATURE_KEYS.CI_PASSING]: 'CI correcta',
  },
};

export const MODEL = 'Forgejo / Gitea';
// Display bound of the counters (the core never applies it on write).
export const MAX_COUNT = 1_000_000;

export const repositoryIds = (gladys, id) => gladys.externalIds(REPOSITORY_TYPE, String(id));

/** The repository id of a device external id, null when it is not one of ours. */
export function parseRepositoryId(gladys, externalId) {
  const prefix = repositoryIds(gladys, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const id = externalId.slice(prefix.length);
  return /^[1-9]\d{0,14}$/.test(id) ? Number(id) : null;
}

/** The release a device shows: the latest stable one, else the latest pre-release. */
export const shownRelease = (releases) =>
  releases.find((release) => !release.prerelease) ?? releases[0] ?? null;

const sensor = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  ...extra,
});

const counter = (name, externalId) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    { keep_history: true, min: 0, max: MAX_COUNT },
  );

const text = (name, externalId) =>
  sensor(name, externalId, DEVICE_FEATURE_CATEGORIES.TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT, {
    keep_history: false,
    min: 0,
    max: 0,
  });

const binary = (name, externalId) =>
  sensor(name, externalId, DEVICE_FEATURE_CATEGORIES.INPUT, DEVICE_FEATURE_TYPES.SENSOR.BINARY, {
    keep_history: true,
    min: 0,
    max: 1,
  });

/**
 * The discovery payload of a repository.
 * @param {object} repo normalized (src/forge/client.js)
 * @param {string} [language]
 */
export function buildRepositoryDevice(gladys, repo, language = 'en') {
  const ids = repositoryIds(gladys, repo.id);
  const names = NAMES[language] ?? NAMES.en;
  const name = (key) => names[key];
  const feature = (key) => ids.feature(key);
  const params = [{ name: 'REPOSITORY', value: repo.fullName }];
  if (repo.url) {
    params.push({ name: 'URL', value: repo.url });
  }
  return {
    name: repo.fullName,
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params,
    features: [
      counter(name(FEATURE_KEYS.STARS), feature(FEATURE_KEYS.STARS)),
      counter(name(FEATURE_KEYS.FORKS), feature(FEATURE_KEYS.FORKS)),
      counter(name(FEATURE_KEYS.OPEN_ISSUES), feature(FEATURE_KEYS.OPEN_ISSUES)),
      counter(name(FEATURE_KEYS.OPEN_PULLS), feature(FEATURE_KEYS.OPEN_PULLS)),
      text(name(FEATURE_KEYS.LATEST_RELEASE), feature(FEATURE_KEYS.LATEST_RELEASE)),
      text(name(FEATURE_KEYS.LATEST_RELEASE_DATE), feature(FEATURE_KEYS.LATEST_RELEASE_DATE)),
      text(name(FEATURE_KEYS.CI_STATUS), feature(FEATURE_KEYS.CI_STATUS)),
      binary(name(FEATURE_KEYS.CI_PASSING), feature(FEATURE_KEYS.CI_PASSING)),
    ],
  };
}

/**
 * The value of every feature of a repository: `{ device_feature_external_id,
 * state|text }`, nothing for a value that is not known.
 * @param {object} entry what the hub read: `repo`, `releases`, `ci` (null
 *   when unreadable)
 */
export function repositoryValues(gladys, entry, language) {
  const ids = repositoryIds(gladys, entry.repo.id);
  const { repo, ci } = entry;
  const cap = (value) => Math.min(value, MAX_COUNT);
  const values = [
    { key: FEATURE_KEYS.STARS, state: cap(repo.stars) },
    { key: FEATURE_KEYS.FORKS, state: cap(repo.forks) },
    { key: FEATURE_KEYS.OPEN_ISSUES, state: cap(repo.openIssues) },
    { key: FEATURE_KEYS.OPEN_PULLS, state: cap(repo.openPulls) },
  ];
  if (entry.releases) {
    const release = shownRelease(entry.releases);
    values.push({
      key: FEATURE_KEYS.LATEST_RELEASE,
      text: release ? release.tag : pick(NO_RELEASE, language),
    });
    // A text state is never empty: "No release" when there is none.
    values.push({
      key: FEATURE_KEYS.LATEST_RELEASE_DATE,
      text: release?.published
        ? formatDate(release.published, language)
        : pick(NO_RELEASE, language),
    });
  }
  if (ci) {
    values.push({ key: FEATURE_KEYS.CI_STATUS, text: pick(CI_TEXT[ci.state], language) });
    if (ci.state === CI_STATES.SUCCESS || ci.state === CI_STATES.FAILURE) {
      values.push({ key: FEATURE_KEYS.CI_PASSING, state: ci.state === CI_STATES.SUCCESS ? 1 : 0 });
    }
  }
  return values.map(({ key, ...value }) => ({
    device_feature_external_id: ids.feature(key),
    ...value,
  }));
}
