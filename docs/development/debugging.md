# Debugging

## Desktop

- run `pnpm dev`
- use the browser devtools during Milestone 0 shell development
- keep privileged behavior behind typed backend boundaries

## TypeScript

- run `pnpm typecheck`
- prefer small modules with explicit imports and exports

## Database

- run integration tests with `pnpm test:integration`
- keep schema changes in forward-only migrations

## Logging

- use `@engineering-os/logger`
- include component names and correlation IDs for non-trivial flows
