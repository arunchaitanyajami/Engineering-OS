# Milestone 2 Testing Strategy

This document maps Milestone 2 section 14 requirements to the repository test suites.

## Unit Tests

| Requirement                  | Primary suite                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------- |
| Manifest validation          | `packages/contracts/tests/contracts.test.ts`                                      |
| Compatibility checks         | `packages/plugin-registry/tests/plugin-registry.test.ts`                          |
| Permission resolution        | `packages/permission-engine/tests/permission-engine.test.ts`                      |
| Tool risk policy             | `packages/permission-engine/tests/tool-safety.test.ts`                            |
| Error normalization          | `packages/mcp-gateway/tests/mcp-gateway.test.ts`                                  |
| Capability mapping           | `packages/mcp-gateway/tests/mcp-gateway.test.ts`                                  |
| Secret namespace enforcement | `packages/security/tests/*.test.ts`, `packages/contracts/tests/contracts.test.ts` |
| Lifecycle state transitions  | `packages/plugin-runtime/tests/plugin-runtime.test.ts`                            |

## Integration Tests

| Requirement                         | Primary suite                                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Install and enable plugin           | `apps/desktop-backend/tests/reference-plugins.integration.test.ts`                                                   |
| Reject invalid manifest             | `packages/plugin-registry/tests/plugin-registry.test.ts`, `apps/desktop-backend/tests/server.integration.test.ts`    |
| Reject incompatible plugin          | `packages/plugin-registry/tests/plugin-registry.test.ts`, `apps/desktop-backend/tests/server.integration.test.ts`    |
| Launch MCP server over stdio        | `packages/mcp-gateway/tests/mcp-gateway.test.ts`, `apps/desktop-backend/tests/server.integration.test.ts`            |
| Discover tools                      | `packages/mcp-gateway/tests/mcp-gateway.test.ts`, `apps/desktop-backend/tests/reference-plugins.integration.test.ts` |
| Execute tool                        | `packages/mcp-gateway/tests/mcp-gateway.test.ts`, `apps/desktop-backend/tests/server.integration.test.ts`            |
| Cancel tool execution               | `packages/mcp-gateway/tests/mcp-gateway.test.ts`, `apps/desktop-backend/tests/server.integration.test.ts`            |
| Detect startup timeout              | `packages/mcp-gateway/tests/mcp-gateway.test.ts`                                                                     |
| Handle process crash                | `packages/mcp-gateway/tests/mcp-gateway.test.ts`, `packages/plugin-runtime/tests/plugin-runtime.test.ts`             |
| Disable plugin while running        | `apps/desktop-backend/tests/plugin-lifecycle-service.integration.test.ts`                                            |
| Revoke plugin permission            | `packages/permission-engine/tests/permission-engine.test.ts`                                                         |
| Prevent unauthorized capability use | `apps/desktop-backend/tests/server.integration.test.ts` (`requires permission grants before enabling MCP plugins`)   |

## End-to-End Tests

Playwright flow: `apps/desktop/tests/milestone-2-plugins.e2e.ts`

1. Open plugin settings
2. Install the bundled example MCP plugin
3. Review requested permissions
4. Enable it
5. Verify health status
6. Open the MCP server page
7. Inspect discovered tools
8. Execute a safe tool
9. Disable the plugin
10. Verify its capabilities disappear

Harness: `scripts/start-e2e-desktop-env.mjs`

## Contract Tests

Shared fixtures live in `@engineering-os/testing`:

- `readReferencePluginManifest()`
- `createInitializePluginRequestFixture()`
- `createActivatePluginRequestFixture()`

Consumers:

- `packages/testing/tests/contract-fixtures.test.ts`
- `packages/plugin-sdk/tests/contract.test.ts`
- `packages/plugin-runtime/tests/contract.test.ts`

These tests keep plugin SDK exports and runtime RPC schemas aligned with the bundled reference plugins as contracts evolve.
