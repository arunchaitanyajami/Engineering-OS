import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Writable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { ManagedStdioClientTransport } from "../src/managed-stdio-client-transport.js";

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 500
): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }

  throw new Error("Condition was not satisfied before the timeout.");
};

describe("ManagedStdioClientTransport", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    );
    directories.length = 0;
  });

  const createScript = async (source: string) => {
    const directory = await mkdtemp(join(tmpdir(), "engineering-os-transport-"));
    directories.push(directory);
    const scriptPath = join(directory, "index.js");
    await writeFile(scriptPath, source, "utf8");

    return {
      directory
    };
  };

  it("terminates the transport when stdout exceeds the maximum buffered message size", async () => {
    const { directory } = await createScript(`
      process.stdout.write("a".repeat(${4 * 1024 * 1024 + 1}));
      setInterval(() => {}, 1_000);
      process.on("SIGTERM", () => process.exit(0));
    `);
    const transport = new ManagedStdioClientTransport({
      command: "node",
      args: ["./index.js"],
      cwd: directory,
      shutdownGracePeriodMs: 50
    });
    const errorPromise = new Promise<Error>((resolve) => {
      transport.onerror = resolve;
    });

    await transport.start();

    await expect(errorPromise).resolves.toMatchObject({
      code: "MCP_GATEWAY_MESSAGE_TOO_LARGE"
    });
    await waitFor(() => transport.childProcess === undefined);
  });

  it("rejects invalid JSON-RPC messages from the child process", async () => {
    const { directory } = await createScript(`
      process.stdout.write(JSON.stringify({ hello: "world" }) + "\\n");
      setInterval(() => {}, 1_000);
      process.on("SIGTERM", () => process.exit(0));
    `);
    const transport = new ManagedStdioClientTransport({
      command: "node",
      args: ["./index.js"],
      cwd: directory,
      shutdownGracePeriodMs: 50
    });
    const errorPromise = new Promise<Error>((resolve) => {
      transport.onerror = resolve;
    });

    await transport.start();

    await expect(errorPromise).resolves.toMatchObject({
      code: "MCP_GATEWAY_MESSAGE_INVALID"
    });
    await waitFor(() => transport.childProcess === undefined);
  });

  it("rejects send when the child exits before backpressure drains", async () => {
    const { directory } = await createScript(`
      process.stdin.on("data", () => {});
      setInterval(() => {}, 1_000);
      process.on("SIGTERM", () => process.exit(0));
    `);
    const transport = new ManagedStdioClientTransport({
      command: "node",
      args: ["./index.js"],
      cwd: directory,
      shutdownGracePeriodMs: 50
    });

    await transport.start();

    const child = transport.childProcess;
    const stdin = child?.stdin as (Writable & {
      write(chunk: string): boolean;
    }) | null;

    expect(child).toBeTruthy();
    expect(stdin).toBeTruthy();

    const originalWrite = stdin?.write.bind(stdin);

    if (!child || !stdin || !originalWrite) {
      throw new Error("Transport child process did not expose stdin.");
    }

    stdin.write = (() => false) as typeof stdin.write;

    const sendPromise = transport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "ping"
    });

    setTimeout(() => {
      child.kill("SIGTERM");
    }, 20);

    await expect(sendPromise).rejects.toMatchObject({
      code: "MCP_GATEWAY_TRANSPORT_WRITE_FAILED"
    });

    stdin.write = originalWrite;
  });

  it("rejects outbound messages that exceed the maximum message size", async () => {
    const { directory } = await createScript(`
      process.stdin.on("data", () => {});
      setInterval(() => {}, 1_000);
      process.on("SIGTERM", () => process.exit(0));
    `);
    const transport = new ManagedStdioClientTransport({
      command: "node",
      args: ["./index.js"],
      cwd: directory,
      shutdownGracePeriodMs: 50
    });

    await transport.start();

    await expect(
      transport.send({
        jsonrpc: "2.0",
        method: "tools/list",
        id: 1,
        params: {
          payload: "x".repeat(4 * 1024 * 1024)
        }
      })
    ).rejects.toMatchObject({
      code: "MCP_GATEWAY_MESSAGE_TOO_LARGE"
    });

    await transport.close();
  });
});
