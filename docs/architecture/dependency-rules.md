# Dependency Rules

## Direction

```text
apps
  -> application packages
  -> contracts and core facades
  -> shared primitives

plugins
  -> plugin-sdk
  -> contracts
```

## Rules

- `packages/shared` is foundational and must not depend on other internal packages.
- `packages/contracts` may depend only on `packages/shared` and external schema libraries.
- `packages/core` must not depend on `packages/ui`.
- `packages/core` must not depend on connector implementations.
- `packages/plugin-sdk` and connector plugins must depend on `packages/contracts`, not app internals.
- `plugins/*` may depend only on `packages/contracts` and `packages/plugin-sdk`.
- `plugins/*` must not depend on `apps/*`, `packages/database`, or other internal packages.
- `apps/*` must not import `packages/database` or `packages/security` directly into UI code.
- `packages/*` must not depend on `apps/*`.
- circular dependencies are not allowed.

## Milestone 2 package names

The milestone specification uses canonical names that map to existing folders:

| Spec name        | Folder / package                                 |
| ---------------- | ------------------------------------------------ |
| `secure-storage` | `packages/security` (`@engineering-os/security`) |
| `test-utils`     | `packages/testing` (`@engineering-os/testing`)   |

## Enforcement

- TypeScript path aliases define supported package entry points.
- `dependency-cruiser` validates dependency direction, plugin boundaries, and detects circular imports.
- pull requests must pass `pnpm boundaries:check`.

See also [monorepo structure](./monorepo-structure.md).
