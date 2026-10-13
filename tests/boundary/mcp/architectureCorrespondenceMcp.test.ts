import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, expect, it } from "vitest";

import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { TOOL_EFFECTS } from "../../../src/contracts/toolEffects.js";
import { architectureCorrespondenceReviewSchema } from "../../../src/domain/architecture/architectureCorrespondenceReviewSchema.js";
import { parseEvidence, type Evidence } from "../../../src/domain/evidence.js";
import {
  reviewAtlasFixture,
  reviewedReportFixture,
  challengedReportFixture,
} from "../../../src/application/architecture/ArchitectureCorrespondence.fixture.js";

const OPERATION = "review_architecture_correspondences";
const reports = [reviewedReportFixture, challengedReportFixture];
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
    throw new Error("Correspondence review must not open providers");
  });
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "raa-correspondence-test", version: "1" });
  active.push(client, server, session);
  const [local, remote] = InMemoryTransport.createLinkedPair();
  await server.connect(remote);
  await client.connect(local);
  return { client, session };
}

it("advertises typed, source-preserving, unverified correspondence results", async () => {
  const { client, session } = await connect();
  const tool = (await client.listTools()).tools.find(
    ({ name }) => name === OPERATION,
  );
  if (!tool) throw new Error("Correspondence MCP tool missing");
  expect(TOOL_EFFECTS[OPERATION]).toMatchObject({
    mutatesTarget: false,
    mutatesSession: true,
    launchesProcess: false,
    writesFilesystem: false,
    accessesNetwork: false,
    executesForeignCode: false,
  });
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(tool.inputSchema)).toBe(true);
  const inputCheck = ajv.compile(tool.inputSchema);
  const outputCheck = ajv.compile(
    tool.outputSchema as Parameters<typeof ajv.compile>[0],
  );
  const inline = { atlas: reviewAtlasFixture, reports };
  const refs = {
    atlas: retained(reviewAtlasFixture.evidence_id),
    reports: reports.map((item) => retained(item.evidence_id)),
  };
  expect(inputCheck(inline)).toBe(true);
  expect(inputCheck(refs)).toBe(true);
  expect(inputCheck({ atlas: reviewAtlasFixture, reports: [] })).toBe(false);
  const first = await client.callTool({ name: OPERATION, arguments: inline });
  expect(first.isError).not.toBe(true);
  const evidence = parseEvidence(first.structuredContent);
  expect(outputCheck(evidence)).toBe(true);
  const review = architectureCorrespondenceReviewSchema.parse(
    evidence.normalized_result,
  );
  expect(review.summary).toMatchObject({
    claims: 1,
    contested: 1,
    independently_verified: 0,
  });
  expect(review.verified_cross_source_relationships).toEqual([]);
  expect(review.claims[0]?.verification_state).toBe(
    "no-independent-verification",
  );
  const before = session.exportEvidenceBundle().records;
  const referenced = await client.callTool({
    name: OPERATION,
    arguments: refs,
  });
  expect(referenced.isError).not.toBe(true);
  expect(referenced.structuredContent).toEqual(first.structuredContent);
  expect(session.exportEvidenceBundle().records).toEqual(before);
});

it("rejects cross-session references and expires them with the current session", async () => {
  const own = await connect();
  const foreign = await connect();
  for (const evidence of [reviewAtlasFixture, ...reports])
    expect(own.session.recordEvidence(evidence).ok).toBe(true);
  const request = {
    name: OPERATION,
    arguments: {
      atlas: retained(reviewAtlasFixture.evidence_id),
      reports: reports.map((item) => retained(item.evidence_id)),
    },
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
        arguments: { atlas: reviewAtlasFixture, reports },
      })
    ).isError,
  ).not.toBe(true);
});

it("rejects forged reports and duplicates without recording a fictitious linkage", async () => {
  const { client, session } = await connect();
  for (const candidate of [
    [reviewedReportFixture, reviewedReportFixture],
    [{ ...reviewedReportFixture, evidence_links: [] }],
    [
      {
        ...reviewedReportFixture,
        provider: { ...reviewedReportFixture.provider, id: "forged" },
      },
    ],
    [{ ...reviewedReportFixture, operation: "another-operation" }],
  ]) {
    const output = await client.callTool({
      name: OPERATION,
      arguments: { atlas: reviewAtlasFixture, reports: candidate },
    });
    expect(output.isError).toBe(true);
  }
  expect(session.exportEvidenceBundle().records).toEqual([]);
});
