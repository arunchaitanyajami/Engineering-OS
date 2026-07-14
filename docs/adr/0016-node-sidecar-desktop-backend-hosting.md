# ADR-0016: Node Sidecar Desktop Backend Hosting

## Status

Accepted

## Context

Engineering OS is desktop-first, local-first, TypeScript-first, and plugin-first. Milestone 1 requires local configuration, SQLite initialization, session persistence, and structured logging, but those responsibilities do not inherently require Rust.

An earlier implementation moved SQLite access, configuration persistence, logging, and session ownership into the Tauri Rust entrypoint. That conflicted with the project architecture in three ways:

- it made Rust the de facto application backend instead of limiting Rust to native desktop concerns
- it forced future Node/TypeScript systems to either proxy through Rust commands or duplicate persistence logic
- it made the Tauri entrypoint grow into an application domain runtime instead of a narrow native host

Milestone 2 and later milestones will add plugin SDK, MCP gateway, workflow engine, memory services, and agent runtimes. Those systems are intentionally designed to live in Node.js and TypeScript packages, not inside Rust.

## Decision

Use Tauri as the native desktop host and launch a local Node.js sidecar process for desktop backend services in production builds.

The runtime split is:

- React renderer owns presentation, navigation, and feature orchestration
- Tauri Rust owns only native windowing, tightly scoped native commands, and sidecar lifecycle
- the Node sidecar owns local configuration persistence, SQLite access, migration execution, local log persistence, and session repository operations

Frontend-to-backend communication uses a typed local HTTP contract over loopback. The React application reaches the backend only through the `DesktopPlatform` abstraction and narrowly scoped Tauri commands. The UI does not import backend packages directly and does not call unrestricted Tauri APIs directly.

The loopback transport is authenticated per application launch:

- Tauri generates or receives a per-launch bearer token
- Tauri passes that token to the Node sidecar through process environment
- the renderer receives the runtime backend connection descriptor only through a narrow Tauri command
- every backend request must include `Authorization: Bearer <runtime-token>`
- the token is never persisted and is not written to logs

The backend runtime address is also per-launch:

- development uses a dynamically allocated loopback port selected by the dev launcher
- production starts the backend with port `0` and lets the operating system allocate an available port
- the sidecar reports its actual runtime port back to Tauri through a controlled startup message
- the renderer never assumes a global fixed port

The startup model is:

1. Tauri starts.
2. Rust prepares a per-launch backend connection descriptor, including a runtime authentication token.
3. Rust resolves the packaged backend bundle and launches the Node sidecar.
4. The sidecar initializes the application data directory, SQLite database, migrations, log sink, and bound loopback port.
5. The sidecar reports its actual runtime port to Tauri through a structured ready message.
6. Tauri performs an authenticated backend health check before exposing the runtime connection descriptor.
7. React uses the platform abstraction to call either native Tauri commands or the typed desktop backend endpoints.

In development, the backend may run as a normal Node process outside packaged sidecar mode to preserve fast iteration.

## Alternatives Considered

- keep persistence in Rust
- embed persistence directly in the React renderer
- use Tauri commands for every storage and logging operation
- run a remote backend for local desktop persistence

## Why This Option

- preserves the project rule that TypeScript is the primary runtime language
- keeps Rust minimal and focused on native desktop capabilities
- lets future plugins, MCP services, workflows, and agents share one backend runtime model
- avoids duplicating SQLite, config, and logging logic across Rust and TypeScript
- keeps the UI boundary testable through the `DesktopPlatform` contract

## Consequences

- the desktop application now has two local runtime layers instead of one
- startup must manage sidecar packaging, lifecycle, and health carefully
- the backend contract must remain typed and versioned because it is now a real boundary
- native integration coverage is required for backend health, config persistence, session persistence, and log writing

## Operational Notes

- the sidecar is loopback-only and never exposed as a network service beyond the local machine
- loopback transport is authenticated per launch and does not rely on CORS as the primary protection
- development CORS is limited to the exact configured Vite origin, while packaged builds allow only known Tauri origins
- Tauri capabilities remain narrow and do not expose generic shell execution or unrestricted filesystem access to the renderer
- SQLite migrations run inside the TypeScript database package before repositories are used
- configuration writes are atomic and preserve the prior version through a backup file during replacement
- configuration load attempts backup recovery when the primary file is missing or invalid

## Risks

- sidecar startup failures can block desktop initialization if packaging or resource paths drift
- loopback transport adds a small amount of operational complexity compared with in-process calls
- backend contract drift can occur if the platform adapter and backend endpoints are not validated together

## Mitigations

- keep Rust host code small and focused on sidecar lifecycle plus native-only commands
- add integration tests against the real desktop backend HTTP surface
- keep storage ownership in reusable TypeScript packages instead of backend-local helpers where possible
- document packaging expectations in build scripts and Tauri configuration

## Revisit Conditions

- revisit if Tauri gains a better built-in TypeScript-side background runtime that preserves the same architectural boundaries
- revisit if the loopback contract becomes a measurable bottleneck for desktop-only operations
- revisit if multiple local backend processes are needed for plugin isolation or security domains
