import { randomUUID } from "node:crypto";

import { ApplicationDatabase } from "@engineering-os/database";
import { z } from "zod";

import { PluginConnectionError } from "./plugin-connection-error.js";

const readRequiredString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string") {
    throw new Error(`Expected '${fieldName}' to be a string.`);
  }

  return value;
};

export const createWorkspaceRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100)
  })
  .strict();

export type CreateWorkspaceRequest = z.infer<
  typeof createWorkspaceRequestSchema
>;

export interface EngineeringWorkspace {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const mapWorkspaceRow = (
  row: Record<string, unknown>
): EngineeringWorkspace => ({
  id: readRequiredString(row.id, "id"),
  name: readRequiredString(row.name, "name"),
  createdAt: readRequiredString(row.created_at, "created_at"),
  updatedAt: readRequiredString(row.updated_at, "updated_at")
});

export class WorkspaceService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly createId: () => string = randomUUID
  ) {}

  listWorkspaces(): readonly EngineeringWorkspace[] {
    return this.database
      .queryAll(
        `
          SELECT id, name, created_at, updated_at
          FROM engineering_workspaces
          ORDER BY updated_at DESC
        `
      )
      .map(mapWorkspaceRow);
  }

  getWorkspace(workspaceId: string): EngineeringWorkspace {
    const row = this.database.queryFirst(
      `
        SELECT id, name, created_at, updated_at
        FROM engineering_workspaces
        WHERE id = ?
      `,
      [workspaceId]
    );

    if (!row) {
      throw new PluginConnectionError(
        "WORKSPACE_NOT_FOUND",
        "Workspace was not found.",
        404
      );
    }

    return mapWorkspaceRow(row);
  }

  createWorkspace(request: CreateWorkspaceRequest): EngineeringWorkspace {
    const parsed = createWorkspaceRequestSchema.parse(request);
    const timestamp = new Date().toISOString();
    const workspace: EngineeringWorkspace = {
      id: this.createId(),
      name: parsed.name,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.database.execute(
      `
        INSERT INTO engineering_workspaces (id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `,
      [workspace.id, workspace.name, workspace.createdAt, workspace.updatedAt]
    );

    return workspace;
  }
}
