export interface ApplicationCommand {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly keywords: readonly string[];
  readonly shortcut?: string;
  execute(): Promise<void> | void;
}

const normalize = (value: string): string => value.trim().toLowerCase();

export class ApplicationCommandRegistry {
  private readonly commands = new Map<string, ApplicationCommand>();

  register(command: ApplicationCommand): void {
    this.commands.set(command.id, command);
  }

  registerMany(commands: readonly ApplicationCommand[]): void {
    commands.forEach((command) => this.register(command));
  }

  list(query = ""): readonly ApplicationCommand[] {
    const normalizedQuery = normalize(query);

    return Array.from(this.commands.values()).filter((command) => {
      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        command.title,
        command.category,
        command.shortcut ?? "",
        ...command.keywords
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }

  async execute(commandId: string): Promise<void> {
    const command = this.commands.get(commandId);

    if (!command) {
      throw new Error(`Unknown application command: ${commandId}`);
    }

    await command.execute();
  }
}

export const shouldHandleGlobalShortcut = (
  target: EventTarget | null
): boolean => {
  if (!(target instanceof HTMLElement)) {
    return true;
  }

  const tagName = target.tagName.toLowerCase();

  return !(
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  );
};
