# Forgejo / Gitea for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that follows repositories of a [Forgejo](https://forgejo.org/) or
[Gitea](https://about.gitea.com/) forge — self-hosted, or public such as
[Codeberg](https://codeberg.org/): releases, issues, pull requests and CI
status, as devices, scene triggers and a dashboard widget. It mirrors the
[GitHub integration](https://github.com/William-De71/gladys-github) of
William-De71 for the free forges.

- **One device per followed repository**: stars, forks, open issues, open pull
  requests, latest release and its date, CI status and CI passing of the
  default branch.
- **Scene triggers**: new release published (release or pre-release), new
  issue, new pull request, CI failing or back to green.
- **Scene action**: read a repository, its figures as variables for the next
  actions.
- **Dashboard widget**: every repository at a glance, failing CI first.
- Public repositories without any token; private ones with a read-only token.
  The integration never writes to the forge.
- Texts in English, French, German and Spanish.

Tested against real Forgejo 11.0.16 and Gitea 1.27.3 instances (Docker,
SQLite: repositories, issues, pull requests, releases, drafts, commit statuses,
renames, bad tokens) and the public API of Codeberg. Not tested yet on a real
Gladys instance: feedback welcome on
[the issues](https://github.com/guim31/gladys-forgejo/issues).

## Requirements

- Gladys Assistant **5.1.0** or later.
- A Forgejo or Gitea reachable from Gladys, or codeberg.org.
- For private repositories: an access token with `read:repository` and
  `read:issue`.

## Installation

In Gladys: **Integrations → Install from GitHub**, address
`https://github.com/guim31/gladys-forgejo`. Then open its configuration: the
forge address, the token (optional), the repositories (`owner/name`), and
click **Test the connection**. Add the repositories from the **Discovery** tab.

The user documentation: [English](docs/en.md), [français](docs/fr.md),
[Deutsch](docs/de.md), [español](docs/es.md).

## How it works

Every 10 minutes by default (5 minutes to 1 hour), the container reads, for
each repository: the repository, its five newest releases, issues and pull
requests, and the combined commit status of its default branch (which Forgejo
Actions, Gitea Actions and external CIs report to). New items and CI
transitions become scene events; what was seen is kept in `/data`, so a
restart neither misses nor repeats an event. Five requests per repository and
reading: keep the list short on Codeberg, a free service.

## Limits

- Read-only; 20 repositories at most; the CI of the default branch only.
- An event arrives up to one refresh interval late.
- A self-signed certificate is refused: use the `http://` address on the local
  network.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests never touch the network: `test/helpers/fakeForge.js` answers like
Forgejo, from the real answers recorded in `test/fixtures/forgejo` and
`test/fixtures/gitea`.

## Credits

- [Forgejo](https://forgejo.org/) and [Gitea](https://about.gitea.com/), whose
  API this integration reads. The cover uses the Forgejo logo (CC BY-SA 4.0,
  [Forgejo project](https://codeberg.org/forgejo/governance/src/branch/main/branding))
  and the Gitea logo (MIT, [go-gitea/gitea](https://github.com/go-gitea/gitea)).
- The GitHub integration of [William-De71](https://github.com/William-De71/gladys-github),
  whose devices and trigger keys this one follows.

This project is not affiliated with Forgejo, Codeberg e.V., Gitea or
CommitGo.

## License

[Apache-2.0](LICENSE)
