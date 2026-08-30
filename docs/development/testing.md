# Testing

## Test Stack

- Vitest for unit and integration tests
- Playwright for end-to-end Milestone 2 plugin and MCP flows

## Commands

- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm test:e2e`
- `pnpm test`

## Milestone 2 Coverage

Milestone 2 section 14 is implemented across three layers:

| Layer | Location | Scope |
| --- | --- | --- |
| Unit | `packages/contracts/tests`, `packages/permission-engine/tests`, `packages/mcp-gateway/tests`, `packages/security/tests`, `packages/plugin-runtime/tests` | Manifest validation, permissions, tool risk policy, secret namespaces, runtime protocol |
| Integration | `apps/desktop-backend/tests`, `packages/plugin-registry/tests`, `packages/plugin-runtime/tests`, `packages/mcp-gateway/tests` | Plugin install/enable, MCP stdio lifecycle, tool execution/cancel, permission gates |
| Contract | `packages/testing/tests`, `packages/plugin-sdk/tests/contract.test.ts`, `packages/plugin-runtime/tests/contract.test.ts` | Shared fixtures for reference plugins and runtime RPC schemas |
| End-to-end | `apps/desktop/tests/milestone-2-plugins.e2e.ts` | Settings → plugin install → permissions → enable → MCP tools → tool console → disable |

Playwright E2E uses `scripts/start-e2e-desktop-env.mjs`, which boots the desktop backend and Vite with `VITE_E2E_BACKEND=true` so plugin management screens work outside Tauri.

See [milestone-2-testing-strategy.md](./milestone-2-testing-strategy.md) for the full requirement matrix.

## Expectations

- add focused tests for contracts, validation, migrations, and boundaries
- avoid low-value tests that only repeat implementation details
- keep Playwright flows stable by targeting bundled reference plugins and the E2E backend harness
