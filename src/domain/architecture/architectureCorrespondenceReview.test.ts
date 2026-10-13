import { expect, it } from "vitest";

import { buildArchitectureAtlas } from "./architectureAtlas.js";
import { atlasFixtureSources } from "./architectureAtlas.fixture.js";
import {
  architectureCorrespondenceReportSchema,
  type ArchitectureCorrespondenceReport,
} from "./architectureCorrespondenceReportSchema.js";
import { architectureCorrespondenceReviewSchema } from "./architectureCorrespondenceReviewSchema.js";
import { reviewArchitectureCorrespondences } from "./architectureCorrespondenceReview.js";

const atlas = buildArchitectureAtlas(atlasFixtureSources);
const atlasId = `ev_${"a".repeat(64)}`;
const app = atlas.nodes.find((item) => item.domain === "application");
const native = atlas.nodes.find((item) => item.domain === "native");
const packet = atlas.nodes.find((item) => item.domain === "packet");
if (!app || !native || !packet)
  throw new Error("Fixture atlas has missing domains");

const scope = {
  subject_sha256: null,
  process_instance_id: null,
  network_namespace: null,
  connection_id: null,
  sensor_id: null,
  window_start: null,
  window_end: null,
};

const createReport = (
  overrides: Partial<ArchitectureCorrespondenceReport> = {},
): ArchitectureCorrespondenceReport =>
  architectureCorrespondenceReportSchema.parse({
    schema: "RAACorrespondenceReport",
    version: 1,
    atlas_evidence_id: atlasId,
    from_atlas_node_id: app.atlas_node_id,
    to_atlas_node_id: native.atlas_node_id,
    relation: "application-loads-native",
    polarity: "supports",
    scope,
    rationale:
      "Analyst interpretation; independent loader instrumentation missing",
    ...overrides,
  });

const wrap = (
  report: ArchitectureCorrespondenceReport,
  id: string = `ev_${"b".repeat(64)}`,
) => ({ report_evidence_id: id, report });

it("preserves an unverified report with explicit missing verification criteria", () => {
  const result = reviewArchitectureCorrespondences(atlasId, atlas, [
    wrap(createReport()),
  ]);
  expect(architectureCorrespondenceReviewSchema.parse(result)).toEqual(result);
  expect(result.summary).toEqual({
    reports: 1,
    claims: 1,
    reported_unverified: 1,
    contested: 0,
    challenge_only: 0,
    independently_verified: 0,
  });
  expect(result.verified_cross_source_relationships).toEqual([]);
  expect(result.claims[0]).toMatchObject({
    from_domain: "application",
    to_domain: "native",
    relation: "application-loads-native",
    review_status: "reported-unverified",
    verification_state: "no-independent-verification",
  });
  expect(result.claims[0]?.missing_verification_requirements).toContain(
    "process instance identity, including reuse-safe start context",
  );
});

it("records opposing reports with the same scope as contested, order independently", () => {
  const support = wrap(createReport(), `ev_${"1".repeat(64)}`);
  const challenge = wrap(
    createReport({ polarity: "challenges" }),
    `ev_${"2".repeat(64)}`,
  );
  const first = reviewArchitectureCorrespondences(atlasId, atlas, [
    support,
    challenge,
  ]);
  const second = reviewArchitectureCorrespondences(atlasId, atlas, [
    challenge,
    support,
  ]);
  expect(first).toEqual(second);
  expect(first.summary).toMatchObject({
    claims: 1,
    contested: 1,
    independently_verified: 0,
  });
  expect(first.claims[0]?.supporting_report_evidence_ids).toEqual([
    support.report_evidence_id,
  ]);
  expect(first.claims[0]?.challenging_report_evidence_ids).toEqual([
    challenge.report_evidence_id,
  ]);
});

