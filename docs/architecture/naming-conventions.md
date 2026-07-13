# Naming Conventions

## General

- use lowercase kebab-case for package and directory names
- use PascalCase for React components and TypeScript types
- use camelCase for variables, functions, and object properties
- use UPPER_SNAKE_CASE for constants only when they are true process-level constants

## Packages

- internal package names should follow `@engineering-os/<name>`
- keep package names aligned to responsibility, not implementation detail

## Plugins

- plugin directory names should match the external system or capability
- avoid vendor-specific naming unless the integration is vendor specific

## Agents

- agent names should reflect responsibility, such as `pr-reviewer` or `jira-analyst`
- avoid generic names like `assistant` or `smart-agent`

## Workflows

- workflow names should be verb-led and task-oriented
- examples: `review-pr`, `analyze-ticket`, `create-design-doc`
