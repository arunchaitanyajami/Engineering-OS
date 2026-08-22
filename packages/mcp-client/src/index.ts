import type {
  McpServerHealthSnapshot,
  RegisteredMcpServer
} from "@engineering-os/contracts/unstable-runtime";

export type { RegisteredMcpServer, McpServerHealthSnapshot };

export type McpClientConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "failed";

export interface McpClientSessionSnapshot {
  readonly registrationId: string;
  readonly server: RegisteredMcpServer;
  readonly connectionState: McpClientConnectionState;
  readonly health: McpServerHealthSnapshot | null;
}
