# ADR-0021: Provider-Independent Tool Representation

## Status

Accepted

## Context

Engineering OS must remain AI-model-agnostic. MCP servers may expose tools, resources, and prompts, but OpenAI, Anthropic, Gemini, and local model adapters all expect different wire formats.

If raw MCP responses or provider-specific tool definitions leak into core application services, future provider support will become expensive and brittle.

## Decision

Represent discovered tools and tool execution results through provider-independent Engineering OS contracts.

The normalized model includes:

- `ToolDescriptor`
- `ToolExecutionRequest`
- `ToolExecutionResult`
- `NormalizedExecutionError`
- content descriptors for text, JSON, and referenced resources

Provider adapters translate from this normalized model into provider-specific formats. The MCP Gateway also maps raw MCP capability metadata into this same model before any downstream consumer sees it.

## Alternatives Considered

- pass raw MCP tool descriptors directly to provider adapters
- store OpenAI- or Anthropic-shaped tool models in the core database
- let each agent define its own tool payload conventions

## Why This Option

- preserves provider independence
- reduces coupling to MCP SDK and provider SDK changes
- gives agents, workflows, and UI tools one stable execution model
- improves testing because normalized tool fixtures can be shared

## Consequences

- gateway and provider adapter packages must maintain translation code
- some provider-specific metadata may need explicit extension points later

## Risks

- normalized models can become too generic and lose useful semantics
- new providers may require metadata not present in the first contract version

## Mitigations

- keep the normalized contract small but extensible
- retain optional annotations and metadata fields where safe
- add contract tests for gateway-to-provider translation

## Revisit Conditions

- revisit if a future provider requires a materially different execution model that cannot be represented as a translation layer
