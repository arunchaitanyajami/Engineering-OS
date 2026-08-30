# Example Plugin

Internal reference plugin for Milestone 2.

## Purpose

Validates:

- manifest loading and compatibility checks
- installation and enable lifecycle
- configuration reads through the SDK
- permission declarations and grants
- namespaced secret storage through `context.secrets`
- structured logging across lifecycle hooks
- optional simulated activation failure handling

## Backend entrypoint

`dist/backend/index.js` reads `engineering-os.plugin.json` at runtime so the manifest stays the single source of truth for registry validation.

## Configuration

Optional manifest configuration keys:

| Key               | Type    | Description                                                  |
| ----------------- | ------- | ------------------------------------------------------------ |
| `greeting`        | string  | Logged during initialization when present                    |
| `simulateFailure` | boolean | When true, `activate()` throws to demonstrate error handling |

## Install locally

From the desktop **Plugins** screen, click **Browse…** to choose this directory, or paste its absolute path, then register the package.

## Dependencies

Reference plugins ship as plain JavaScript entrypoints and do not bundle workspace packages. Author against `@engineering-os/contracts` and `@engineering-os/plugin-sdk` in your own development environment.

Do not run `pnpm install` inside a plugin package directory before registering it locally — the registry rejects packages that contain `node_modules` symbolic links.
