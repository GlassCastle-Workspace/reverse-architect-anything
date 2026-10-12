import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { projectReverseArchitectureEvidence } from "../../src/application/architecture/ArchitectureProjectionService.js";
import { federateReverseArchitectureEvidence } from "../../src/application/architecture/ArchitectureFederationService.js";
import { JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE } from "../../src/contracts/javascript/javascriptApplicationWorkflowExamples.js";
import { architectureFederationSchema } from "../../src/domain/architecture/architectureFederationSchema.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

const raw = JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE;
const left = projectReverseArchitectureEvidence({ application: raw.left });
const right = projectReverseArchitectureEvidence({ application: raw.right });
if (!left.ok || !right.ok)
  throw new Error("Valid fixture projection Evidence was rejected");
const sources = [left.value, right.value];

cliTest(
  "federates two source-scoped RAA Evidence records through the public CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("raa-federation-cli-");
    const directPath = join(root, "direct.json");
    const reversePath = join(root, "reverse.json");
    const duplicatePath = join(root, "duplicate.json");
    await Promise.all([
      writeFile(directPath, JSON.stringify({ projections: sources })),
      writeFile(
        reversePath,
        JSON.stringify({ projections: [...sources].reverse() }),
      ),
      writeFile(
        duplicatePath,
        JSON.stringify({ projections: [sources[0], sources[0]] }),
      ),
    ]);

    const first = await cli.run({
      arguments: [
        "federate-reverse-architecture",
        directPath,
        "--format",
        "json",
      ],
    });
    const reversed = await cli.run({
      arguments: [
        "federate-reverse-architecture",
        reversePath,
        "--format",
        "json",
      ],
    });
    expect(first.exitCode, first.stderr).toBe(0);
    expect(reversed.exitCode, reversed.stderr).toBe(0);

    const output = parseEvidence(first.json);
    const other = parseEvidence(reversed.json);
    const direct = federateReverseArchitectureEvidence({
      projections: sources,
    });
    if (!direct.ok)
      throw new Error("Valid federation source Evidence rejected");
    expect(output.evidence_id).toBe(other.evidence_id);
    expect(output.evidence_id).toBe(direct.value.evidence_id);
    expect(output.normalized_result).toEqual(other.normalized_result);
    expect(
      architectureFederationSchema.parse(output.normalized_result),
    ).toMatchObject({
      schema: "ReverseArchitectureFederation",
      summary: { source_projections: 2 },
    });

    const refused = await cli.run({
      arguments: [
        "federate-reverse-architecture",
        duplicatePath,
        "--format",
        "json",
      ],
    });
    expect(refused.exitCode).not.toBe(0);
    expect(refused.json).toMatchObject({
      error: "Application workflow failed",
      category: "invalid_input",
    });
  },
);
