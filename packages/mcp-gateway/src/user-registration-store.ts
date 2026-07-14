import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  mcpServerRegistrationSchema,
  type McpServerRegistration
} from "@engineering-os/contracts/unstable-runtime";

const persistedUserRegistrationSchema = mcpServerRegistrationSchema.refine(
  (registration) => registration.source.type === "user",
  "Persisted MCP registrations must use the user source type."
);

const persistedUserRegistrationDocumentSchema = {
  parse(value: unknown): {
    readonly schemaVersion: 1;
    readonly registrations: readonly McpServerRegistration[];
  } {
    if (
      typeof value !== "object" ||
      value === null ||
      !("schemaVersion" in value) ||
      value.schemaVersion !== 1 ||
      !("registrations" in value) ||
      !Array.isArray(value.registrations)
    ) {
      throw new Error("Persisted MCP registration document is invalid.");
    }

    return {
      schemaVersion: 1,
      registrations: value.registrations.map((registration) =>
        persistedUserRegistrationSchema.parse(registration)
      )
    };
  }
};

export interface McpUserRegistrationStore {
  load(): Promise<readonly McpServerRegistration[]>;
  save(registrations: readonly McpServerRegistration[]): Promise<void>;
}

export class FileMcpUserRegistrationStore implements McpUserRegistrationStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<readonly McpServerRegistration[]> {
    try {
      const contents = await readFile(this.filePath, "utf8");
      const parsedDocument = persistedUserRegistrationDocumentSchema.parse(
        JSON.parse(contents)
      );

      return parsedDocument.registrations;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return [];
      }

      throw error;
    }
  }

  async save(registrations: readonly McpServerRegistration[]): Promise<void> {
    const validatedRegistrations = registrations.map((registration) =>
      persistedUserRegistrationSchema.parse(registration)
    );
    const serializedDocument = JSON.stringify(
      {
        schemaVersion: 1,
        registrations: validatedRegistrations
      },
      null,
      2
    );
    const temporaryFilePath = `${this.filePath}.tmp`;

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(temporaryFilePath, serializedDocument, "utf8");
    await rename(temporaryFilePath, this.filePath);
  }
}
