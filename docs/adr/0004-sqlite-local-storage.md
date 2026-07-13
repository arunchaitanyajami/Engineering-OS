# ADR-0004: SQLite for Local Relational Storage

## Status

Accepted

## Context

Engineering OS needs reliable local relational storage for settings, plugin state, permissions, and audit history.

## Decision

Use SQLite as the local relational database and hide access behind repositories and migration utilities.

## Alternatives Considered

- JSON files only
- remote managed databases
- heavier embedded databases

## Consequences

- strong local-first storage story
- supports transactional migrations and structured audit storage

## Risks

- schema evolution must stay disciplined

## Revisit Conditions

- revisit if local-first storage requirements exceed SQLite capabilities
