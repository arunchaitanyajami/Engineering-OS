# Adding A Package

## When To Add One

- add a new package only when it has a clear architectural responsibility
- do not create packages for speculative future ideas without a boundary reason

## Required Steps

1. Create `packages/<name>/package.json`.
2. Add `src/index.ts` or `src/index.tsx`.
3. Add `tsconfig.json` extending `packages/tsconfig`.
4. Add `build`, `typecheck`, and `lint` scripts.
5. Update docs if the new package changes the architecture.
6. Add focused tests if the package introduces behavior, not just types.
