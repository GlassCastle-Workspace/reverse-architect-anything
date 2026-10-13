import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, expect, it } from "vitest";

import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { TOOL_EFFECTS } from "../../../src/contracts/toolEffects.js";
import { architectureAtlasEvidenceSources as sources } from "../../../src/application/architecture/ArchitectureAtlas.fixture.js";
import { architectureAtlasSchema } from "../../../src/domain/architecture/architectureAtlasSchema.js";
import { parseEvidence, type Evidence } from "../../../src/domain/evidence.js";

const OPERATION = "build_reverse_architecture_atlas";
const retained = (evidence_id: string) => ({
  kind: "retained-evidence" as const,
  evidence_id,
});
const active: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => {
  await Promise.all(active.splice(0).map((resource) => resource.close()));
});

async function connect() {
  const session = createTestBinarySession(() => {
    throw new Error("Atlas must never launch a target provider");
  });
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "raa-atlas-test", version: "1" });
  active.push(client, server, session);
  const [local, remote] = InMemoryTransport.createLinkedPair();
  await server.connect(remote);
  await client.connect(local);
  return { client, session };
}

it("advertises and executes a strict typed heterogeneous atlas over live MCP transport", async () => {
  const { client, session } = await connect();
  const tool = (await client.listTools()).tools.find(
    ({ name }) => name === OPERATION,
  );
  if (tool === undefined) throw new Error("Atlas MCP operation not registered");
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
  const validateInput = ajv.compile(tool.inputSchema);
  const validateOutput = ajv.compile(
    tool.outputSchema as Parameters<typeof ajv.compile>[0],
  );
  const references = sources.map((s) => retained(s.evidence_id));
  expect(validateInput({ sources })).toBe(true);
  expect(validateInput({ sources: references })).toBe(true);
  expect(validateInput({ sources: [references[0]] })).toBe(false);
  expect(
    validateInput({ sources: [...references, ...references, ...references] }),
  ).toBe(false);
  expect(validateInput({ sources: references, extra: true })).toBe(false);

  const inline = await client.callTool({
    name: OPERATION,
    arguments: { sources },
  });
  expect(inline.isError).not.toBe(true);
  const output = parseEvidence(inline.structuredContent);
  expect(validateOutput(output)).toBe(true);
  expect(output).toMatchObject({
    operation: OPERATION,
    predicate_type: "raa.reverse-architecture-atlas",
    authority: "analyst-inference",
    confidence: "inferred",
    evidence_links: [...sources].map((s) => s.evidence_id).sort(),
  });
  const atlas = architectureAtlasSchema.parse(output.normalized_result);
  expect(atlas.summary).toMatchObject({
    sources: 3,
    application_sources: 1,
    native_sources: 1,
    packet_sources: 1,
    cross_source_relationships: 0,
  });
  expect(atlas.cross_source_relationships).toEqual([]);
  const prior = session.exportEvidenceBundle().records;
  const result = await client.callTool({
    name: OPERATION,
    arguments: { sources: references.reverse() },
  });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toEqual(inline.structuredContent);
  expect(session.exportEvidenceBundle().records).toEqual(prior);
});

it("retained sources are session-bound and expire at close_binary", async () => {
  const own = await connect();
  const foreign = await connect();
  for (const source of sources)
    expect(own.session.recordEvidence(source).ok).toBe(true);
  const request = {
    name: OPERATION,
    arguments: { sources: sources.map((s) => retained(s.evidence_id)) },
  };
  expect(
    parseMcpToolError(await foreign.client.callTool(request)),
  ).toMatchObject({
    error: { details: { reason: "missing" } },
  });
  expect((await own.client.callTool(request)).isError).not.toBe(true);
  expect(
    (await own.client.callTool({ name: "close_binary", arguments: {} }))
      .isError,
  ).not.toBe(true);
  expect(parseMcpToolError(await own.client.callTool(request))).toMatchObject({
    error: { details: { reason: "missing" } },
  });
  expect(
    (
      await own.client.callTool({
        name: OPERATION,
        arguments: { sources },
      })
    ).isError,
  ).not.toBe(true);
});

it("rejects malformed, forged, duplicate or mismatched source kinds", async () => {
  const { client, session } = await connect();
  for (const candidate of [
    [sources[0], sources[0]],
    [
      sources[0],
      { ...sources[1], provider: { ...sources[1].provider, id: "forged" } },
    ],
    [sources[0], { ...sources[1], evidence_links: [] }],
    [
      sources[1],
      { kind: "retained-evidence", evidence_id: `ev_${"f".repeat(64)}` },
    ],
  ]) {
    const result = await client.callTool({
      name: OPERATION,
      arguments: { sources: candidate },
    });
    expect(result.isError).toBe(true);
  }
  expect(session.exportEvidenceBundle().records).toEqual([]);
});
