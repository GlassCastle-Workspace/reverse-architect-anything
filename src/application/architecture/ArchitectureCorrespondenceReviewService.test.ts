import { expect, it } from "vitest";

import { createEvidence, parseEvidence } from "../../domain/evidence.js";
import { architectureCorrespondenceReviewSchema } from "../../domain/architecture/architectureCorrespondenceReviewSchema.js";
import {
  reviewAtlasFixture,
  reviewedReportFixture,
  challengedReportFixture,
  createReportedCorrespondence,
} from "./ArchitectureCorrespondence.fixture.js";
import { reviewReverseArchitectureCorrespondenceEvidence } from "./ArchitectureCorrespondenceReviewService.js";

const sources = [reviewedReportFixture, challengedReportFixture];

it("returns content-addressed unverified and contested claims with full source provenance", () => {
  const first = reviewReverseArchitectureCorrespondenceEvidence({
    atlas: reviewAtlasFixture,
    reports: sources,
  });
  const reversed = reviewReverseArchitectureCorrespondenceEvidence({
    atlas: reviewAtlasFixture,
    reports: [...sources].reverse(),
  });
  if (!first.ok || !reversed.ok)
    throw new Error("Valid report inputs rejected");
  expect(parseEvidence(first.value)).toEqual(first.value);
  expect(first.value.evidence_id).toBe(reversed.value.evidence_id);
  expect(first.value).toMatchObject({
    operation: "review_architecture_correspondences",
    predicate_type: "raa.cross-domain-correspondence-review",
    confidence: "inferred",
    authority: "analyst-inference",
    evidence_links: [
      reviewAtlasFixture.evidence_id,
      ...sources.map((x) => x.evidence_id),
    ].sort(),
  });
  const review = architectureCorrespondenceReviewSchema.parse(
    first.value.normalized_result,
  );
  expect(review.summary).toMatchObject({
    reports: 2,
    claims: 1,
    contested: 1,
    independently_verified: 0,
  });
  expect(review.claims[0]?.verification_state).toBe(
    "no-independent-verification",
  );
  expect(review.verified_cross_source_relationships).toEqual([]);
});

it("rejects report digest tampering, wrong producer, and wrong atlas", () => {
  for (const candidate of [
    {
      ...reviewedReportFixture,
      provider: { ...reviewedReportFixture.provider, id: "forged" },
    },
    { ...reviewedReportFixture, operation: "inspect_packet_capture" },
    { ...reviewedReportFixture, evidence_links: [] },
    {
      ...reviewedReportFixture,
      parameters: {
        ...reviewedReportFixture.parameters,
        from_atlas_node_id: `raa_node_${"f".repeat(64)}`,
      },
    },
  ]) {
    expect(
      reviewReverseArchitectureCorrespondenceEvidence({
        atlas: reviewAtlasFixture,
        reports: [candidate],
      }).ok,
    ).toBe(false);
  }
  expect(
    reviewReverseArchitectureCorrespondenceEvidence({
      atlas: {
        ...reviewAtlasFixture,
        provider: { ...reviewAtlasFixture.provider, id: "forged" },
      },
      reports: [reviewedReportFixture],
    }).ok,
  ).toBe(false);
});

it("rejects duplicate Evidence and unsupported or internally inconsistent reports", () => {
  expect(
    reviewReverseArchitectureCorrespondenceEvidence({
      atlas: reviewAtlasFixture,
      reports: [reviewedReportFixture, reviewedReportFixture],
    }).ok,
  ).toBe(false);
  expect(
    reviewReverseArchitectureCorrespondenceEvidence({
      atlas: reviewAtlasFixture,
      reports: [],
    }).ok,
  ).toBe(false);
  const badSource = createEvidence(
    undefined,
    {
      id: "fixture-other",
      name: "Other",
      version: "1",
    },
    {
      operation: "inventory_artifact",
      parameters: {},
      result: {},
      confidence: "inferred",
      authority: "analyst-inference",
    },
  );
  expect(
    reviewReverseArchitectureCorrespondenceEvidence({
      atlas: reviewAtlasFixture,
      reports: [badSource],
    }).ok,
  ).toBe(false);
  const wrongDirection = createReportedCorrespondence({
    from: "native",
    to: "application",
  });
  expect(
    reviewReverseArchitectureCorrespondenceEvidence({
      atlas: reviewAtlasFixture,
      reports: [wrongDirection],
    }).ok,
  ).toBe(false);
});

it("keeps different reporting scopes separate and never self-certifies a verified link", () => {
  const inputs = [
    createReportedCorrespondence({ sensor_id: "sensor-a" }),
    createReportedCorrespondence({
      sensor_id: "sensor-b",
      polarity: "challenges",
    }),
  ];
  const result = reviewReverseArchitectureCorrespondenceEvidence({
    atlas: reviewAtlasFixture,
    reports: inputs,
  });
  if (!result.ok)
    throw new Error("Distinct scoped reports unexpectedly rejected");
  const review = architectureCorrespondenceReviewSchema.parse(
    result.value.normalized_result,
  );
  expect(review.summary).toMatchObject({
    claims: 2,
    contested: 0,
    reported_unverified: 1,
    challenge_only: 1,
    independently_verified: 0,
  });
});
