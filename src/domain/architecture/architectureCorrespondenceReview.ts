import { digestCanonicalValue } from "../canonicalDigest.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import type { ArchitectureAtlas } from "./architectureAtlasSchema.js";
import type { ArchitectureCorrespondenceReport } from "./architectureCorrespondenceReportSchema.js";
import type { ArchitectureCorrespondenceReview } from "./architectureCorrespondenceReviewSchema.js";

/** One authenticated report; reporting is not independent verification. */
export interface CorrespondenceReportSource {
  readonly report_evidence_id: string;
  readonly report: ArchitectureCorrespondenceReport;
}

const byCodePoint = (items: readonly string[]): string[] =>
  [...new Set(items)].sort(compareUnicodeCodePoints);

const LIMITATION =
  "A semantic Evidence digest and a report's claimed provider are not digital signatures or independent verification. This review does not attest process ownership, socket attribution, binary loading, observed causation, architectural identity, or trust boundaries.";

const DISCONFIRMATION: Record<
  ArchitectureCorrespondenceReport["relation"],
  string
> = {
  "application-loads-native":
    "Can an authorized loader trace from the exact process instance and artifact show the module was not loaded, or identify a different module?",
  "native-emits-packet":
    "Can process/socket instrumentation and a sensor-captured frame disprove the claimed process, namespace, connection, or timestamp attribution?",
  "application-emits-packet":
    "Can an authorized runtime/process-to-socket trace and network capture disprove attribution to the claimed application instance?",
};

const requirements = (report: ArchitectureCorrespondenceReport): string[] => {
  const missing: string[] = [];
  const scope = report.scope;
  if (scope.subject_sha256 === null)
    missing.push(
      "artifact digest bound to the reported process or application",
    );
  if (scope.process_instance_id === null)
    missing.push(
      "process instance identity, including reuse-safe start context",
    );
  if (report.relation !== "application-loads-native") {
    if (scope.network_namespace === null)
      missing.push("network namespace or equivalent host/sensor scope");
    if (scope.connection_id === null)
      missing.push("connection or socket instance identifier");
    if (scope.sensor_id === null)
      missing.push("network sensor/vantage identifier");
    if (scope.window_start === null || scope.window_end === null)
      missing.push("bounded observation window");
  }
  return missing;
};

type Claim = ArchitectureCorrespondenceReview["claims"][number];

/**
 * Structurally review externally reported correspondences.
 *
 * This never turns a report, even a self-described "observed" one, into an
 * independently verified cross-source relationship. Verified relationships
 * require a separately designed authority and instrumentation verifier.
 */
export const reviewArchitectureCorrespondences = (
  atlasEvidenceId: string,
  atlas: ArchitectureAtlas,
  reports: readonly CorrespondenceReportSource[],
): ArchitectureCorrespondenceReview => {
  if (reports.length < 1 || reports.length > 32)
    throw new TypeError("Correspondence review needs 1–32 source reports");
  const ids = new Set<string>();
  const nodes = new Map(atlas.nodes.map((node) => [node.atlas_node_id, node]));
  if (nodes.size !== atlas.nodes.length)
    throw new TypeError(
      "Atlas contains duplicate source-scoped node identities",
    );

  const claims = new Map<string, Claim>();
  const scopeReports = [...reports].sort((a, b) =>
    compareUnicodeCodePoints(a.report_evidence_id, b.report_evidence_id),
  );

  for (const { report_evidence_id, report } of scopeReports) {
    if (ids.has(report_evidence_id))
      throw new TypeError("Duplicate correspondence Evidence record");
    ids.add(report_evidence_id);
    if (report.atlas_evidence_id !== atlasEvidenceId)
      throw new TypeError("Correspondence refers to a different atlas");
    const from = nodes.get(report.from_atlas_node_id);
    const to = nodes.get(report.to_atlas_node_id);
    if (from === undefined || to === undefined)
      throw new TypeError("Correspondence references an absent atlas node");
    if (
      from.projection_evidence_id === to.projection_evidence_id ||
      from.domain === to.domain
    )
      throw new TypeError("Correspondence must cross distinct source domains");
    const legitimate =
      (report.relation === "application-loads-native" &&
        from.domain === "application" &&
        to.domain === "native") ||
      (report.relation === "native-emits-packet" &&
        from.domain === "native" &&
        to.domain === "packet") ||
      (report.relation === "application-emits-packet" &&
        from.domain === "application" &&
        to.domain === "packet");
    if (!legitimate)
      throw new TypeError(
        "Correspondence direction or domain relation is invalid",
      );

    // A reported artifact digest must be meaningful within one of the
    // source-scoped observations, never an unrelated arbitrary digest.
    if (report.scope.subject_sha256 !== null) {
      const ownedDigests = atlas.sources
        .filter(
          (source) =>
            source.projection_evidence_id === from.projection_evidence_id ||
            source.projection_evidence_id === to.projection_evidence_id,
        )
        .map(({ source_target_sha256 }) => source_target_sha256);
      if (!ownedDigests.includes(report.scope.subject_sha256))
        throw new TypeError(
          "Reported artifact digest is absent from both source scopes",
        );
    }

    const claim_id = `raa_claim_${digestCanonicalValue(
      [
        atlasEvidenceId,
        report.from_atlas_node_id,
        report.to_atlas_node_id,
        report.relation,
        report.scope,
      ],
      "RAA scoped reported correspondence",
    )}`;
    const prior = claims.get(claim_id);
    const supporting = [...(prior?.supporting_report_evidence_ids ?? [])];
    const challenging = [...(prior?.challenging_report_evidence_ids ?? [])];
    if (report.polarity === "supports") supporting.push(report_evidence_id);
    else challenging.push(report_evidence_id);
    const supporting_report_evidence_ids = byCodePoint(supporting);
    const challenging_report_evidence_ids = byCodePoint(challenging);
    const review_status =
      supporting_report_evidence_ids.length === 0
        ? "challenge-only"
        : challenging_report_evidence_ids.length > 0
          ? "contested"
          : "reported-unverified";
    claims.set(claim_id, {
      claim_id,
      from_atlas_node_id: report.from_atlas_node_id,
      to_atlas_node_id: report.to_atlas_node_id,
      from_domain: from.domain,
      to_domain: to.domain,
      relation: report.relation,
      scope: report.scope,
      review_status,
      supporting_report_evidence_ids,
      challenging_report_evidence_ids,
      missing_verification_requirements: requirements(report),
      disconfirmation_question: DISCONFIRMATION[report.relation],
      verification_state: "no-independent-verification",
    });
  }
  const items = [...claims.values()].sort((a, b) =>
    compareUnicodeCodePoints(a.claim_id, b.claim_id),
  );
  return {
    schema: "RAACorrespondenceReview",
    version: 1,
    atlas_evidence_id: atlasEvidenceId,
    claims: items,
    verified_cross_source_relationships: [],
    limitations: [LIMITATION],
    summary: {
      reports: reports.length,
      claims: items.length,
      reported_unverified: items.filter(
        (c) => c.review_status === "reported-unverified",
      ).length,
      contested: items.filter((c) => c.review_status === "contested").length,
      challenge_only: items.filter((c) => c.review_status === "challenge-only")
        .length,
      independently_verified: 0,
    },
  };
};
