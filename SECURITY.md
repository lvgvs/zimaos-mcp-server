# Security Policy

## Supported versions

This project is currently pre-release. Until the first tagged release is published, security fixes target the current development line on `main` and the current release-candidate image.

After tagged releases begin, this section will be updated to state which release lines receive security fixes.

## Reporting a vulnerability

Please do **not** publish exploit details, credentials, tokens, private Compose contents, or other sensitive material in a public issue.

When the repository is public, use GitHub's private vulnerability reporting flow from the repository **Security** tab if it is available.

If private vulnerability reporting is not available, open a minimal public issue asking the maintainer for a private reporting channel. Do not include exploit details in that issue.

A useful private report includes:

- affected version, tag, or commit;
- affected MCP tool or endpoint;
- reproduction steps;
- expected and observed behavior;
- security impact;
- whether the issue can expose ZimaOS credentials, MCP auth tokens, app secrets, host access, or unsafe mutation;
- any suggested mitigation.

## Scope notes

This server can perform privileged homelab operations through supported ZimaOS APIs, so authentication, permission boundaries, secret handling, Compose safety analysis, and mutation retry behavior are security-sensitive.

Known documented limitations are not automatically vulnerabilities, but reports showing that a limitation can bypass an intended security boundary are welcome.

See [README.md](README.md) and [PROJECT.md](PROJECT.md) for the documented security model and product boundary.
