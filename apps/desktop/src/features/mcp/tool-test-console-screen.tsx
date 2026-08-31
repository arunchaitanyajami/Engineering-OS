import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  PanelCard
} from "@engineering-os/ui";
import type { ToolExecutionResult } from "@engineering-os/contracts/unstable-runtime";

import {
  BackendUnavailableNotice,
  FeatureErrorState,
  FeatureLoadingState,
  formatJson,
  riskBadgeTone
} from "../shared/feature-states.js";
import { useAsyncResource } from "../../hooks/use-async-resource.js";
import { desktopBackendClient } from "../../services/desktop-backend-client.js";
import { isDesktopBackendAvailable } from "../../services/desktop-backend-request.js";

export function ToolTestConsoleScreen() {
  const [searchParams] = useSearchParams();
  const initialToolId = searchParams.get("toolId") ?? "";
  const initialServerId = searchParams.get("serverId") ?? "";

  const [selectedToolId, setSelectedToolId] = useState(initialToolId);
  const [argumentsJson, setArgumentsJson] = useState("{}");
  const [approvalMode, setApprovalMode] = useState<
    "none" | "user-confirmation" | "dual-confirmation"
  >("none");
  const [actionError, setActionError] = useState<string | null>(null);
  const [executionResult, setExecutionResult] =
    useState<ToolExecutionResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const loadTools = useCallback(async () => {
    const response = await desktopBackendClient.listMcpTools({
      ...(initialServerId ? { serverId: initialServerId } : {})
    });

    return response.tools;
  }, [initialServerId]);

  const {
    data: tools,
    error,
    isLoading,
    reload
  } = useAsyncResource(loadTools, [initialServerId]);

  const selectedTool = useMemo(
    () => tools?.find((tool) => tool.id === selectedToolId) ?? null,
    [selectedToolId, tools]
  );

  if (!isDesktopBackendAvailable()) {
    return <BackendUnavailableNotice />;
  }

  if (isLoading) {
    return (
      <FeatureLoadingState
        title="Loading tool catalog"
        description="Fetching discovered MCP tools from the gateway."
      />
    );
  }

  if (error || !tools) {
    return (
      <FeatureErrorState
        title="Unable to load tools"
        description={error ?? "Tool catalog request failed."}
        onRetry={reload}
      />
    );
  }

  const handleExecute = async () => {
    if (!selectedTool) {
      setActionError("Select a discovered MCP tool before executing.");
      return;
    }

    let parsedArguments: Record<string, unknown>;

    try {
      parsedArguments = JSON.parse(argumentsJson) as Record<string, unknown>;
    } catch {
      setActionError("Tool arguments must be valid JSON.");
      return;
    }

    setIsExecuting(true);
    setActionError(null);
    setExecutionResult(null);

    try {
      const response = await desktopBackendClient.executeMcpTool({
        toolId: selectedTool.id,
        arguments: parsedArguments,
        executionContext: {
          actor: { type: "user", id: "desktop-tool-console" },
          correlationId: crypto.randomUUID(),
          approvalMode
        }
      });
      setExecutionResult(response.result);
    } catch (executeError) {
      setActionError(
        executeError instanceof Error
          ? executeError.message
          : "Tool execution failed."
      );
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="screen-layout">
      <PageHeader
        eyebrow="Developer"
        title="MCP Tool Test Console"
        description="Inspect discovered tools, supply arguments, review approval requirements, and execute through the gateway."
        actions={
          <Link className="ui-button ui-button--ghost" to="/mcp/servers">
            Back to MCP servers
          </Link>
        }
      />

      <div className="content-grid">
        <PanelCard eyebrow="Catalog" title="Select tool">
          {tools.length === 0 ? (
            <EmptyState
              title="No tools available"
              description="Register and start an MCP server before using the tool console."
            />
          ) : (
            <label className="form-field">
              <span>Discovered tool</span>
              <select
                className="app-select"
                onChange={(event) => setSelectedToolId(event.target.value)}
                value={selectedToolId}
              >
                <option value="">Select a tool</option>
                {tools.map((tool) => (
                  <option key={tool.id} value={tool.id}>
                    {tool.serverId}/{tool.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {selectedTool ? (
            <div className="stack-list">
              <div className="summary-list__row">
                <span>Risk level</span>
                <Badge tone={riskBadgeTone(selectedTool.riskLevel)}>
                  {selectedTool.riskLevel}
                </Badge>
              </div>
              <div className="summary-list__row">
                <span>Tool ID</span>
                <span>{selectedTool.id}</span>
              </div>
              <p className="ui-muted">
                {selectedTool.description ?? "No description provided."}
              </p>
            </div>
          ) : null}
        </PanelCard>

        <PanelCard eyebrow="Schema" title="Input schema">
          {selectedTool ? (
            <pre className="code-block">
              {formatJson(selectedTool.inputSchema)}
            </pre>
          ) : (
            <EmptyState
              title="Select a tool"
              description="The normalized input schema appears here for argument authoring."
            />
          )}
        </PanelCard>

        <PanelCard eyebrow="Execute" title="Arguments and approval">
          <label className="form-field">
            <span>Arguments (JSON)</span>
            <textarea
              className="app-textarea"
              onChange={(event) => setArgumentsJson(event.target.value)}
              rows={8}
              value={argumentsJson}
            />
          </label>
          <label className="form-field">
            <span>Approval mode</span>
            <select
              className="app-select"
              onChange={(event) =>
                setApprovalMode(
                  event.target.value as
                    "none" | "user-confirmation" | "dual-confirmation"
                )
              }
              value={approvalMode}
            >
              <option value="none">None</option>
              <option value="user-confirmation">User confirmation</option>
              <option value="dual-confirmation">Dual confirmation</option>
            </select>
          </label>
          {actionError ? <p className="ui-error-text">{actionError}</p> : null}
          <div className="action-row">
            <Button
              disabled={isExecuting || !selectedTool}
              onClick={() => void handleExecute()}
            >
              {isExecuting ? "Executing…" : "Execute tool"}
            </Button>
          </div>
        </PanelCard>

        <PanelCard eyebrow="Output" title="Normalized result">
          {executionResult ? (
            <pre className="code-block">{formatJson(executionResult)}</pre>
          ) : (
            <EmptyState
              title="No execution yet"
              description="Successful or failed tool runs render normalized gateway output here."
            />
          )}
        </PanelCard>
      </div>
    </div>
  );
}
