import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, expect, it } from "vitest";

import { projectReverseArchitectureEvidence } from "../../../src/application/architecture/ArchitectureProjectionService.js";
import { JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE } from "../../../src/contracts/javascript/javascriptApplicationWorkflowExamples.js";
import { TOOL_EFFECTS } from "../../../src/contracts/toolEffects.js";
import { architectureFederationSchema } from "../../../src/domain/architecture/architectureFederationSchema.js";
import { parseEvidence, type Evidence } from "../../../src/domain/evidence.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

const OPERATION = "federate_reverse_architecture";
const pair = JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE;
const projected = [
  projectReverseArchitectureEvidence({ application: pair.left }),
  projectReverseArchitectureEvidence({ application: pair.right }),
];
if (projected.some((item) => !item.ok))
  throw new Error("Projection test setup failed");

const sourceEvidence = projected.map((result) => {
  if (!result.ok) throw new Error("Projection result missing");
  return result.value;
});
const references = sourceEvidence.map(({ evidence_id }) => ({
  kind: "retained-evidence" as const,
  evidence_id,
}));

const closeables: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => {
  await Promise.all(closeables.splice(0).map((item) => item.close()));
});

async function connect() {
  const session = createTestBinarySession(() => {
    throw new Error("Federation must not start any target provider");
  });
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "raa-federation-test", version: "1" });
  closeables.push(client, server, session);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, session };
}

it("exposes a schema-valid source-preserving federation over native MCP", async () => {
  const { client, session } = await connect();
  const tool = (await client.listTools()).tools.find(
    (item) => item.name === OPERATION,
  );
  if (tool === undefined)
    throw new Error("Federation contract is not registered");
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(tool.inputSchema)).toBe(true);
  const validateInput = ajv.compile(tool.inputSchema);
  const validateOutput = ajv.compile(
    tool.outputSchema as Parameters<typeof ajv.compile>[0],
  );
  expect(validateInput({ projections: sourceEvidence })).toBe(true);
  expect(validateInput({ projections: references })).toBe(true);
  expect(validateInput({ projections: [references[0]] })).toBe(false);
  expect(TOOL_EFFECTS[OPERATION]).toMatchObject({
    mutatesTarget: false,
    mutatesSession: true,
    writesFilesystem: false,
    launchesProcess: false,
    accessesNetwork: false,
    executesForeignCode: false,
  });

  const inline = await client.callTool({
    name: OPERATION,
    arguments: { projections: sourceEvidence },
  });
  expect(inline.isError).not.toBe(true);
  const result = inline.structuredContent as Evidence;
  expect(validateOutput(result)).toBe(true);
  expect(parseEvidence(result)).toMatchObject({
    operation: OPERATION,
    predicate_type: "raa.reverse-architecture-federation",
    provider: { id: "raa-architecture-federation" },
  });
  const union = architectureFederationSchema.parse(result.normalized_result);
  expect(union.summary.source_projections).toBe(2);
  expect(union.sources.map((item) => item.source_kind).sort()).toEqual([
    "static-application",
    "static-runtime-reconciliation",
  ]);
  expect(new Set(union.components.map((item) => item.federated_id)).size).toBe(
    union.components.length,
  );
  const before = session.exportEvidenceBundle().records;
  const retained = await client.callTool({
    name: OPERATION,
    arguments: { projections: references },
  });
  expect(retained.isError).not.toBe(true);
  expect(retained.structuredContent).toEqual(inline.structuredContent);
  expect(session.exportEvidenceBundle().records).toEqual(before);
});

it("rejects foreign session references and expires them on session close", async () => {
  const own = await connect();
  const foreign = await connect();
  for (const evidence of sourceEvidence)
    expect(own.session.recordEvidence(evidence).ok).toBe(true);
  const request = { name: OPERATION, arguments: { projections: references } };

  const blocked = await foreign.client.callTool(request);
  expect(parseMcpToolError(blocked)).toMatchObject({
    error: { details: { reason: "missing" } },
  });
  expect((await own.client.callTool(request)).isError).not.toBe(true);
  expect(
    (
      await own.client.callTool({
        name: "close_binary",
        arguments: {},
      })
    ).isError,
  ).not.toBe(true);
  expect(parseMcpToolError(await own.client.callTool(request))).toMatchObject({
    error: { details: { reason: "missing" } },
  });
});

it("fails closed on duplicate, forged and mismatched source Evidence", async () => {
  const { client } = await connect();
  for (const projections of [
    [sourceEvidence[0], sourceEvidence[0]],
    [references[0], references[0]],
    [sourceEvidence[0], { ...sourceEvidence[1], evidence_links: [] }],
    [
      sourceEvidence[0],
      {
        ...sourceEvidence[1],
        provider: { ...sourceEvidence[1]?.provider, id: "unknown-producer" },
      },
    ],
  ]) {
    const response = await client.callTool({
      name: OPERATION,
      arguments: { projections },
    });
    expect(response.isError).toBe(true);
  }
});
