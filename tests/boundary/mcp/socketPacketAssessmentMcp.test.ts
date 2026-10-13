import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, expect, it } from "vitest";

import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createServer } from "../../../src/server/createServer.js";
import { TOOL_EFFECTS } from "../../../src/contracts/toolEffects.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { socketPacketAssessmentSchema } from "../../../src/domain/architecture/socketPacketAssessmentSchema.js";
import { SOCKET_PACKET_TEST_REQUEST as request } from "../../../src/domain/architecture/socketPacketAssessment.fixture.js";

const operation = "assess_socket_packet_correspondence";
const retained = (evidence_id: string) => ({
  kind: "retained-evidence" as const,
  evidence_id,
});
const resources: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
});

async function connect() {
  const session = createTestBinarySession(() => {
    throw new Error(
      "Offline socket-packet assessment must not start providers",
    );
  });
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "raa-socket-packet-test", version: "1" });
  resources.push(client, server, session);
  const [local, remote] = InMemoryTransport.createLinkedPair();
  await server.connect(remote);
  await client.connect(local);
  return { client, session };
}

it("advertises typed inline and retained inputs without claiming packet attribution", async () => {
  const { client, session } = await connect();
  const tool = (await client.listTools()).tools.find(
    ({ name }) => name === operation,
  );
  if (!tool) throw new Error("Socket-packet MCP tool is missing");
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(tool.inputSchema)).toBe(true);
  const validateInput = ajv.compile(tool.inputSchema);
  const validateOutput = ajv.compile(
    tool.outputSchema as Parameters<typeof ajv.compile>[0],
  );
  expect(TOOL_EFFECTS[operation]).toMatchObject({
    mutatesTarget: false,
    mutatesSession: true,
    launchesProcess: false,
    accessesNetwork: false,
    writesFilesystem: false,
    executesForeignCode: false,
  });
  const reference = {
    ...request,
    socket_evidence: retained(request.socket_evidence.evidence_id),
    capture_evidence: retained(request.capture_evidence.evidence_id),
  };
  expect(validateInput(request)).toBe(true);
  expect(validateInput(reference)).toBe(true);
  expect(
    validateInput({ ...request, frame_number: "7; cat /etc/passwd" }),
  ).toBe(false);

  const inline = await client.callTool({ name: operation, arguments: request });
  expect(inline.isError).not.toBe(true);
  const evidence = parseEvidence(inline.structuredContent);
  expect(validateOutput(evidence)).toBe(true);
  const projection = socketPacketAssessmentSchema.parse(
    evidence.normalized_result,
  );
  expect(projection.comparison.reported_tuple).toBe("matches-outbound");
  expect(projection.attribution).toMatchObject({
    verification: "not-established",
    independently_verified: false,
    process_packet_relationships: [],
  });
  expect(evidence.evidence_links).toEqual(
    [
      request.socket_evidence.evidence_id,
      request.capture_evidence.evidence_id,
    ].sort(),
  );
  const recorded = session.exportEvidenceBundle().records;
  const byReference = await client.callTool({
    name: operation,
    arguments: reference,
  });
  expect(byReference.isError).not.toBe(true);
  expect(byReference.structuredContent).toEqual(inline.structuredContent);
  expect(session.exportEvidenceBundle().records).toEqual(recorded);
});

it("keeps the socket and capture references in their originating session", async () => {
  const first = await connect();
  const other = await connect();
  expect(first.session.recordEvidence(request.socket_evidence).ok).toBe(true);
  expect(first.session.recordEvidence(request.capture_evidence).ok).toBe(true);
  const call = {
    name: operation,
    arguments: {
      ...request,
      socket_evidence: retained(request.socket_evidence.evidence_id),
      capture_evidence: retained(request.capture_evidence.evidence_id),
    },
  };
  expect(parseMcpToolError(await other.client.callTool(call))).toMatchObject({
    error: { details: { reason: "missing" } },
  });
  expect((await first.client.callTool(call)).isError).not.toBe(true);
  expect(
    (
      await first.client.callTool({
        name: "close_binary",
        arguments: {},
      })
    ).isError,
  ).not.toBe(true);
  expect(parseMcpToolError(await first.client.callTool(call))).toMatchObject({
    error: { details: { reason: "missing" } },
  });
});

it("rejects wrong source families, altered Evidence and missing socket/frame IDs", async () => {
  const { client, session } = await connect();
  for (const arguments_ of [
    { ...request, frame_number: "444" },
    { ...request, socket_observation_id: `raa_socketobs_${"f".repeat(64)}` },
    { ...request, socket_evidence: request.capture_evidence },
    { ...request, capture_evidence: request.socket_evidence },
    {
      ...request,
      socket_evidence: {
        ...request.socket_evidence,
        provider: { ...request.socket_evidence.provider, id: "forged" },
      },
    },
    {
      ...request,
      capture_evidence: {
        ...request.capture_evidence,
        evidence_links: [request.socket_evidence.evidence_id],
      },
    },
  ]) {
    const response = await client.callTool({
      name: operation,
      arguments: arguments_,
    });
    expect(response.isError).toBe(true);
  }
  expect(session.exportEvidenceBundle().records).toEqual([]);
});
