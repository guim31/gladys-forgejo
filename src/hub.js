// -----------------------------------------------------------------------------
// The forge hub: the followed repositories (the list of the configuration)
// read on a timer of the container, their states published when they change,
// and the scene events fired when something new appears.
//
// One reading: the version of the forge (it answers, the token is accepted),
// then for each repository its figures, its five newest releases, issues and
// pull requests, and the combined CI state of its default branch: five
// requests per repository, every 10 minutes by default.
//
// Gladys never polls these devices (should_poll: false): the interval is
// beyond the fixed list of the core scheduler, and an event must fire for a
// repository added to Gladys or not.
//
// What was seen is kept in /data (src/store.js): the releases, the highest
// issue and pull request numbers, the last CI result of each repository, so
// that a restart neither misses an event nor announces it twice. The first
// reading of a repository only sets what is known: no event for the past.
// -----------------------------------------------------------------------------

import { isIP } from 'node:net';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  buildRepositoryDevice,
  parseRepositoryId,
  repositoryIds,
  repositoryValues,
} from './devices.js';
import { CI_STATES, ERROR_KINDS, ForgeClient, ForgeError } from './forge/client.js';
import { MAX_REPOSITORIES, hostOf, normalizeConfig } from './config.js';
import { ProblemLog } from './problems.js';
import {
  ACTION_TEXT,
  CI_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  SUMMARY_TEXT,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'forgejo-hub' });

export const WIDGET_KEY = 'repositories';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
// The first three are the keys of the GitHub integration (William-De71).
export const TRIGGERS = Object.freeze({
  RELEASE: 'release_published',
  ISSUE: 'issue_opened',
  PULL: 'pull_request_opened',
  CI: 'ci_status_changed',
});

export const HUB_TIMINGS = {
  // An unchanged value is sent again this often: Gladys shows "no recent
  // value" after 48 hours.
  heartbeatMs: 12 * 3600_000,
  // A command reads the forge again when the last read is older.
  freshMs: 60_000,
};

// Errors that concern the whole forge, not one repository.
const GLOBAL_KINDS = new Set([
  ERROR_KINDS.UNREACHABLE,
  ERROR_KINDS.TIMEOUT,
  ERROR_KINDS.TLS,
  ERROR_KINDS.AUTH,
  ERROR_KINDS.REDIRECT,
  ERROR_KINDS.RATE_LIMITED,
]);

// Pages read per repository, and events fired at most per repository, kind
// and reading (a burst of imported issues does not flood the scenes).
const PAGE = 5;
const MAX_EVENTS = 3;
// Release ids remembered per repository.
const SEEN_RELEASES = 20;
const MAX_TRANSPORTS_PER_REQUEST = 100;

/**
 * A forge on the local network (private address, `.local`, a name without a
 * dot) shows the "local" badge, any other (Codeberg…) the "cloud" one.
 */
export function transportOf(url) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return DEVICE_TRANSPORTS.CLOUD;
  }
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    const local =
      a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    return local || (a === 169 && b === 254) ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.CLOUD;
  }
  if (isIP(host) === 6) {
    return /^(::1$|fc|fd|fe80)/.test(host) ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.CLOUD;
  }
  return !host.includes('.') || /\.(local|lan|home|internal|home\.arpa)$/.test(host)
    ? DEVICE_TRANSPORTS.LOCAL
    : DEVICE_TRANSPORTS.CLOUD;
}

/** Forgejo reports "11.0.6+gitea-1.22.0", Gitea "1.24.6". */
export const forgeName = (version) =>
  /\+gitea-/i.test(version ?? '') ? `Forgejo ${version.split('+')[0]}` : `Gitea ${version}`;

const key = (fullName) => fullName.toLowerCase();

