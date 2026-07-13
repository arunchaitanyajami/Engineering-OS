# Engineering OS

Engineering OS is a desktop-first, local-first, AI-native engineering platform that helps software engineers move faster across code, tickets, docs, incidents, and enterprise knowledge.

## Mission

One Engineer. Infinite Capability.

## Principles

- Desktop first. The primary product is the Tauri desktop application.
- Local first. Secrets, memory, and indexed context stay local unless explicitly shared.
- Plugin first. Every connector is independently installable, removable, and testable.
- MCP first. Integrations should prefer MCP as the standard interaction layer.
- Agent based. Specialized agents own specific engineering responsibilities.
- Workflow based. Reusable engineering flows are first-class product features.
- Model agnostic. Providers must remain swappable behind a stable abstraction.

## Milestone 0

Milestone 0 locks the platform foundation. It establishes the monorepo, shared TypeScript standards, configuration loading, structured logging, SQLite migrations, security contracts, internal events, testing, CI gates, ADRs, and contributor documentation.

Milestone 0 explicitly does not implement GitHub, Jira, Confluence, AI chat, workflow execution, enterprise connectors, or production agents.

## Monorepo Layout

```text
apps/
  desktop/
  cli/
packages/
  core/
  shared/
  config/
  logger/
  database/
  security/
  events/
  ui/
  testing/
  tsconfig/
plugins/
agents/
workflows/
docs/
```

## Getting Started

1. Install Node.js 20+ and pnpm 10+.
2. Run `pnpm install`.
3. Run `pnpm check`.
4. Start the Tauri desktop shell with `pnpm dev`.
5. Start the browser-only shell with `pnpm dev:web` when you only need the React layer.
6. Inspect CLI help with `pnpm dev:cli`.

See [local setup](docs/development/setup.md) for local setup details.

## Common Commands

- `pnpm dev`: start the Tauri desktop shell
- `pnpm dev:web`: start the browser shell only
- `pnpm build`: validate workspace builds
- `pnpm lint`: run ESLint across workspaces
- `pnpm typecheck`: run strict TypeScript checks
- `pnpm test`: run unit and integration tests
- `pnpm test:e2e`: run Playwright smoke tests
- `pnpm check`: run the mandatory local quality gates

## Docs

- [Architecture overview](docs/architecture/overview.md)
- [System context](docs/architecture/system-context.md)
- [Container architecture](docs/architecture/container-architecture.md)
- [Dependency rules](docs/architecture/dependency-rules.md)
- [Security model](docs/security/security-model.md)
- [Milestones](docs/roadmap/milestones.md)

## Current MVP Target

The first usable proof point is:

1. Open the desktop app.
2. Connect GitHub.
3. Ask `Review PR 123`.
4. Fetch PR metadata and diff.
5. Return a structured PR review with bugs, risks, security, performance, and test guidance.
