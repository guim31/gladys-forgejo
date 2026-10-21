// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, CI states, the "Test the connection" report,
// scene summaries, dates. Four languages, the four of the Gladys interface;
// German says "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { CI_STATES, ERROR_KINDS } from './forge/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your Forgejo or Gitea (or codeberg.org) in the configuration.',
    fr: "Saisissez l'adresse de votre Forgejo ou Gitea (ou codeberg.org) dans la configuration.",
    de: 'Gib die Adresse deines Forgejo oder Gitea (oder codeberg.org) in der Konfiguration ein.',
    es: 'Introduzca la dirección de su Forgejo o Gitea (o codeberg.org) en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.2:3000 or codeberg.org',
    fr: 'Adresse incomprise, ex. http://192.168.1.2:3000 ou codeberg.org',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.2:3000 oder codeberg.org',
    es: 'Dirección no válida, p. ej. http://192.168.1.2:3000 o codeberg.org',
  },
};

// One short explanation per error kind (src/forge/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'the forge does not answer',
    fr: 'la forge ne répond pas',
    de: 'die Forge antwortet nicht',
    es: 'la forja no responde',
  },
  [ERROR_KINDS.TIMEOUT]: {
    en: 'the forge did not answer in time',
    fr: "la forge n'a pas répondu à temps",
    de: 'die Forge hat nicht rechtzeitig geantwortet',
    es: 'la forja no ha respondido a tiempo',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: use an http:// address or a trusted certificate',
    fr: 'certificat refusé : utilisez une adresse http:// ou un certificat reconnu',
    de: 'Zertifikat abgelehnt: Nutze eine http://-Adresse oder ein vertrauenswürdiges Zertifikat',
    es: 'certificado rechazado: use una dirección http:// o un certificado reconocido',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'access token refused: create a new one (Settings → Applications)',
    fr: "jeton d'accès refusé : créez-en un nouveau (Configuration → Applications)",
    de: 'Zugriffstoken abgelehnt: Erstelle ein neues (Einstellungen → Anwendungen)',
    es: 'token de acceso rechazado: cree uno nuevo (Configuración → Aplicaciones)',
  },
  [ERROR_KINDS.NOT_FORGE]: {
    en: 'no Forgejo or Gitea API at this address',
    fr: 'aucune API Forgejo ou Gitea à cette adresse',
    de: 'keine Forgejo- oder Gitea-API unter dieser Adresse',
    es: 'no hay ninguna API de Forgejo o Gitea en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.RATE_LIMITED]: {
    en: 'too many requests: choose a longer refresh interval',
    fr: "trop de requêtes : choisissez un intervalle d'actualisation plus long",
    de: 'zu viele Anfragen: Wähle ein längeres Aktualisierungsintervall',
    es: 'demasiadas solicitudes: elija un intervalo de actualización más largo',
  },
  [ERROR_KINDS.NOT_FOUND]: {
    en: 'repository not found, or private without a token that can read it',
    fr: 'dépôt introuvable, ou privé sans jeton capable de le lire',
    de: 'Repository nicht gefunden, oder privat ohne Token, das es lesen darf',
    es: 'repositorio no encontrado, o privado sin un token que pueda leerlo',
  },
  [ERROR_KINDS.MOVED]: {
    en: 'repository renamed or transferred: update its name in the configuration',
    fr: 'dépôt renommé ou transféré : corrigez son nom dans la configuration',
    de: 'Repository umbenannt oder übertragen: Passe seinen Namen in der Konfiguration an',
    es: 'repositorio renombrado o transferido: corrija su nombre en la configuración',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The CI state of the default branch, in words.
export const CI_TEXT = {
  [CI_STATES.SUCCESS]: { en: 'Passing', fr: 'Réussie', de: 'Erfolgreich', es: 'Correcta' },
  [CI_STATES.FAILURE]: { en: 'Failing', fr: 'En échec', de: 'Fehlgeschlagen', es: 'Fallida' },
  [CI_STATES.PENDING]: { en: 'Running', fr: 'En cours', de: 'Läuft', es: 'En curso' },
  [CI_STATES.NONE]: { en: 'No CI', fr: 'Pas de CI', de: 'Keine CI', es: 'Sin CI' },
};

export const NO_RELEASE = {
  en: 'No release',
  fr: 'Aucune version',
  de: 'Kein Release',
  es: 'Ninguna versión',
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'Connected',
    anonymous: 'without a token: public repositories only',
    none: 'No repository to follow yet: type owner/name in the configuration.',
    stars: 'stars',
    invalid: (parts) => `Not understood in the list: ${parts}`,
    tooMany: (max) => `Only the first ${max} repositories are followed.`,
  },
  fr: {
    ok: 'Connecté',
    anonymous: 'sans jeton : dépôts publics seulement',
    none: 'Aucun dépôt suivi : saisissez propriétaire/nom dans la configuration.',
    stars: 'étoiles',
    invalid: (parts) => `Incompris dans la liste : ${parts}`,
    tooMany: (max) => `Seuls les ${max} premiers dépôts sont suivis.`,
  },
  de: {
    ok: 'Verbunden',
    anonymous: 'ohne Token: nur öffentliche Repositorys',
    none: 'Noch kein Repository verfolgt: Gib Besitzer/Name in der Konfiguration ein.',
    stars: 'Sterne',
    invalid: (parts) => `In der Liste nicht verstanden: ${parts}`,
    tooMany: (max) => `Nur die ersten ${max} Repositorys werden verfolgt.`,
  },
  es: {
    ok: 'Conectado',
    anonymous: 'sin token: solo repositorios públicos',
    none: 'Ningún repositorio seguido: escriba propietario/nombre en la configuración.',
    stars: 'estrellas',
    invalid: (parts) => `No entendido en la lista: ${parts}`,
    tooMany: (max) => `Solo se siguen los ${max} primeros repositorios.`,
  },
};

