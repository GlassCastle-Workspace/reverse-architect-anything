import { createEvidence, type Evidence } from "../../domain/evidence.js";
import { architectureAtlasSchema } from "../../domain/architecture/architectureAtlasSchema.js";
import {
  architectureCorrespondenceReportSchema,
  type ArchitectureCorrespondenceReport,
} from "../../domain/architecture/architectureCorrespondenceReportSchema.js";
import { buildReverseArchitectureAtlasEvidence } from "./ArchitectureAtlasService.js";
import { architectureAtlasEvidenceSources } from "./ArchitectureAtlas.fixture.js";

const candidate = buildReverseArchitectureAtlasEvidence({
  sources: architectureAtlasEvidenceSources,
});
if (!candidate.ok) throw new Error("Atlas fixture Evidence failed");
export const reviewAtlasFixture = candidate.value;
const atlas = architectureAtlasSchema.parse(
  reviewAtlasFixture.normalized_result,
);
const app = atlas.nodes.find((node) => node.domain === "application");
const native = atlas.nodes.find((node) => node.domain === "native");
const packet = atlas.nodes.find((node) => node.domain === "packet");
if (!app || !native || !packet)
  throw new Error("Atlas fixture requires application, native, packet nodes");

export const bindingNodes = {
  application: app,
  native,
  packet,
} as const;
const scope = {
  subject_sha256: null,
  process_instance_id: null,
  network_namespace: null,
  connection_id: null,
  sensor_id: null,
  window_start: null,
  window_end: null,
} as const;

export const createReportedCorrespondence = (
  options: {
    readonly polarity?: "supports" | "challenges";
    readonly relation?: ArchitectureCorrespondenceReport["relation"];
    readonly from?: "application" | "native" | "packet";
    readonly to?: "application" | "native" | "packet";
    readonly sensor_id?: string | null;
    readonly provider_id?: string;
  } = {},
): Evidence => {
  const from = bindingNodes[options.from ?? "application"];
  const to = bindingNodes[options.to ?? "native"];
  const relation = options.relation ?? "application-loads-native";
  const polarity = options.polarity ?? "supports";
  const report = architectureCorrespondenceReportSchema.parse({
    schema: "RAACorrespondenceReport",
    version: 1,
    atlas_evidence_id: reviewAtlasFixture.evidence_id,
    from_atlas_node_id: from.atlas_node_id,
    to_atlas_node_id: to.atlas_node_id,
    relation,
    polarity,
    scope: { ...scope, sensor_id: options.sensor_id ?? null },
    rationale:
      "Synthetic analyst report without independent loader or socket telemetry",
  });
  return createEvidence(
    undefined,
    {
      id: options.provider_id ?? "fixture-analyst-reporter",
      name: "Synthetic reporting source",
      version: "1",
    },
    {
      operation: "report_architecture_correspondence",
      predicateType: "raa.cross-domain-correspondence-report",
      parameters: {
        atlas_evidence_id: reviewAtlasFixture.evidence_id,
        from_atlas_node_id: report.from_atlas_node_id,
        to_atlas_node_id: report.to_atlas_node_id,
        relation,
        polarity,
      },
      result: report,
      confidence: "inferred",
      authority: "analyst-inference",
      evidenceLinks: [
        reviewAtlasFixture.evidence_id,
        from.projection_evidence_id,
        to.projection_evidence_id,
      ].sort(),
      subjectUnavailableReason:
        "Synthetic analyst report has no independently observed artifact",
    },
  );
};

export const reviewedReportFixture = createReportedCorrespondence();
export const challengedReportFixture = createReportedCorrespondence({
  polarity: "challenges",
  provider_id: "fixture-challenger",
});
