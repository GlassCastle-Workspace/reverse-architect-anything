import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, expect, it } from "vitest";

import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { TOOL_EFFECTS } from "../../../src/contracts/toolEffects.js";
import {
  NATIVE_TRACE_EVIDENCE,
  PACKET_CAPTURE_EVIDENCE,
} from "../../../src/domain/architecture/architectureObservationSurface.fixture.js";
import { architectureObservationSurfaceSchema } from "../../../src/domain/architecture/architectureObservationSurfaceSchema.js";
import { parseEvidence, type Evidence } from "../../../src/domain/evidence.js";

const OPERATION = "project_observation_architecture";
const sourceCases = [
  { source_kind: "native-trace" as const, evidence: NATIVE_TRACE_EVIDENCE },
  { source_kind: "packet-capture" as const, evidence: PACKET_CAPTURE_EVIDENCE },
];

const active: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => {
  await Promise.all(active.splice(0).map((resource) => resource.close()));
});

async function connect() {
  const session = createTestBinarySession(() => {
    throw new Error(
      "Architecture Evidence projection must not launch a provider",
    );
  });
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "raa-observation-mcp-test", version: "1" });
  active.push(client, server, session);
  const [local, remote] = InMemoryTransport.createLinkedPair();
  await server.connect(remote);
  await client.connect(local);
  return { client, session };
}

it("advertises valid MCP schema and returns source-linked native and network Evidence", async () => {
  const { client, session } = await connect();
  const tool = (await client.listTools()).tools.find(
    ({ name }) => name === OPERATION,
  );
  if (tool === undefined)
    throw new Error("RAA observation MCP tool not registered");

  expect(TOOL_EFFECTS[OPERATION]).toMatchObject({
    mutatesTarget: false,
    mutatesSession: true,
    writesFilesystem: false,
    launchesProcess: false,
    accessesNetwork: false,
    executesForeignCode: false,
  });
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(tool.inputSchema)).toBe(true);
  const validInput = ajv.compile(tool.inputSchema);
  const validOutput = ajv.compile(
    tool.outputSchema as Parameters<typeof ajv.compile>[0],
  );

  for (const input of sourceCases) {
    expect(validInput(input)).toBe(true);
    const reference = {
      source_kind: input.source_kind,
      evidence: {
        kind: "retained-evidence",
        evidence_id: input.evidence.evidence_id,
      },
    };
    expect(validInput(reference)).toBe(true);

    const inline = await client.callTool({
      name: OPERATION,
      arguments: input,
    });
    expect(inline.isError).not.toBe(true);
    const record = parseEvidence(inline.structuredContent);
    expect(validOutput(record)).toBe(true);
    expect(record.evidence_links).toEqual([input.evidence.evidence_id]);
    expect(record).toMatchObject({
      operation: OPERATION,
      authority: "analyst-inference",
      confidence: "inferred",
      predicate_type: "raa.observation-architecture-surface",
    });
    const surface = architectureObservationSurfaceSchema.parse(
      record.normalized_result,
    );
    expect(surface.source_kind).toBe(input.source_kind);
    expect(surface.source_evidence_id).toBe(input.evidence.evidence_id);

    const recordsBefore = session.exportEvidenceBundle().records;
    const byReference = await client.callTool({
      name: OPERATION,
      arguments: reference,
    });
    expect(byReference.isError).not.toBe(true);
    expect(byReference.structuredContent).toEqual(inline.structuredContent);
    expect(session.exportEvidenceBundle().records).toEqual(recordsBefore);
  }
});

it("does not resolve another session's Evidence or expired references", async () => {
  const first = await connect();
  const second = await connect();
  const reference = {
    source_kind: "native-trace",
    evidence: {
      kind: "retained-evidence",
      evidence_id: NATIVE_TRACE_EVIDENCE.evidence_id,
    },
  };
  expect(first.session.recordEvidence(NATIVE_TRACE_EVIDENCE).ok).toBe(true);
  const foreign = await second.client.callTool({
    name: OPERATION,
    arguments: reference,
  });
  expect(parseMcpToolError(foreign)).toMatchObject({
    error: { details: { reason: "missing" } },
  });

  expect(
    (
      await first.client.callTool({
        name: OPERATION,
        arguments: reference,
      })
    ).isError,
  ).not.toBe(true);
  expect(
    (
      await first.client.callTool({
        name: "close_binary",
        arguments: {},
      })
    ).isError,
  ).not.toBe(true);
  expect(
    parseMcpToolError(
      await first.client.callTool({
        name: OPERATION,
        arguments: reference,
      }),
    ),
  ).toMatchObject({
    error: { details: { reason: "missing" } },
  });

  expect(
    (
      await first.client.callTool({
        name: OPERATION,
        arguments: sourceCases[0],
      })
    ).isError,
  ).not.toBe(true);
});

it("rejects invalid source producer, forgery, malformed requests, and family mismatch", async () => {
  const { client, session } = await connect();
  for (const input of [
    {
      source_kind: "native-trace",
      evidence: {
        ...NATIVE_TRACE_EVIDENCE,
        operation: "another_operation",
      },
    },
    {
      source_kind: "native-trace",
      evidence: {
        ...NATIVE_TRACE_EVIDENCE,
        provider: {
          ...NATIVE_TRACE_EVIDENCE.provider,
          id: "forged",
        },
      },
    },
    {
      source_kind: "native-trace",
      evidence: PACKET_CAPTURE_EVIDENCE,
    },
    {
      source_kind: "packet-capture",
      evidence: NATIVE_TRACE_EVIDENCE,
    },
    {
      source_kind: "packet-capture",
      evidence: { kind: "retained-evidence", evidence_id: "ev_bad" },
    },
  ]) {
    expect(
      (
        await client.callTool({
          name: OPERATION,
          arguments: input,
        })
      ).isError,
    ).toBe(true);
  }

  const withoutSource = await client.callTool({
    name: OPERATION,
    arguments: {
      source_kind: "native-trace",
      evidence: {
        kind: "retained-evidence",
        evidence_id: NATIVE_TRACE_EVIDENCE.evidence_id,
      },
    },
  });
  expect(withoutSource.isError).toBe(true);
  expect(session.exportEvidenceBundle().records).toEqual([]);
});
