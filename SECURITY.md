# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- the optional **access token** of the forge, stored by Gladys in the
  integration configuration (never written to `/data`, never logged); it is
  only sent, in the `Authorization` header, to the configured address, and
  redirects are not followed so it never reaches another host. A read-only
  token (`read:repository`, `read:issue`) is enough: the integration never
  writes to the forge;
- what is read from the forge: figures of the followed repositories, titles
  and authors of their newest issues, pull requests and releases, the combined
  CI state of the default branch — never the code, the bodies nor the
  attachments;
- `/data/forgejo-state.json`: for each followed repository, the release ids,
  the highest issue and pull request numbers and the last CI result seen, and
  the address of the forge;
- network: HTTP(S) requests to the forge address, nothing else; no port is
  opened.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and Forgejo or Gitea themselves.
