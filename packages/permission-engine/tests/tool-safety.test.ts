import { describe, expect, it } from "vitest";

import { ApplicationDatabase } from "@engineering-os/database";

import {
  SqliteToolPolicyRepository,
  ToolSafetyService,
  classifyToolRiskLevel
} from "../src/index.js";

describe("classifyToolRiskLevel", () => {
  it("classifies read-oriented tool names as read-only", () => {
    expect(
      classifyToolRiskLevel({
        name: "search_repositories"
      })
    ).toBe("read-only");

    expect(
      classifyToolRiskLevel({
        name: "read_pr_diff",
        annotations: { readOnlyHint: true }
      })
    ).toBe("read-only");
  });

  it("classifies write-oriented tool names as write", () => {
    expect(
      classifyToolRiskLevel({
        name: "create_jira_comment"
      })
    ).toBe("write");
  });

  it("classifies destructive tool names and hints as destructive", () => {
    expect(
      classifyToolRiskLevel({
        name: "merge_pull_request"
      })
    ).toBe("destructive");

    expect(
      classifyToolRiskLevel({
        name: "custom_action",
        annotations: { destructiveHint: true }
      })
    ).toBe("destructive");
  });

  it("classifies privileged tool names as privileged", () => {
    expect(
      classifyToolRiskLevel({
        name: "execute_shell_command"
      })
    ).toBe("privileged");
  });

  it("does not trust readOnlyHint alone", () => {
    expect(
      classifyToolRiskLevel({
        name: "custom_action",
        annotations: { readOnlyHint: true }
      })
    ).toBe("unknown");
  });

  it("defaults unknown third-party tools to unknown", () => {
    expect(
      classifyToolRiskLevel({
        name: "do_something"
      })
    ).toBe("unknown");
  });
});

describe("ToolSafetyService", () => {
  it("applies manual policy overrides over inferred risk", () => {
    const database = new ApplicationDatabase(":memory:");
    database.runMigrations();

    const toolSafety = new ToolSafetyService({
      repository: new SqliteToolPolicyRepository(database),
      now: () => "2026-08-05T00:00:00.000Z"
    });

    const toolId = "user.example.tool.create_jira_comment";

    expect(
      toolSafety.resolveRiskLevel({
        id: toolId,
        name: "create_jira_comment"
      })
    ).toBe("write");

    toolSafety.setManualPolicy(toolId, "read-only", {
      name: "create_jira_comment"
    });

    expect(
      toolSafety.resolveRiskLevel({
        id: toolId,
        name: "create_jira_comment"
      })
    ).toBe("read-only");

    expect(
      toolSafety.getPolicyReview({
        id: toolId,
        name: "create_jira_comment"
      })
    ).toMatchObject({
      effectiveRiskLevel: "read-only",
      source: "manual",
      inferredRiskLevel: "write"
    });

    database.close();
  });
});
