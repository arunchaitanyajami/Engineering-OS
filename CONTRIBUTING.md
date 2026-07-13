# Contributing

## Goals

- preserve desktop-first architecture
- maintain plugin-first and MCP-first boundaries
- keep model providers swappable
- document significant decisions with ADRs
- prefer maintainable, typed, testable code

## Workflow

1. Open an issue or write a short proposal for non-trivial changes.
2. Align the change with the current milestone.
3. Update documentation when architecture or behavior changes.
4. Add focused tests when the change introduces meaningful regression risk.
5. Keep changes scoped and reviewable.

## Standards

- TypeScript strict mode is required.
- Avoid hardcoding external providers or connector logic into agents.
- UI code must not access SQLite, secrets, MCP servers, or provider SDKs directly.
- Dangerous actions must require explicit approval.
- Secrets must never be committed to source control.
- Prefer reusable packages over feature-local duplication.

## Pull Requests

- Run `pnpm check` before opening a pull request.
- Run `pnpm test:e2e` for desktop shell changes.
- Update documentation when architecture, tooling, or contracts change.
- Include ADR updates when a foundational decision changes.
- Explain milestone alignment, risks, and follow-up work in the PR description.

## Commit Expectations

- Keep commits small and descriptive.
- Use conventional commit prefixes when practical, such as `feat:`, `fix:`, `docs:`, or `chore:`.
- Do not bundle unrelated refactors with milestone work.
- Call out architectural tradeoffs in pull requests.

## Release Strategy

- Use Changesets for workspace versioning and release notes once publishable packages are introduced.
- Keep internal-only foundation packages private until the plugin SDK and public interfaces stabilize.
