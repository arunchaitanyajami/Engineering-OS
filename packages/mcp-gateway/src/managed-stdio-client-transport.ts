import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { PassThrough, type Readable } from "node:stream";

import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export interface ManagedStdioClientTransportOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly shutdownGracePeriodMs: number;
}

export class ManagedStdioClientTransport implements Transport {
  private child: ChildProcess | undefined;
  private readBuffer = "";
  private readonly stderrStream = new PassThrough();

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T) => void;

  constructor(private readonly options: ManagedStdioClientTransportOptions) {}

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  get stderr(): Readable {
    return this.stderrStream;
  }

  get childProcess(): ChildProcess | undefined {
    return this.child;
  }

  async start(): Promise<void> {
    if (this.child) {
      throw new Error(
        "ManagedStdioClientTransport already started. Create a new transport per connection."
      );
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.options.command, this.options.args ?? [], {
        cwd: this.options.cwd,
        env: this.options.env,
        stdio: ["pipe", "pipe", "pipe"]
      });

      this.child = child;
      child.stderr?.pipe(this.stderrStream, { end: false });

      child.once("error", (error) => {
        reject(error);
        this.onerror?.(error);
      });

      child.once("spawn", () => {
        resolve();
      });

      child.once("close", () => {
        this.child = undefined;
        this.onclose?.();
      });

      child.stdin?.on("error", (error) => {
        this.onerror?.(error);
      });

      child.stdout?.on("data", (chunk: Buffer | string) => {
        this.processChunk(
          Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk
        );
      });

      child.stdout?.on("error", (error) => {
        this.onerror?.(error);
      });
    });
  }

  async close(): Promise<void> {
    if (!this.child) {
      this.readBuffer = "";
      return;
    }

    const child = this.child;
    this.child = undefined;

    try {
      child.stdin?.end();
    } catch {
      // Ignore stdin close failures during shutdown.
    }

    const exitedDuringGrace = await this.waitForChildExit(
      child,
      this.options.shutdownGracePeriodMs
    );

    if (!exitedDuringGrace) {
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore termination failures during shutdown.
      }
    }

    const exitedAfterSigterm =
      exitedDuringGrace ||
      (await this.waitForChildExit(child, this.options.shutdownGracePeriodMs));

    if (!exitedAfterSigterm) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Ignore forced termination failures during shutdown.
      }
    }

    if (!exitedAfterSigterm) {
      await this.waitForChildExit(child, this.options.shutdownGracePeriodMs);
    }

    this.readBuffer = "";
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.child?.stdin) {
      throw new Error("Managed stdio transport is not connected.");
    }

    await new Promise<void>((resolve) => {
      const serializedMessage = `${JSON.stringify(message)}\n`;

      if (this.child?.stdin?.write(serializedMessage)) {
        resolve();
        return;
      }

      this.child?.stdin?.once("drain", () => {
        resolve();
      });
    });
  }

  private processChunk(chunk: string): void {
    this.readBuffer += chunk;

    while (true) {
      const newlineIndex = this.readBuffer.indexOf("\n");

      if (newlineIndex === -1) {
        return;
      }

      const line = this.readBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.readBuffer = this.readBuffer.slice(newlineIndex + 1);

      if (!line.trim()) {
        continue;
      }

      try {
        this.onmessage?.(JSON.parse(line) as JSONRPCMessage);
      } catch (error) {
        this.onerror?.(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  }

  private waitForChildExit(
    child: ChildProcess,
    timeoutMs: number
  ): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);
      const handleClose = () => {
        cleanup();
        resolve(true);
      };
      const cleanup = () => {
        clearTimeout(timeout);
        child.off("close", handleClose);
      };

      child.once("close", handleClose);
    });
  }
}
