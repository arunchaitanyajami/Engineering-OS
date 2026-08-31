# Monorepo Structure

Milestone 2 formalizes the repository layout for plugins, MCP integration, and desktop management surfaces.

## Layout

```text
apps/
  desktop/
    src/
      features/
        plugins/
        mcp/
        permissions/

packages/
  core/
  contracts/
  plugin-sdk/
  plugin-runtime/
  mcp-gateway/
  mcp-client/
  capability-catalog/
  permission-engine/
  security/          # secure-storage
  observability/
  testing/           # test-utils

plugins/
  example-plugin/
  example-mcp-plugin/

agents/
  README.md

workflows/
  README.md

docs/
  architecture/
  adr/
  plugins/
  mcp/
```

## Boundary rules

- `packages/core` may depend on contracts and platform services.
- Connector plugins may depend only on `packages/plugin-sdk` and `packages/contracts`.
- Plugins must not depend on desktop UI internals, database implementation packages, other plugin source trees, or AI provider implementations.
- `apps/*` must not import `packages/database` or `packages/security` directly into UI code.

## Enforcement

- TypeScript path aliases define supported package entry points in `scripts/workspace-aliases.ts`.
- `dependency-cruiser` validates dependency direction, plugin boundaries, and circular imports.
- Pull requests must pass `pnpm boundaries:check`.
