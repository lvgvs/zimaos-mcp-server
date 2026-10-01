# Contributing

Thanks for your interest in `zimaos-mcp-server`.

This project is security-sensitive and uses a clean-room implementation policy, so small, well-scoped changes with clear tests are preferred.

## Before opening a pull request

- Read [README.md](README.md), [PROJECT.md](PROJECT.md), and [AGENTS.md](AGENTS.md).
- For behavior that depends on ZimaOS APIs, prefer current official ZimaSpace/IceWhaleTech documentation and compatible official OpenAPI/SDK sources.
- Do not copy, port, translate, or derive implementation code from the historical `IceWhaleTech/ZimaOS-MCP` repository unless its reuse status is explicitly re-evaluated and approved.
- Do not add SSH, arbitrary shell execution, Docker socket access, privileged runtime access, direct ZimaOS internal-file/database mutation, or undocumented control-plane APIs.
- Keep changes focused. New capability families require explicit project-scope approval.

## Development setup

Requires Node.js 22 or newer.

```bash
npm ci --no-audit --no-fund
npm run format:check
npm run lint
npm run typecheck
npx tsc -p tsconfig.test.json --noEmit
npm test
npm run build
docker build -t zimaos-mcp-server:local .
docker compose -f deploy/zimaos/docker-compose.yml config --quiet
```

Live ZimaOS integration testing uses local secret material and is intentionally separate from CI. Never add real credentials, tokens, or private environment files to a commit.

## Pull requests

A pull request should:

- explain the problem and the chosen approach;
- add or update tests for changed behavior;
- preserve default-off mutation permissions and secret-redaction behavior;
- keep public documentation accurate;
- pass CI before merge.

If either public README changes, update **both** [README.md](README.md) and [README.tr.md](README.tr.md) in the same change and keep their meaning equivalent.

## Security issues

Do not open a public issue containing vulnerability details. Follow [SECURITY.md](SECURITY.md).
