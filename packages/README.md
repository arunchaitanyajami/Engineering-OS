# Packages

Shared runtime, SDK, and platform packages live here.

## Milestone 2 layout

Milestone 2 introduces plugin and MCP packages alongside the Milestone 0 foundation.

```text
packages/
  core/
  contracts/
  plugin-sdk/
  plugin-runtime/
  plugin-registry/
  mcp-gateway/
  mcp-client/
  capability-catalog/
  permission-engine/
  security/          # secure-storage responsibilities
  observability/
  testing/           # test-utils responsibilities
  database/
  config/
  logger/
  platform/
  events/
  ui/
  shared/
  tsconfig/
```

### Name mappings

The milestone specification uses a few canonical names that differ from package folder names:

| Milestone name   | Package                    |
| ---------------- | -------------------------- |
| `secure-storage` | `@engineering-os/security` |
| `test-utils`     | `@engineering-os/testing`  |

## Boundaries

- `packages/contracts` is the stable cross-package boundary for plugin manifests, permissions, compatibility, and bundled MCP declarations.
- Runtime, SDK, tool-execution, and RPC contracts remain explicitly unstable behind `@engineering-os/contracts/unstable-runtime`.
- `packages/plugin-sdk` is the only supported dependency surface for connector plugins.
- `packages/core` may depend on contracts and platform services, but must not depend on UI or connector implementations.

## Plugin dependency rule

Connector plugins under `plugins/*` may depend only on:

- `@engineering-os/contracts`
- `@engineering-os/plugin-sdk`

Plugins must not depend on desktop UI internals, database packages, other plugin source trees, or AI provider implementations.
