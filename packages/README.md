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
  source-control-domain/
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
- `packages/source-control-domain` is the normalized SCM and PR review contract surface. GitHub SDK types must not appear here; the GitHub plugin maps vendor payloads onto these schemas.
- Runtime, SDK, tool-execution, and RPC contracts remain explicitly unstable behind `@engineering-os/contracts/unstable-runtime`.
- `@engineering-os/plugin-sdk` is the supported runtime/author surface for connector plugins. Plugins may also depend on `@engineering-os/contracts` and `@engineering-os/source-control-domain` for shared types.
- `packages/core` may depend on contracts and platform services, but must not depend on UI or connector implementations.

## Plugin dependency rule

Connector plugins under `plugins/*` may depend only on:

- `@engineering-os/contracts`
- `@engineering-os/plugin-sdk`
- `@engineering-os/source-control-domain`

Plugins must not depend on desktop UI internals, database packages, other plugin source trees, or AI provider implementations.
