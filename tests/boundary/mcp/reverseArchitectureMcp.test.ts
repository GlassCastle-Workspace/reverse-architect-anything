import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, expect, it } from "vitest";

import { parseApplicationGraphEvidence } from "../../../src/application/javascript/JavaScriptApplicationEvidenceGraph.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createServer } from "../../../src/server/createServer.js";
import { JAVASCRIPT_FEATURE_TRACE_EXAMPLE } from "../../../src/contracts/javascript/javascriptApplicationWorkflowExamples.js";
import { TOOL_EFFECTS } from "../../../src/contracts/toolEffects.js";
import { parseEvidence, createEvidence } from "../../../src/domain/evidence.js";
import { architectureProjectionSchema } from "../../../src/domain/architecture/architectureProjectionSchema.js";
import type { Evidence } from "../../../src/domain/evidence.js";

const OPERATION = "project_reverse_architecture";
const source = JAVASCRIPT_FEATURE_TRACE_EXAMPLE.application;
const retained = (evidence_id: string) => ({
  kind: "retained-evidence" as const,
  evidence_id,
});

const connected: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => {
  await Promise.all(connected.splice(0).map((resource) => resource.close()));
});

async function connect() {
  const session = createTestBinarySession(() => {
    throw new Error("Architecture projection must not launch a provider");
  });
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "raa-mcp-contract-test", version: "1" });
  connected.push(client, server, session);
  const [local, remote] = InMemoryTransport.createLinkedPair();
  await server.connect(remote);
  await client.connect(local);
  return { client, session };
}

it("advertises valid inline and retained input plus a fully typed Evidence output", async () => {
  const { client, session } = await connect();
  const tool = (await client.listTools()).tools.find(
    ({ name }) => name === OPERATION,
  );
  if (tool === undefined) throw new Error("RAA MCP tool is not registered");

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
  expect(tool.outputSchema).toBeDefined();
  const inputValid = ajv.compile(tool.inputSchema);
  const outputValid = ajv.compile(
    tool.outputSchema as Parameters<typeof ajv.compile>[0],
  );
  expect(inputValid({ application: source })).toBe(true);
  expect(inputValid({ application: retained(source.evidence_id) })).toBe(true);
  expect(inputValid({ application: { evidence_id: source.evidence_id } })).toBe(
    false,
  );

  const inline = await client.callTool({
    name: OPERATION,
    arguments: { application: source },
  });
  expect(inline.isError).not.toBe(true);
  const output = inline.structuredContent as Evidence;
  expect(outputValid(output)).toBe(true);
  expect(parseEvidence(output)).toMatchObject({
    operation: OPERATION,
    predicate_type: "raa.reverse-architecture-projection",
    confidence: "inferred",
    authority: "analyst-inference",
    evidence_links: [source.evidence_id],
    parameters: {
      source_evidence_id: source.evidence_id,
      projection_version: 1,
    },
  });
  const architecture = architectureProjectionSchema.parse(
    output.normalized_result,
  );
  expect(architecture.source_evidence_id).toBe(source.evidence_id);
  const parsedSource = parseApplicationGraphEvidence(source);
  if (!parsedSource.ok)
    throw new Error("Fixture application Evidence is invalid");
  expect(architecture.source_graph_id).toBe(parsedSource.value.graph.graph_id);
  expect(architecture.summary.components).toBeGreaterThan(0);
  expect(architecture.summary.components).toBe(architecture.components.length);
  expect(architecture.summary.relationships).toBe(
    architecture.relationships.length,
  );
  expect(
    architecture.boundary_candidates.every(
      (candidate) => candidate.epistemic_status === "hypothesis",
    ),
  ).toBe(true);

  const before = session.exportEvidenceBundle().records;
  const byReference = await client.callTool({
    name: OPERATION,
    arguments: { application: retained(source.evidence_id) },
  });
  expect(byReference.isError).not.toBe(true);
  expect(byReference.structuredContent).toEqual(inline.structuredContent);
  expect(session.exportEvidenceBundle().records).toEqual(before);
});

it("limits retained evidence to its session and refuses mismatched identities", async () => {
  const first = await connect();
  const foreign = await connect();
  expect(first.session.recordEvidence(source).ok).toBe(true);
  const request = {
    name: OPERATION,
    arguments: { application: retained(source.evidence_id) },
  };

  const missing = await foreign.client.callTool(request);
  expect(parseMcpToolError(missing)).toMatchObject({
    error: {
      details: { evidence_id: source.evidence_id, reason: "missing" },
    },
  });
  expect((await first.client.callTool(request)).isError).not.toBe(true);
  expect(
    (
      await first.client.callTool({
        name: "close_binary",
        arguments: {},
      })
    ).isError,
  ).not.toBe(true);
  expect(parseMcpToolError(await first.client.callTool(request))).toMatchObject(
    {
      error: { details: { reason: "missing" } },
    },
  );

  const inlineAfterClose = await first.client.callTool({
    name: OPERATION,
    arguments: { application: source },
  });
  expect(inlineAfterClose.isError).not.toBe(true);
});

it("rejects invalid producer operations, tampering, and malformed retained references", async () => {
  const { client, session } = await connect();
  const wrongProducer = createEvidence(
    undefined,
    { id: "test-provider", name: "test", version: "1" },
    { operation: "inventory_artifact", parameters: {}, result: {} },
  );
  expect(session.recordEvidence(wrongProducer).ok).toBe(true);

  const wrongOperation = await client.callTool({
    name: OPERATION,
    arguments: { application: retained(wrongProducer.evidence_id) },
  });
  expect(parseMcpToolError(wrongOperation)).toMatchObject({
    error: { code: "invalid_request", category: "invalid_input" },
  });

  const tampered = {
    ...source,
    provider: { ...source.provider, id: "forged" },
  };
  expect(
    (
      await client.callTool({
        name: OPERATION,
        arguments: { application: tampered },
      })
    ).isError,
  ).toBe(true);

  for (const application of [
    { kind: "retained-evidence", evidence_id: "ev_short" },
    { ...retained(source.evidence_id), session_id: "foreign" },
    { evidence_id: source.evidence_id },
  ]) {
    expect(
      (
        await client.callTool({
          name: OPERATION,
          arguments: { application },
        })
      ).isError,
    ).toBe(true);
  }
});