// Errors of the scene action (shown in Gladys).
export const ACTION_TEXT = {
  notFollowed: {
    en: 'This repository is not in the list of the configuration.',
    fr: "Ce dépôt n'est pas dans la liste de la configuration.",
    de: 'Dieses Repository steht nicht in der Liste der Konfiguration.',
    es: 'Este repositorio no está en la lista de la configuración.',
  },
  refreshed: {
    en: 'Repositories read again.',
    fr: 'Dépôts relus.',
    de: 'Repositorys neu gelesen.',
    es: 'Repositorios leídos de nuevo.',
  },
};

// The `summary` variable of the scene events: ready for a message.
export const SUMMARY_TEXT = {
  en: {
    release: (repo, tag) => `New release of ${repo}: ${tag}`,
    issue: (repo, number, title) => `New issue in ${repo} #${number}: ${title}`,
    pull: (repo, number, title) => `New pull request in ${repo} #${number}: ${title}`,
    failure: (repo, branch) => `The CI of ${repo} (${branch}) is failing`,
    success: (repo, branch) => `The CI of ${repo} (${branch}) is passing again`,
  },
  fr: {
    release: (repo, tag) => `Nouvelle version de ${repo} : ${tag}`,
    issue: (repo, number, title) => `Nouveau ticket sur ${repo} #${number} : ${title}`,
    pull: (repo, number, title) => `Nouvelle demande de fusion sur ${repo} #${number} : ${title}`,
    failure: (repo, branch) => `La CI de ${repo} (${branch}) est en échec`,
    success: (repo, branch) => `La CI de ${repo} (${branch}) est revenue au vert`,
  },
  de: {
    release: (repo, tag) => `Neues Release von ${repo}: ${tag}`,
    issue: (repo, number, title) => `Neues Issue in ${repo} #${number}: ${title}`,
    pull: (repo, number, title) => `Neuer Pull-Request in ${repo} #${number}: ${title}`,
    failure: (repo, branch) => `Die CI von ${repo} (${branch}) schlägt fehl`,
    success: (repo, branch) => `Die CI von ${repo} (${branch}) ist wieder grün`,
  },
  es: {
    release: (repo, tag) => `Nueva versión de ${repo}: ${tag}`,
    issue: (repo, number, title) => `Nueva incidencia en ${repo} #${number}: ${title}`,
    pull: (repo, number, title) => `Nueva pull request en ${repo} #${number}: ${title}`,
    failure: (repo, branch) => `La CI de ${repo} (${branch}) está fallando`,
    success: (repo, branch) => `La CI de ${repo} (${branch}) vuelve a estar en verde`,
  },
};

export const LANGUAGE_FALLBACK = 'en';

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };
const formats = new Map();

/** A date as day/month/year, in the time zone of Gladys (the supervisor injects TZ). */
export function formatDate(time, language) {
  const locale = LOCALES[language] ?? LOCALES.en;
  if (!formats.has(locale)) {
    formats.set(
      locale,
      new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }),
    );
  }
  return formats.get(locale).format(new Date(time));
}

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
