# Logging And Error Handling

## Logging Standards

- use `@engineering-os/logger` instead of direct `console.log`
- include structured metadata for actionable context
- redact sensitive values such as passwords, tokens, and API keys
- use correlation IDs for multi-step flows

## Error Handling Standards

- expected failures should use typed results or known domain errors
- unexpected failures should be logged and converted to safe boundary errors
- do not leak raw infrastructure details into UI contracts
