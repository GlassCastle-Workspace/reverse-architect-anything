import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { buildReverseArchitectureAtlasEvidence } from "../../src/application/architecture/ArchitectureAtlasService.js";
import { projectReverseArchitectureEvidence } from "../../src/application/architecture/ArchitectureProjectionService.js";
import { architectureAtlasEvidenceSources as sources } from "../../src/application/architecture/ArchitectureAtlas.fixture.js";
import { architectureAtlasSchema } from "../../src/domain/architecture/architectureAtlasSchema.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "builds an evidence-linked heterogeneous atlas through the public CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("raa-atlas-cli-");
    const forwardPath = join(root, "atlas.json");
    const reversedPath = join(root, "reversed.json");
    await Promise.all([
      writeFile(forwardPath, JSON.stringify({ sources })),
      writeFile(
        reversedPath,
        JSON.stringify({ sources: [...sources].reverse() }),
      ),
    ]);
    const first = await cli.run({
      arguments: [
        "build-reverse-architecture-atlas",
        forwardPath,
        "--format",
        "json",
      ],
    });
    const second = await cli.run({
      arguments: [
        "build-reverse-architecture-atlas",
        reversedPath,
        "--format",
        "json",
      ],
    });
    expect(first.exitCode, first.stderr).toBe(0);
    expect(second.exitCode, second.stderr).toBe(0);
    const output = parseEvidence(first.json);
    const reversed = parseEvidence(second.json);
    const direct = buildReverseArchitectureAtlasEvidence({ sources });
    if (!direct.ok)
      throw new Error("Valid source records unexpectedly rejected");
    expect(output.evidence_id).toBe(direct.value.evidence_id);
    expect(reversed.evidence_id).toBe(output.evidence_id);
    expect(output.evidence_links).toEqual(
      [...sources].map((s) => s.evidence_id).sort(),
    );
    const atlas = architectureAtlasSchema.parse(output.normalized_result);
    expect(atlas.summary).toMatchObject({
      sources: 3,
      application_sources: 1,
      native_sources: 1,
      packet_sources: 1,
      cross_source_relationships: 0,
    });
    expect(atlas.cross_source_relationships).toEqual([]);
    expect(atlas.nodes.some((node) => node.domain === "packet")).toBe(true);
    expect(atlas.nodes.some((node) => node.domain === "native")).toBe(true);
    expect(atlas.nodes.some((node) => node.domain === "application")).toBe(
      true,
    );
  },
);

cliTest("rejects duplicate and incomplete source Evidence", async ({ cli }) => {
  const root = await createTestTempDirectory("raa-atlas-reject-");
  const path = join(root, "invalid.json");
  await writeFile(path, JSON.stringify({ sources: [sources[0], sources[0]] }));
  const result = await cli.run({
    arguments: ["build-reverse-architecture-atlas", path, "--format", "json"],
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.json).toMatchObject({
    error: "Application workflow failed",
    category: "invalid_input",
  });
});

cliTest(
  "combines real REA JavaScript acquisition with synthetic native/packet sources",
  async ({ cli }) => {
    const analysis = await cli.run({
      arguments: [
        "analyze-javascript-application",
        "scripts/fixtures/javascript-recovery/code-split",
        "--format",
        "json",
      ],
      timeoutMs: 20_000,
    });
    expect(analysis.exitCode, analysis.stderr).toBe(0);
    const acquired = parseEvidence(analysis.json);
    expect(acquired.operation).toBe("analyze_javascript_application");
    const projected = projectReverseArchitectureEvidence({
      application: acquired,
    });
    if (!projected.ok)
      throw new Error("REA acquisition could not be projected");

    const input = {
      sources: [projected.value, sources[1]!, sources[2]!],
    };
    const root = await createTestTempDirectory("raa-atlas-real-acquisition-");
    const inputPath = join(root, "atlas-input.json");
    await writeFile(inputPath, JSON.stringify(input));
    const executed = await cli.run({
      arguments: [
        "build-reverse-architecture-atlas",
        inputPath,
        "--format",
        "json",
      ],
      timeoutMs: 20_000,
    });
    expect(executed.exitCode, executed.stderr).toBe(0);
    const atlasEvidence = parseEvidence(executed.json);
    const atlas = architectureAtlasSchema.parse(
      atlasEvidence.normalized_result,
    );
    expect(atlas.summary).toMatchObject({
      sources: 3,
      application_sources: 1,
      native_sources: 1,
      packet_sources: 1,
      cross_source_relationships: 0,
    });
    const realSource = atlas.sources.find(
      (source) => source.projection_evidence_id === projected.value.evidence_id,
    );
    expect(realSource).toMatchObject({
      source_kind: "application",
      source_evidence_id: acquired.evidence_id,
    });
    expect(
      atlas.nodes.some(
        (node) =>
          node.domain === "application" &&
          node.projection_evidence_id === projected.value.evidence_id,
      ),
    ).toBe(true);
    expect(atlas.cross_source_relationships).toEqual([]);
  },
);
