# Dependency Rules

## Direction

```text
apps
  -> application packages
  -> core and security contracts
  -> shared primitives
```

## Rules

- `packages/shared` is foundational and must not depend on other internal packages.
- `packages/core` must not depend on `packages/ui`.
- `packages/core` must not depend on connector implementations.
- `apps/*` must not import `packages/database` or `packages/security` directly into UI code.
- `packages/*` must not depend on `apps/*`.
- circular dependencies are not allowed.

## Enforcement

- TypeScript path aliases define supported package entry points.
- `dependency-cruiser` validates dependency direction and detects circular imports.
- pull requests must pass `pnpm boundaries:check`.
