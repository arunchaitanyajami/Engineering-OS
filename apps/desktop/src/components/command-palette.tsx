import { useMemo, useState } from "react";

import { Button } from "@engineering-os/ui";

import {
  ApplicationCommandRegistry,
  type ApplicationCommand
} from "../services/command-registry";

export function CommandPalette({
  isOpen,
  onClose,
  registry
}: {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly registry: ApplicationCommandRegistry;
}) {
  const [query, setQuery] = useState("");
  const commands = useMemo(() => registry.list(query), [query, registry]);

  if (!isOpen) {
    return null;
  }

  const handleExecute = (command: ApplicationCommand) => {
    void registry.execute(command.id).finally(() => {
      setQuery("");
      onClose();
    });
  };

  return (
    <div
      aria-modal="true"
      className="command-palette-backdrop"
      onClick={onClose}
      role="dialog"
    >
      <div
        className="command-palette"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
          }
        }}
      >
        <div className="command-palette__header">
          <div>
            <strong>Command Palette</strong>
            <p className="ui-muted">
              Navigate the desktop shell and trigger milestone-safe commands.
            </p>
          </div>
          <Button className="ui-button--ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        <input
          aria-label="Search commands"
          autoFocus
          className="app-input"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search commands"
          value={query}
        />

        <div className="command-palette__results">
          {commands.map((command) => (
            <button
              className="command-palette__item"
              key={command.id}
              onClick={() => handleExecute(command)}
              type="button"
            >
              <span>
                <strong>{command.title}</strong>
                <span className="ui-muted">{command.category}</span>
              </span>
              <span className="command-palette__shortcut">
                {command.shortcut ?? ""}
              </span>
            </button>
          ))}
          {commands.length === 0 ? (
            <p className="ui-muted">No commands match your query.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
