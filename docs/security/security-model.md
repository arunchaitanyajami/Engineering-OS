# Security Model

## Principles

- secrets stay local by default
- dangerous actions require explicit approval
- connectors must declare permissions
- actions and approvals must be auditable
- agents must not execute destructive behavior silently

## Milestone 0 Contracts

- `SecretStore` abstraction for secure secret access
- typed permission identifiers
- confirmation policy model for destructive actions
- audit event model with actor, action, outcome, and correlation data

## Early Boundaries

- no API keys in source control
- no insecure plaintext secret handling in application code
- no connector access without permission checks
- no automation without user review
- no sensitive credentials in audit metadata or logs

## Permission Categories

- `filesystem.read`
- `filesystem.write`
- `network.request`
- `database.read`
- `database.write`
- `shell.execute`
- `secret.read`

## Milestone Progression

- `M0`: document the model and protect repo hygiene
- `M1`: local settings and API key storage
- `M2`: plugin permissions model
- `M11`: audited action mode with approval gates