it("keeps different sensor/vantage scopes separate instead of manufacturing a contradiction", () => {
  const a = wrap(
    createReport({ scope: { ...scope, sensor_id: "sensor-A" } }),
    `ev_${"1".repeat(64)}`,
  );
  const b = wrap(
    createReport({
      polarity: "challenges",
      scope: { ...scope, sensor_id: "sensor-B" },
    }),
    `ev_${"2".repeat(64)}`,
  );
  const result = reviewArchitectureCorrespondences(atlasId, atlas, [a, b]);
  expect(result.summary).toMatchObject({
    claims: 2,
    contested: 0,
    reported_unverified: 1,
    challenge_only: 1,
  });
});

it("requires the correct direction and different source domains", () => {
  expect(() =>
    reviewArchitectureCorrespondences(atlasId, atlas, [
      wrap(
        createReport({
          from_atlas_node_id: native.atlas_node_id,
          to_atlas_node_id: app.atlas_node_id,
        }),
      ),
    ]),
  ).toThrow(/direction or domain/u);
  const anotherNative = atlas.nodes.find(
    (item) =>
      item.domain === "native" && item.atlas_node_id !== native.atlas_node_id,
  );
  if (!anotherNative) throw new Error("Missing native fixture peer");
  expect(() =>
    reviewArchitectureCorrespondences(atlasId, atlas, [
      wrap(
        createReport({
          from_atlas_node_id: native.atlas_node_id,
          to_atlas_node_id: anotherNative.atlas_node_id,
        }),
      ),
    ]),
  ).toThrow(/distinct source domains/u);
  expect(() =>
    reviewArchitectureCorrespondences(atlasId, atlas, [
      wrap(createReport({ to_atlas_node_id: `raa_node_${"f".repeat(64)}` })),
    ]),
  ).toThrow(/absent atlas node/u);
});

it("rejects an unrelated digest and duplicate report identities", () => {
  const digest = scope.subject_sha256;
  expect(digest).toBeNull();
  expect(() =>
    reviewArchitectureCorrespondences(atlasId, atlas, [
      wrap(
        createReport({ scope: { ...scope, subject_sha256: "f".repeat(64) } }),
      ),
    ]),
  ).toThrow(/absent from both source scopes/u);
  expect(() =>
    reviewArchitectureCorrespondences(atlasId, atlas, [
      wrap(createReport()),
      wrap(createReport({ polarity: "challenges" })),
    ]),
  ).toThrow(/Duplicate correspondence Evidence/u);
});

it("requires a properly bounded observation window when supplied", () => {
  const report = createReport({
    from_atlas_node_id: native.atlas_node_id,
    to_atlas_node_id: packet.atlas_node_id,
    relation: "native-emits-packet",
    scope: {
      ...scope,
      window_start: "2026-10-13T09:00:00Z",
      window_end: "2026-10-13T09:01:00Z",
    },
  });
  const result = reviewArchitectureCorrespondences(atlasId, atlas, [
    wrap(report),
  ]);
  expect(result.claims[0]?.missing_verification_requirements).toContain(
    "network namespace or equivalent host/sensor scope",
  );
  expect(result.claims[0]?.verification_state).toBe(
    "no-independent-verification",
  );
  expect(
    architectureCorrespondenceReportSchema.safeParse({
      ...report,
      scope: {
        ...report.scope,
        window_start: "2026-10-13T10:00:00Z",
        window_end: "2026-10-13T09:00:00Z",
      },
    }).success,
  ).toBe(false);
});

it("does not convert multiple supporting reporters into independently verified relationships", () => {
  const report = createReport({
    scope: { ...scope, sensor_id: "test-sensor" },
  });
  const inputs = [
    wrap(report, `ev_${"3".repeat(64)}`),
    wrap(report, `ev_${"4".repeat(64)}`),
  ];
  const review = reviewArchitectureCorrespondences(atlasId, atlas, inputs);
  expect(review.summary).toMatchObject({
    reports: 2,
    claims: 1,
    reported_unverified: 1,
    independently_verified: 0,
  });
  expect(review.verified_cross_source_relationships).toEqual([]);
  expect(review.claims[0]?.supporting_report_evidence_ids).toHaveLength(2);
});
