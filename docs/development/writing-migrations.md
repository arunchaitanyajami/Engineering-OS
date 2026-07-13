# Writing Migrations

## Rules

- migrations are forward-only
- migrations must be idempotent where practical
- never introduce automatic destructive resets
- keep schema changes aligned with the current milestone

## Process

1. Add a new migration entry in `packages/database/src/index.ts`.
2. Use transactional SQL where SQLite supports it.
3. Add or update integration tests in `packages/database/tests`.
4. Document new tables and architectural consequences when they matter.
