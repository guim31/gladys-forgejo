# Forgejo / Gitea

[Forgejo](https://forgejo.org/) and [Gitea](https://about.gitea.com/) are free,
self-hosted software forges with the same API; [Codeberg](https://codeberg.org/)
runs Forgejo. This integration follows the repositories you list: each one
becomes a device with its stars, open issues and pull requests, latest release
and the CI status of its main branch. Scenes can react to a **new release**, a
**new issue**, a **new pull request**, or a CI that **fails or goes back to
green**, and a dashboard widget shows every repository at a glance.

Tested against real Forgejo 11.0 and Gitea 1.27 instances (Docker, SQLite), and
the public API of Codeberg; not against a real Gladys instance yet: feedback
welcome on [the issues](https://github.com/guim31/gladys-forgejo/issues).

## What you need

- Gladys Assistant 5.1.0 or later.
- A Forgejo or Gitea reachable from the Gladys machine, or a public forge such
  as codeberg.org.
- For private repositories only: an access token of a user who can read them.

The integration only reads: it never writes anything to the forge. At each
refresh (10 minutes by default) it makes five requests per repository: the
repository, its five newest releases, issues and pull requests, and the CI
status of its default branch. On Codeberg, please keep the refresh interval at
10 minutes or more and the list short: it is a free service run by a
non-profit, and too many requests get an "HTTP 429" answer.

## Getting started

### 1. Create an access token (private repositories)

Public repositories need no token. For private ones, in the forge open
**Settings → Applications → Generate new token**, give it a name and the
read-only permissions **read:repository** and **read:issue**, then copy it. The
token sees what its user sees: a dedicated user limits it further.

### 2. Configure the integration

In Gladys, open **Integrations → Forgejo / Gitea → Configuration** and fill in:

- **Forge address**: the address you open the forge with,
  `http://192.168.1.2:3000`, `https://git.example.com`, or `codeberg.org`
  (HTTPS is used for a name without a port).
- **Access token (optional)**: the token of step 1.
- **Repositories to follow**: `owner/name` or links copied from the browser,
  separated by commas, 20 at most. Example: `forgejo/forgejo, me/my-app`.
- **Refresh interval** and **Language of the names**.

Click **Test the connection**: the forge and its version, then each repository
with its stars and CI status, or the reason it cannot be read.

### 3. Add the devices

In **Discovery**, add the repositories you want as devices. The figures arrive
at once. The scene triggers and the widget work even for a repository not added
as a device.

## The devices

One device per repository, named `owner/name`, identified by the number the
forge gives the repository: renaming or transferring it keeps the device (type
the new name in the configuration).

| Feature             | Type    | Value                                                     |
| ------------------- | ------- | --------------------------------------------------------- |
| Stars               | counter | stars of the repository                                   |
| Forks               | counter | forks                                                     |
| Open issues         | counter | open issues (pull requests apart)                         |
| Open pull requests  | counter | open pull requests                                        |
| Latest release      | text    | tag of the latest release, else of the latest pre-release |
| Latest release date | text    | its publication date                                      |
| CI status           | text    | Passing, Failing, Running or No CI                        |
| CI passing          | binary  | 1 when the CI passes, 0 when it fails                     |

The CI status is the combined status of the latest commit of the default
branch: every check posted on it, Forgejo Actions and Gitea Actions included,
as well as Woodpecker, Drone or Jenkins when they report to the forge. A
"warning" counts as passing. While the CI runs, **CI passing** keeps its last
value.

## Dashboard

The **Repositories** widget shows one row per repository: the CI state, the
latest release and the number of open issues, failing repositories first, then
the running ones. Choose some repositories in its settings, or leave it empty
for all. **Refresh** reads the forge again at once.

## Scenes

### Triggers

- **New release published**: a release or a pre-release is out (filter on the
  repository and the type). Variables: the repository, the release name, its
  tag, its author, its link and a summary ready for a message.
- **New issue**: someone opened an issue. Variables: the repository, the
  number, the title, the author, the link and a summary.
- **New pull request**: someone opened a pull request. Same variables.
- **CI failing or back to green**: the CI of the default branch starts failing,
  or passes again after a failure (filter on the state). Variables: the
  repository, the branch, the commit, the link and a summary.

The first reading of a repository only learns its state: the past is never
announced. Drafts are never announced. At most three events of a kind are sent
per repository and reading (a burst of imported issues does not flood the
scenes). What was seen is kept in the integration, so a restart neither misses
an event nor announces one twice.

### Actions

- **Read a repository**: the figures of a followed repository as variables for
  the next actions: stars, forks, open issues and pull requests, latest
  release, CI status, CI passing.

### Scene ideas

- **New release published** of a project you self-host → send a message with
  its summary: time to update.
- **CI failing or back to green**, state "failing" → turn the office lamp red;
  state "back to green" → turn it back to white.
- Every Monday morning → **Read a repository**, then send yourself a message
  with its open issues and pull requests.

## Troubleshooting

- **The forge does not answer**: check the address from the Gladys machine
  (same port, same protocol); a Docker Gladys reaches the host by its IP
  address, not `localhost`.
- **The address redirects**: type the `https://` address the browser ends on.
- **Access token refused**: the token was deleted or mistyped; create a new
  one.
- **Repository not found, or private without a token that can read it**:
  check `owner/name`, and the permissions of the token (read:repository).
- **Repository renamed or transferred**: type its new name; the device stays.
- **Too many requests**: choose a longer refresh interval or follow fewer
  repositories.
- The issue and pull request triggers never fire on a private repository
  while its figures are right: the token lacks **read:issue**.
- **Certificate refused**: a self-signed certificate is not accepted; use the
  `http://` address on the local network.

## Limits

- Read-only: no command, nothing is written to the forge.
- 20 repositories at most, read every 5 minutes at the most often: an event
  arrives up to one interval late.
- The CI of the default branch only; one CI result per commit (the combined
  status), not one per workflow.
- Issues and pull requests are detected by their number: one deleted and
  recreated is not seen twice.
- The texts of devices and scenes follow the language of the configuration;
  feature names are set when a device is added.
- Developed and tested against Forgejo 11.0 and Gitea 1.27; older versions
  with the same API v1 should work, without a guarantee.
