// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `repositories`.
//
// The use case: from the wall tablet, see at a glance whether the CI of the
// followed repositories passes, their latest release and how many issues wait.
// One row per repository — failing ones first, then the running ones — and a
// Refresh button.
//
// Every followed repository by default, or the ones chosen in the widget
// settings (devices added to Gladys). The figures are sent as values, not
// bound to device features: the widget works before the devices are added.
//
// Budget (8 components, 2 texts): one text when the forge does not answer,
// one status list, the Refresh button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { shownRelease } from './devices.js';
import { CI_STATES } from './forge/client.js';
import { WIDGET_KEY } from './hub.js';
import { ACTION_TEXT, CI_TEXT, CONNECTION_TEXT, ERROR_TEXT, pick } from './texts.js';

export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 10;

export const TEXT = {
  empty: {
    en: 'No repository followed: type owner/name in the configuration of the integration.',
    fr: "Aucun dépôt suivi : saisissez propriétaire/nom dans la configuration de l'intégration.",
    de: 'Kein Repository verfolgt: Gib Besitzer/Name in der Konfiguration der Integration ein.',
    es: 'Ningún repositorio seguido: escriba propietario/nombre en la configuración de la integración.',
  },
  issues: { en: 'issues', fr: 'tickets', de: 'Issues', es: 'incidencias' },
  unreadable: { en: 'Unreadable', fr: 'Illisible', de: 'Nicht lesbar', es: 'Ilegible' },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otros' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
};

const ROW_STYLE = {
  [CI_STATES.FAILURE]: { icon: 'x-circle', color: WIDGET_COLORS.DANGER },
  [CI_STATES.PENDING]: { icon: 'clock', color: WIDGET_COLORS.INFO },
  [CI_STATES.SUCCESS]: { icon: 'check-circle', color: WIDGET_COLORS.SUCCESS },
  [CI_STATES.NONE]: { icon: 'git-branch', color: WIDGET_COLORS.NEUTRAL },
};
const ERROR_STYLE = { icon: 'alert-triangle', color: WIDGET_COLORS.WARNING };

// Row order: what needs attention first.
const RANK = { [CI_STATES.FAILURE]: 0, [CI_STATES.PENDING]: 1 };
const rank = (entry) => (entry.error ? 0 : (RANK[entry.ci?.state] ?? 2));

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
  };
}

/** The repositories the widget shows: the chosen devices, or every followed one. */
export function selectEntries(hub, settings) {
  const chosen = [settings?.repositories ?? []].flat().filter((id) => typeof id === 'string' && id);
  const all = hub.readEntries();
  if (chosen.length === 0) {
    return all;
  }
  const ids = new Set(chosen);
  return all.filter((entry) => ids.has(hub.externalIdOf(entry.repo)));
}

export function sortEntries(entries) {
  return [...entries].sort(
    (a, b) => rank(a) - rank(b) || a.repo.fullName.localeCompare(b.repo.fullName),
  );
}

function rowOf(entry, language) {
  if (entry.error) {
    return { value: pick(TEXT.unreadable, language), ...ERROR_STYLE };
  }
  const state = entry.ci?.state ?? CI_STATES.NONE;
  const parts = [];
  if (entry.ci) {
    parts.push(pick(CI_TEXT[state], language));
  }
  const release = entry.releases ? shownRelease(entry.releases) : null;
  if (release) {
    parts.push(release.tag);
  }
  parts.push(`${entry.repo.openIssues} ${pick(TEXT.issues, language)}`);
  return { value: parts.join(' · '), ...ROW_STYLE[state] };
}

async function get(hub, { settings, language = 'en' }) {
  const status = hub.connectionStatus();
  if (!hub.client) {
    return message(status.message ?? CONNECTION_TEXT.noUrl, language);
  }
  if (hub.config.repositories.length === 0) {
    return message(TEXT.empty, language);
  }
  const entries = sortEntries(selectEntries(hub, settings));
  const components = [];
  if (hub.error) {
    components.push({
      type: 'text',
      variant: 'body',
      text: pick(ERROR_TEXT[hub.error.kind], language),
    });
  }
  if (entries.length > 0) {
    const shown = entries.length > MAX_ROWS ? entries.slice(0, MAX_ROWS - 1) : entries;
    const items = shown.map((entry) => {
      const row = rowOf(entry, language);
      return { label: fit(entry.repo.fullName, 40), ...row, value: fit(row.value, 40) };
    });
    if (entries.length > shown.length) {
      items.push({
        label: pick(TEXT.more, language),
        value: `+${entries.length - shown.length}`,
        icon: 'more-horizontal',
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
    components.push({ type: 'status', items });
  }
  components.push({
    type: 'button',
    label: pick(TEXT.refresh, language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.REFRESH },
  });
  // A CI running moves: look again sooner.
  const moving = hub.error || entries.some((entry) => entry.ci?.state === CI_STATES.PENDING);
  return { ttl_seconds: moving ? 60 : 300, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.pollNow();
  return { message: hub.error ? ERROR_TEXT[hub.error.kind] : ACTION_TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
