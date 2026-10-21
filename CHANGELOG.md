# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- One device per followed Forgejo, Gitea or Codeberg repository: stars, forks,
  open issues, open pull requests, latest release and its date, CI status and
  CI passing of the default branch.
- Repositories typed as `owner/name` or copied links, 20 at most; an optional
  read-only access token for private repositories.
- Scene triggers: new release published (filter on release or pre-release),
  new issue, new pull request, CI failing or back to green.
- Scene action: read a repository (its figures as variables).
- Dashboard widget: CI status, latest release and open issues of every
  repository, failing ones first, with a Refresh button.
- "Test the connection" shows the forge, its version and every repository.
- Texts and documentation in English, French, German and Spanish.
