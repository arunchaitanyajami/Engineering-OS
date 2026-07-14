# Dependency Rules

## Direction

```text
apps
  -> application packages
  -> contracts and core facades
  -> shared primitives
```

## Rules

- `packages/shared` is foundational and must not depend on other internal packages.
- `packages/contracts` may depend only on `packages/shared` and external schema libraries.
- `packages/core` must not depend on `packages/ui`.
- `packages/core` must not depend on connector implementations.
- `packages/plugin-sdk` and future plugins must depend on `packages/contracts`, not app internals.
- `apps/*` must not import `packages/database` or `packages/security` directly into UI code.
- `packages/*` must not depend on `apps/*`.
- circular dependencies are not allowed.

## Enforcement

- TypeScript path aliases define supported package entry points.
- `dependency-cruiser` validates dependency direction and detects circular imports.
- pull requests must pass `pnpm boundaries:check`.