async function mapLimited(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export class ForgeHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/forge/client.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    // Defaults until start(): a handler reached after a failed start still
    // answers with a readable message.
    this.config = normalizeConfig({});
    this.client = null;
    this.signature = null;
    /** @type {Map<string, object>} by lower-case full name: { name, repo, releases, ci, error } */
    this.entries = new Map();
    this.version = null;
    this.readAt = 0;
    this.error = null;
    this.polling = null;
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.saved = this.emptySaved();
    this.pollTimer = null;
    this.stopped = false;
    // What fails again at every cycle: one line when it starts, one when it ends.
    this.problems = new ProblemLog(logger);
  }

  emptySaved() {
    // repos: repository id → { releases: [ids], issue, pull, ci }
    return { repos: {}, url: null };
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      repos:
        saved.repos && typeof saved.repos === 'object' && !Array.isArray(saved.repos)
          ? saved.repos
          : {},
      url: typeof saved.url === 'string' ? saved.url : null,
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    if (previous.language !== config.language) {
      // New names for the Discovery tab, texts in the new language.
      this.discovered = null;
      this.gladys.forgetPublishedStates?.();
    }
    if (config.invalidRepositories.length > 0) {
      logger.warn(`Repositories not understood: ${config.invalidRepositories.join(' ')}`);
    }
    // A read under way was made for the previous configuration.
    await this.polling?.catch(() => {});
    const signature = JSON.stringify([config.url, config.token]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.client = config.url
        ? new ForgeClient({ url: config.url, token: config.token, request: this.request })
        : null;
      this.entries = new Map();
      this.version = null;
      this.readAt = 0;
      this.error = null;
      this.polling = null;
      // Another forge: what was learnt about the previous one is worthless.
      if (config.url && this.saved.url && this.saved.url !== config.url) {
        this.saved = this.emptySaved();
      }
      if (config.url) {
        this.saved.url = config.url;
      }
    }
    try {
      if (this.client) {
        await this.pollNow({ publish: true });
      } else {
        await this.afterChanges(true, { publish: true });
      }
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.problems.recover('poll', 'Reading the forge works again');
      } catch (err) {
        this.problems.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Reading the forge -------------------------------------------------------

  /** Read the followed repositories now and publish what changed. */
  async pollNow({ publish = false } = {}) {
    const changed = await this.poll();
    await this.afterChanges(changed, { publish });
  }

  /** Read again when the last read is older than `freshMs`. */
  async refreshIfStale() {
    if (this.client && this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollNow();
    }
  }

  /**
   * Read the forge and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll() {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (!this.polling) {
      const polling = this.read(this.client, this.config.repositories).finally(() => {
        // A read of a previous client must not drop the promise of the current one.
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling;
  }

  async read(client, names) {
    let result;
    try {
      const version = await client.version();
      const entries = await mapLimited(names, 4, (name) => this.readRepository(client, name));
      result = { version, entries };
    } catch (err) {
      if (!(err instanceof ForgeError)) {
        throw err;
      }
      return client === this.client && this.applyFailure(err);
    }
    return client === this.client && this.applySuccess(result);
  }

  /**
   * One repository. An error of the whole forge is thrown; an error of this
   * repository only is kept in its entry, the others go on.
   */
  async readRepository(client, name) {
    const local = (err) => {
      if (!(err instanceof ForgeError) || GLOBAL_KINDS.has(err.kind)) {
        throw err;
      }
      return err;
    };
    let repo;
    try {
      repo = await client.repository(name);
    } catch (err) {
      return { name, error: local(err).kind };
    }
    const part = (promise, label) =>
      promise.catch((err) => {
        local(err);
        logger.debug(`${name}: ${label} unreadable: ${err.message}`);
        return null;
      });
    const branch = repo.defaultBranch;
    const [releases, issues, pulls, ci] = await Promise.all([
      part(client.releases(name, PAGE), 'releases'),
      part(client.issues(name, 'issues', PAGE), 'issues'),
      part(client.issues(name, 'pulls', PAGE), 'pull requests'),
      repo.empty || !branch
        ? { state: CI_STATES.NONE, sha: '' }
        : part(client.status(name, branch), 'CI status'),
    ]);
    return { name, repo, releases, issues, pulls, ci };
  }

  async applySuccess({ version, entries }) {
    let widgetChanged = this.error !== null || this.readAt === 0;
    if (this.error) {
      logger.info('The forge answers again');
    }
    if (version !== this.version) {
      logger.info(`Connected to ${forgeName(version)}`);
      this.version = version;
    }
    this.error = null;
    this.readAt = this.now();

    const failing = entries.filter((entry) => entry.error);
    if (failing.length > 0) {
      this.problems.fail(
        'repositories',
        `Unreadable: ${failing.map((entry) => `${entry.name} (${entry.error})`).join(', ')}`,
      );
    } else {
      this.problems.recover('repositories', 'Every repository is readable');
    }

    let dirty = false;
    const events = [];
    const next = new Map();
    const followed = new Set(this.config.repositories.map(key));
    for (const entry of entries) {
      if (!followed.has(key(entry.name))) {
        continue; // removed from the list while this read was under way
      }
      const previous = this.entries.get(key(entry.name));
      if (entry.error) {
        // The values last read stay shown (marked unreadable in the widget).
        next.set(key(entry.name), { ...previous, name: entry.name, error: entry.error });
        widgetChanged ||= previous?.error !== entry.error;
        continue;
      }
      const shown = {
        name: entry.name,
        repo: entry.repo,
        releases: entry.releases ?? previous?.releases ?? null,
        ci: entry.ci ?? previous?.ci ?? null,
        error: null,
      };
      next.set(key(entry.name), shown);
      if (JSON.stringify(widgetView(previous)) !== JSON.stringify(widgetView(shown))) {
        widgetChanged = true;
      }
      const { saved, found } = this.compare(entry);
      events.push(...found);
      const id = String(entry.repo.id);
      if (JSON.stringify(this.saved.repos[id]) !== JSON.stringify(saved)) {
        this.saved.repos[id] = saved;
        dirty = true;
      }
    }
    if (next.size !== this.entries.size) {
      widgetChanged = true;
    }
    this.entries = next;
    // Repositories no longer followed are forgotten (not while one of the
    // list was never read: its id is unknown).
    const read = [...next.values()];
    const kept = new Set(read.filter((entry) => entry.repo).map((entry) => String(entry.repo.id)));
    for (const id of Object.keys(this.saved.repos)) {
      if (!kept.has(id) && read.every((entry) => entry.repo)) {
        delete this.saved.repos[id];
        dirty = true;
      }
    }
    // Written only when something changed: no wear of the SD card at every read.
    // Saved before the events: a crash in between never announces one twice.
    if (dirty) {
      await this.store.save(this.saved);
    }
    await this.publishStates();
    for (const event of events) {
      await this.fire(event.key, event.data);
    }
    return widgetChanged;
  }

  /**
   * What is new in a repository since the last reading.
   * @returns {{ saved: object, found: Array<{ key: string, data: object }> }}
   */
  compare({ repo, releases, issues, pulls, ci }) {
    const before = this.saved.repos[String(repo.id)];
    const known = Boolean(before);
    const saved = {
      releases: before?.releases ?? [],
      issue: before?.issue ?? 0,
      pull: before?.pull ?? 0,
      ci: before?.ci ?? null,
    };
    const found = [];
    const device = repositoryIds(this.gladys, repo.id).device;
    const summary = SUMMARY_TEXT[this.config.language] ?? SUMMARY_TEXT.en;
    const common = { repository: device, repository_name: repo.fullName };

    if (releases) {
      const fresh = releases.filter((release) => !saved.releases.includes(release.id));
      if (known) {
        for (const release of fresh.slice(0, MAX_EVENTS).reverse()) {
          found.push({
            key: TRIGGERS.RELEASE,
            data: {
              ...common,
              release_type: release.prerelease ? 'prerelease' : 'stable',
              name: release.name,
              tag: release.tag,
              author: release.author,
              url: release.url,
              summary: summary.release(repo.fullName, release.tag),
            },
          });
        }
      }
      saved.releases = [...releases.map((release) => release.id), ...saved.releases]
        .filter((id, index, all) => all.indexOf(id) === index)
        .slice(0, SEEN_RELEASES);
    }

    for (const [list, field, trigger, text] of [
      [issues, 'issue', TRIGGERS.ISSUE, summary.issue],
      [pulls, 'pull', TRIGGERS.PULL, summary.pull],
    ]) {
      if (!list) {
        continue;
      }
      const fresh = list.filter((item) => item.number > saved[field]);
      if (known) {
        for (const item of fresh.slice(0, MAX_EVENTS).reverse()) {
          found.push({
            key: trigger,
            data: {
              ...common,
              number: item.number,
              title: item.title,
              author: item.author,
              url: item.url,
              summary: text(repo.fullName, item.number, item.title),
            },
          });
        }
      }
      // A repository without any issue yet stays at 0: its first issue counts.
      saved[field] = Math.max(saved[field], ...list.map((item) => item.number));
    }

    if (ci && (ci.state === CI_STATES.SUCCESS || ci.state === CI_STATES.FAILURE)) {
      const turned =
        ci.state === CI_STATES.FAILURE
          ? saved.ci !== CI_STATES.FAILURE
          : saved.ci === CI_STATES.FAILURE;
      if (known && turned) {
        found.push({
          key: TRIGGERS.CI,
          data: {
            ...common,
            state: ci.state,
            branch: repo.defaultBranch ?? '',
            sha: ci.sha,
            url: ci.sha && repo.url ? `${repo.url}/commit/${ci.sha}` : repo.url,
            summary: summary[ci.state](repo.fullName, repo.defaultBranch ?? ''),
          },
        });
      }
      saved.ci = ci.state;
    }
    return { saved, found };
  }

  async applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`Forge: ${err.message}`);
    }
    return wasError !== err.kind;
  }

  async fire(eventKey, data) {
    logger.info(`${data.repository_name}: ${eventKey}`);
    try {
      await this.gladys.publishSceneEvent(eventKey, data);
    } catch (err) {
      logger.warn(`Scene event ${eventKey} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------

  externalIdOf(repo) {
    return repositoryIds(this.gladys, repo.id).device;
  }

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  /** The entries read at least once, in the order of the configuration. */
  readEntries() {
    return this.config.repositories
      .map((name) => this.entries.get(key(name)))
      .filter((entry) => entry?.repo);
  }

  discoveredDevices() {
    if (!this.client || this.readAt === 0 || this.error) {
      return null; // nothing read: keep the list Gladys has
    }
    return this.readEntries().map((entry) =>
      buildRepositoryDevice(this.gladys, entry.repo, this.config.language),
    );
  }

  /** Publish the Discovery list when it changed (a repository added, renamed…). */
  async publishDevices({ force = false } = {}) {
    const devices = this.discoveredDevices() ?? (this.client ? null : []);
    if (devices === null) {
      return;
    }
    const signature = JSON.stringify(devices);
    if (!force && signature === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = signature;
      this.problems.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.problems.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the forge, publish the list again. */
  async rediscover() {
    await this.poll();
    await this.afterChanges(true, { publish: true });
  }

  /**
   * The user added (or updated) a device: its states sent before were dropped
   * by Gladys (the SDK forgets them: they go again).
   */
  async onDeviceCreated(device) {
    this.transports.delete(device.external_id);
    await this.publishStates();
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll, only if it polls anyway). */
  async pollDevice() {
    await this.refreshIfStale();
  }

  /**
   * The states of the added devices. The SDK skips the values Gladys already
   * has (and sends an unchanged one again after `heartbeatMs`).
   */
  async publishStates() {
    if (this.readAt === 0 || this.error) {
      return;
    }
    const states = [];
    for (const entry of this.readEntries()) {
      if (!entry.error && this.isCreated(repositoryIds(this.gladys, entry.repo.id).device)) {
        states.push(...repositoryValues(this.gladys, entry, this.config.language));
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.problems.recover('states', 'States accepted again');
    } catch (err) {
      this.problems.fail('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: local or cloud, or unreachable. */
  async publishTransports() {
    if (!this.client || this.readAt === 0) {
      return;
    }
    const reachable = transportOf(this.config.url);
    const entries = [];
    for (const entry of this.readEntries()) {
      const externalId = repositoryIds(this.gladys, entry.repo.id).device;
      const transport = this.error || entry.error ? DEVICE_TRANSPORTS.UNREACHABLE : reachable;
      if (this.isCreated(externalId) && this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.problems.recover('transports', 'Transports accepted again');
      } catch (err) {
        this.problems.fail('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (!this.config.urlTyped) {
      return { connected: false, message: CONNECTION_TEXT.noUrl };
    }
    if (!this.config.url) {
      return { connected: false, message: CONNECTION_TEXT.invalidUrl };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const signature = JSON.stringify(status);
    if (signature === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = signature;
      this.problems.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.problems.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands (scene action, widget, report) ---------------------------------

  /** Throws the reason the forge cannot answer, if any. */
  assertReadable(language = this.config.language) {
    const status = this.connectionStatus();
    if (!status.connected) {
      throw new Error(pick(status.message, language));
    }
  }

  /**
   * The entry of a followed repository, by device external id, read again
   * when the last read is old.
   */
  async entryOf(externalId, language = this.config.language) {
    const id = parseRepositoryId(this.gladys, externalId);
    const find = () => this.readEntries().find((entry) => entry.repo.id === id);
    if (!id || !find()) {
      throw new Error(pick(ACTION_TEXT.notFollowed, language));
    }
    await this.refreshIfStale();
    this.assertReadable(language);
    const entry = find();
    if (!entry) {
      throw new Error(pick(ACTION_TEXT.notFollowed, language));
    }
    if (entry.error) {
      throw new Error(`${entry.name}: ${pick(ERROR_TEXT[entry.error], language)}`);
    }
    return entry;
  }

  /** "Test the connection": the forge, its version, every repository read. */
  async testConnection() {
    await this.pollNow({ publish: true });
    const status = this.connectionStatus();
    if (!status.connected) {
      return status.message;
    }
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      const separator = language === 'fr' ? ' : ' : ': ';
      const head = [`${text.ok} (${hostOf(this.config.url)}, ${forgeName(this.version)})`];
      if (!this.config.token) {
        head.push(text.anonymous);
      }
      const lines = [head.join(' — ')];
      if (this.config.repositories.length === 0) {
        lines.push(text.none);
      }
      for (const name of this.config.repositories) {
        const entry = this.entries.get(key(name));
        if (!entry || entry.error) {
          lines.push(
            `${name}${separator}${pick(ERROR_TEXT[entry?.error ?? ERROR_KINDS.HTTP], language)}`,
          );
          continue;
        }
        const parts = [`★ ${entry.repo.stars} ${text.stars}`];
        if (entry.ci) {
          parts.push(`CI ${pick(CI_TEXT[entry.ci.state], language)}`);
        }
        lines.push(`${entry.repo.fullName}${separator}${parts.join(' · ')}`);
      }
      if (this.config.invalidRepositories.length > 0) {
        lines.push(text.invalid(this.config.invalidRepositories.join(' ')));
      }
      if (this.config.tooMany) {
        lines.push(text.tooMany(MAX_REPOSITORIES));
      }
      message[language] = lines.join('\n');
    }
    return message;
  }
}

/** What the widget shows of an entry: a change refreshes it. */
function widgetView(entry) {
  if (!entry?.repo) {
    return null;
  }
  const { repo, releases, ci, error } = entry;
  return [
    repo.fullName,
    repo.stars,
    repo.openIssues,
    repo.openPulls,
    releases?.[0]?.id,
    ci?.state,
    error,
  ];
}
