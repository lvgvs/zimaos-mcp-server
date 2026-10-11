# Contributing

Bug reports, focused fixes, regression tests, documentation improvements and translation
corrections are welcome. For a new capability or a significant API change, open an issue
to discuss the proposal before implementing it. Small, well-scoped pull requests are
easier to review in this security-sensitive project.

Read the [README](README.md) for supported capabilities and configuration, and the
[tool usage guide](docs/TOOL-USAGE.md) for detailed safety contracts. To report a
vulnerability, follow [SECURITY.md](SECURITY.md) rather than posting details publicly.

## Prerequisites and setup

- Git and npm.
- Node.js 22 LTS (22.13.0 or newer), or a supported newer LTS runtime. CI uses Node.js 22.
- Docker with the Compose plugin if your change affects container packaging or deployment.

Fork the repository on GitHub, then clone your fork and create a working branch.
Replace `YOUR_USERNAME` with your GitHub username:

```bash
git clone https://github.com/YOUR_USERNAME/zimaos-mcp-server.git
cd zimaos-mcp-server
git switch -c fix/your-change
npm ci --include=dev --no-audit --no-fund
```

Automated tests use mocks/fakes and local HTTP servers; they do not require a ZimaOS
device or credentials. To run the server against your own ZimaOS instance, follow the
README's configuration and local Docker instructions. Live integration testing is
separate from CI; only test mutations on a disposable system you are authorized to use.
Never commit credentials, bearer tokens, private environment files or sensitive logs.

## Development checks

Run these checks before submitting a change:

```bash
npm run format:check
npm run lint
npm run typecheck
npx tsc -p tsconfig.test.json --noEmit
npm test
npm run build
git diff --check
```

`npm run format` applies Prettier formatting; review its diff before committing.
`npm test` runs the Vitest suite, while the two TypeScript checks cover production and
test code separately. `npm run build` emits the production code into `dist/`.

For packaging or deployment changes, also run:

```bash
docker build -t zimaos-mcp-server:local .
docker compose -f deploy/zimaos/docker-compose.yml config --quiet
```

## API and security expectations

- Add regression tests for changed behavior, including invalid inputs and failure paths.
- Preserve MCP authentication, independent default-off mutation permissions, bounded outputs
  and secret-safe errors. Asynchronous acceptance must not be described as completion;
  ambiguous mutation outcomes must not be automatically retried.
- Use supported ZimaOS APIs. Do not introduce SSH control, arbitrary shell execution,
  Docker socket access, privileged runtime access or direct internal-file/database mutation.
- Cite current official ZimaSpace/IceWhaleTech API documentation or compatible licensed
  OpenAPI/SDK sources when changing upstream behavior. This is a clean-room implementation:
  do not copy, port, translate or derive code from `IceWhaleTech/ZimaOS-MCP`, whose reuse
  license is unclear. New dependencies must have compatible licenses.
- Treat MCP tool names, input/output schemas, permissions and error semantics as public
  contracts. Explain compatibility implications in the PR rather than silently changing them.

## Documentation

Update relevant user, contributor or security guidance in the same PR as the behavior it
describes. If either README changes, update **both** [README.md](README.md) and
[README.tr.md](README.tr.md), keeping their structure, examples, warnings and technical
meaning equivalent. Keep paired tool-usage documents consistent when changing their contracts.
Keep the Tool Reference complete and preserve the prominent AI-development disclosure.

Read the rendered documentation as its intended audience, not just as Markdown source.
Check links, stale release/lifecycle claims and contradictions; keep internal development
instructions out of user and contributor guidance. Clearly label historical references.

## Submitting a pull request

Commit your focused change on a feature/fix/docs branch and push it to your fork. Use a
descriptive commit message, such as `fix: reject invalid input` or `docs: clarify setup`.
Open a pull request targeting `main`; do not push changes directly to `main`.

Explain the problem, approach, compatibility implications and checks you actually ran.
Include reproduction steps for bugs, without credentials or private system details.
Keep your branch up to date with `main` when requested and address review conversations.
All required CI checks must pass on the latest revision before merge. Maintainers merge
using **Squash only**, without bypassing checks or unresolved conversations.
