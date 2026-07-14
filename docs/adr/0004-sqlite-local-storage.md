# ADR-0004: SQLite for Local Relational Storage

## Status

Accepted

## Context

Engineering OS needs reliable local relational storage for application metadata,
session persistence, plugin state, permissions, and audit history. Milestone 1
only needs ownership of the local SQLite foundation, not feature-specific
schemas for plugins, agents, or workflows.

## Decision

Use SQLite as the local relational database and hide access behind repositories and migration utilities.

## Alternatives Considered

- JSON files only
- remote managed databases
- heavier embedded databases

## Ownership

- The desktop application owns the local SQLite database lifecycle.
- Schema creation and migration execution live behind a dedicated database
  package instead of React components.
- Milestone 1 keeps the initial schema intentionally small:
  `application_metadata`, `schema_migrations`, and `engineering_sessions` for
  the desktop session shell required by the milestone acceptance criteria.

## Operational Notes

- Database files live in the application data directory resolved by the desktop
  runtime.
- Migrations are versioned and must be idempotent.
- Session persistence in Milestone 1 is limited to local workspace-shell
  records; plugin, agent, workflow, and connector schemas remain out of scope.
- Backup, corruption recovery, and WAL-mode tuning remain explicit follow-up
  concerns as the schema grows.
- The project assumes a single-user local desktop process as the primary
  concurrency model.

## Consequences

- strong local-first storage story
- supports transactional migrations and structured audit storage

## Risks

- schema evolution must stay disciplined

## Revisit Conditions

- revisit if local-first storage requirements exceed SQLite capabilities
