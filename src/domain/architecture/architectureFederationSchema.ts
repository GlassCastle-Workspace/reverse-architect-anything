import { z } from "zod";

import { digestSchema, prefixedDigestSchema } from "../digests.js";
import { applicationCoverageSchema } from "../javascript/javascriptApplicationEvidenceSchemas.js";
import { architectureProjectionSchema } from "./architectureProjectionSchema.js";

const evidenceId = prefixedDigestSchema("ev");
const nodeId = prefixedDigestSchema("raf_node");
const linkId = prefixedDigestSchema("raf_link");
const boundaryId = prefixedDigestSchema("raf_boundary");
const text = z.array(z.string());

/** Source identity is preserved, even where separate sources share bytes. */
export const architectureFederationSchema = z.strictObject({
  schema: z.literal("ReverseArchitectureFederation"),
  version: z.literal(1),
  sources: z.array(
    z.strictObject({
      projection_evidence_id: evidenceId,
      graph_evidence_id: evidenceId,
      graph_id: prefixedDigestSchema("jag"),
      source_kind: architectureProjectionSchema.shape.source_kind,
      root_artifact_sha256: digestSchema,
      coverage: applicationCoverageSchema,
      limitations: text,
    }),
  ),
  components: z.array(
    z.strictObject({
      federated_id: nodeId,
      projection_evidence_id: evidenceId,
      component: architectureProjectionSchema.shape.components.element,
    }),
  ),
  relationships: z.array(
    z.strictObject({
      federated_id: linkId,
      projection_evidence_id: evidenceId,
      from_federated_id: nodeId,
      to_federated_id: nodeId,
      relationship: architectureProjectionSchema.shape.relationships.element,
    }),
  ),
  boundary_candidates: z.array(
    z.strictObject({
      federated_id: boundaryId,
      projection_evidence_id: evidenceId,
      from_federated_id: nodeId,
      to_federated_id: nodeId,
      candidate: architectureProjectionSchema.shape.boundary_candidates.element,
    }),
  ),
  unresolved: z.array(
    z.strictObject({
      projection_evidence_id: evidenceId,
      federated_component_id: nodeId,
      finding: architectureProjectionSchema.shape.unresolved.element,
    }),
  ),
  shared_root_artifacts: z.array(
    z.strictObject({
      sha256: digestSchema,
      projection_evidence_ids: z.array(evidenceId).min(2),
      fact: z.literal("matching-reported-root-sha256"),
    }),
  ),
  shared_component_content: z.array(
    z.strictObject({
      sha256: digestSchema,
      federated_component_ids: z.array(nodeId).min(2),
      fact: z.literal("matching-reported-content-sha256"),
    }),
  ),
  overall_coverage: z.enum(["complete-within-sources", "partial-or-unknown"]),
  limitations: text,
  summary: z.strictObject({
    source_projections: z.number().int().nonnegative(),
    components: z.number().int().nonnegative(),
    relationships: z.number().int().nonnegative(),
    boundary_candidates: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
    shared_root_artifacts: z.number().int().nonnegative(),
    shared_component_content: z.number().int().nonnegative(),
  }),
});

export type ArchitectureFederation = z.infer<
  typeof architectureFederationSchema
>;
