# Data Storage Overview

## Local Foundation

- SQLite stores relational application data
- future LanceDB stores embeddings and semantic search indexes
- repositories hide storage implementation details from business modules

## Milestone 0 Tables

- `schema_migrations`
- `app_settings`
- `feature_flags`
- `installed_plugins`
- `plugin_permissions`
- `audit_events`

## Storage Rules

- no automatic destructive schema resets
- migrations are forward-only
- secrets do not live in plaintext config
- sensitive audit metadata must be redacted
