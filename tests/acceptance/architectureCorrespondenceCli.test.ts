import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { architectureCorrespondenceReviewSchema } from "../../src/domain/architecture/architectureCorrespondenceReviewSchema.js";
import { reviewReverseArchitectureCorrespondenceEvidence } from "../../src/application/architecture/ArchitectureCorrespondenceReviewService.js";
import {
  reviewAtlasFixture,
  reviewedReportFixture,
  challengedReportFixture,
} from "../../src/application/architecture/ArchitectureCorrespondence.fixture.js";

const reports = [reviewedReportFixture, challengedReportFixture];

cliTest(
  "reviews contradictory cross-domain reports without asserting relationships",
  async ({ cli }) => {
    const root = await createTestTempDirectory("raa-correspondence-cli-");
    const normalPath = join(root, "normal.json");
    const reversedPath = join(root, "reversed.json");
    const input = { atlas: reviewAtlasFixture, reports };
    await Promise.all([
      writeFile(normalPath, JSON.stringify(input)),
      writeFile(
        reversedPath,
        JSON.stringify({
          ...input,
          reports: [...reports].reverse(),
        }),
      ),
    ]);
    const normal = await cli.run({
      arguments: [
        "review-architecture-correspondences",
        normalPath,
        "--format",
        "json",
      ],
    });
    const reversed = await cli.run({
      arguments: [
        "review-architecture-correspondences",
        reversedPath,
        "--format",
        "json",
      ],
    });
    expect(normal.exitCode, normal.stderr).toBe(0);
    expect(reversed.exitCode, reversed.stderr).toBe(0);
    const output = parseEvidence(normal.json);
    const other = parseEvidence(reversed.json);
    const direct = reviewReverseArchitectureCorrespondenceEvidence(input);
    if (!direct.ok) throw new Error("Valid report fixtures rejected");
    expect(output.evidence_id).toBe(direct.value.evidence_id);
    expect(other.evidence_id).toBe(output.evidence_id);
    const review = architectureCorrespondenceReviewSchema.parse(
      output.normalized_result,
    );
    expect(review.summary).toMatchObject({
      reports: 2,
      claims: 1,
      contested: 1,
      independently_verified: 0,
    });
    expect(review.verified_cross_source_relationships).toEqual([]);
  },
);

cliTest("rejects unlinked and duplicate review Evidence", async ({ cli }) => {
  const root = await createTestTempDirectory("raa-correspondence-reject-");
  const inputPath = join(root, "invalid.json");
  await writeFile(
    inputPath,
    JSON.stringify({
      atlas: reviewAtlasFixture,
      reports: [reviewedReportFixture, reviewedReportFixture],
    }),
  );
  const result = await cli.run({
    arguments: [
      "review-architecture-correspondences",
      inputPath,
      "--format",
      "json",
    ],
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.json).toMatchObject({
    error: "Application workflow failed",
    category: "invalid_input",
  });
});
