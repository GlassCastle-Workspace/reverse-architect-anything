import { createServer as createTcpServer } from "node:net";
import { once } from "node:events";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, expect, it } from "vitest";

import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createServer } from "../../../src/server/createServer.js";
import { TOOL_EFFECTS } from "../../../src/contracts/toolEffects.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { macOSProcessSocketSnapshotSchema } from "../../../src/domain/architecture/macOSProcessSocketSnapshot.js";

const operation = "observe_macos_process_sockets";
const connections: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => {
  await Promise.all(connections.splice(0).map((resource) => resource.close()));
});

async function connect() {
  const session = createTestBinarySession(() => {
    throw new Error(
      "Socket observation must not execute a selected analysis target",
    );
  });
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "raa-sockets-test", version: "1" });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  connections.push(client, server, session);
  await server.connect(remote);
  await client.connect(local);
  return { client, session };
}

it("advertises exact-PID schema and effects of OS diagnostic process launches", async () => {
  const { client } = await connect();
  const tool = (await client.listTools()).tools.find(
    ({ name }) => name === operation,
  );
  if (!tool) throw new Error("Socket observer MCP tool not registered");
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(tool.inputSchema)).toBe(true);
  const inputCheck = ajv.compile(tool.inputSchema);
  expect(inputCheck({ pid: 12345 })).toBe(true);
  for (const bad of [
    { pid: 0 },
    { pid: -1 },
    { pid: "12345; whoami" },
    { pid: 1, process_name: "all" },
    { pid: 3.14 },
    {},
  ])
    expect(inputCheck(bad)).toBe(false);
  expect(TOOL_EFFECTS[operation]).toMatchObject({
    launchesProcess: true,
    mutatesSession: true,
    mutatesTarget: false,
    writesFilesystem: false,
    accessesNetwork: false,
    executesForeignCode: false,
    mayDiscardData: false,
  });
});

it.skipIf(process.platform !== "darwin")(
  "reads only an explicit own PID and returns typed partial socket Evidence",
  async () => {
    const listener = createTcpServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    try {
      const address = listener.address();
      if (!address || typeof address === "string")
        throw new Error("No loopback socket address");
      const { client } = await connect();
      const advertised = (await client.listTools()).tools.find(
        ({ name }) => name === operation,
      );
      if (!advertised) throw new Error("Socket observer missing");
      const ajv = new Ajv2020({ strict: false, validateFormats: false });
      const outputCheck = ajv.compile(
        advertised.outputSchema as Parameters<typeof ajv.compile>[0],
      );
      const result = await client.callTool({
        name: operation,
        arguments: { pid: process.pid },
      });
      expect(result.isError).not.toBe(true);
      const evidence = parseEvidence(result.structuredContent);
      expect(outputCheck(evidence)).toBe(true);
      const snapshot = macOSProcessSocketSnapshotSchema.parse(
        evidence.normalized_result,
      );
      expect(snapshot.process.pid).toBe(process.pid);
      expect(
        snapshot.sockets.some(
          (item) =>
            item.endpoint.includes(`127.0.0.1:${address.port}`) &&
            item.protocol === "TCP",
        ),
      ).toBe(true);
      expect(snapshot.coverage.completeness).toBe("partial-point-in-time");
      expect(snapshot.limitations.join(" ")).toMatch(/not.*packet event/u);
    } finally {
      listener.close();
      await once(listener, "close");
    }
  },
);

it("rejects malformed PID without launching any OS tool", async () => {
  const { client, session } = await connect();
  const result = await client.callTool({
    name: operation,
    arguments: { pid: "4321;whoami" },
  });
  expect(result.isError).toBe(true);
  expect(session.exportEvidenceBundle().records).toEqual([]);
});
