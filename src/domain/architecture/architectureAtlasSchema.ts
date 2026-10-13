import { z } from "zod";

import { prefixedDigestSchema, digestSchema } from "../digests.js";
import { applicationCoverageSchema } from "../javascript/javascriptApplicationEvidenceSchemas.js";
import { architectureProjectionSchema } from "./architectureProjectionSchema.js";
import {
  nativeArchitectureObservationSurfaceSchema,
  packetArchitectureObservationSurfaceSchema,
} from "./architectureObservationSurfaceSchema.js";

const evidenceId = prefixedDigestSchema("ev");
const atlasNodeId = prefixedDigestSchema("raa_node");
const atlasEdgeId = prefixedDigestSchema("raa_edge");
const atlasFindingId = prefixedDigestSchema("raa_finding");
const atlasHypothesisId = prefixedDigestSchema("raa_hypothesis");
const strings = z.array(z.string());
const sourceFields = {
  projection_evidence_id: evidenceId,
  source_evidence_id: evidenceId,
  source_target_sha256: digestSchema,
  limitations: strings,
  completeness: z.enum([
    "complete-within-declared-scope",
    "partial-or-unknown",
  ]),
} as const;

const sourceSchema = z.discriminatedUnion("source_kind", [
  z.strictObject({
    ...sourceFields,
    source_kind: z.literal("application"),
    application_source_kind: architectureProjectionSchema.shape.source_kind,
    original_graph_id: architectureProjectionSchema.shape.source_graph_id,
    coverage: applicationCoverageSchema,
  }),
  z.strictObject({
    ...sourceFields,
    source_kind: z.literal("native-trace"),
    coverage: nativeArchitectureObservationSurfaceSchema.shape.coverage,
  }),
  z.strictObject({
    ...sourceFields,
    source_kind: z.literal("packet-capture"),
    coverage: packetArchitectureObservationSurfaceSchema.shape.coverage,
  }),
]);

const nodeFields = {
  atlas_node_id: atlasNodeId,
  projection_evidence_id: evidenceId,
} as const;
const nodesSchema = z.discriminatedUnion("domain", [
  z.strictObject({
    ...nodeFields,
    domain: z.literal("application"),
    component: architectureProjectionSchema.shape.components.element,
  }),
  z.strictObject({
    ...nodeFields,
    domain: z.literal("native"),
    component:
      nativeArchitectureObservationSurfaceSchema.shape.components.element,
  }),
  z.strictObject({
    ...nodeFields,
    domain: z.literal("packet"),
    component:
      packetArchitectureObservationSurfaceSchema.shape.components.element,
  }),
]);

const relationshipFields = {
  atlas_edge_id: atlasEdgeId,
  projection_evidence_id: evidenceId,
  from_atlas_node_id: atlasNodeId.nullable(),
  to_atlas_node_id: atlasNodeId.nullable(),
} as const;
const relationshipsSchema = z.discriminatedUnion("domain", [
  z.strictObject({
    ...relationshipFields,
    domain: z.literal("application"),
    relationship: architectureProjectionSchema.shape.relationships.element,
  }),
  z.strictObject({
    ...relationshipFields,
    domain: z.literal("native"),
    relationship:
      nativeArchitectureObservationSurfaceSchema.shape.relationships.element,
  }),
]);

const findingFields = {
  atlas_finding_id: atlasFindingId,
  projection_evidence_id: evidenceId,
  atlas_node_id: atlasNodeId.nullable(),
} as const;
const findingsSchema = z.discriminatedUnion("domain", [
  z.strictObject({
    ...findingFields,
    domain: z.literal("application"),
    finding: architectureProjectionSchema.shape.unresolved.element,
  }),
  z.strictObject({
    ...findingFields,
    domain: z.literal("native"),
    finding:
      nativeArchitectureObservationSurfaceSchema.shape.unresolved.element,
  }),
]);

/**
 * A conservative heterogeneous map, with typed source-local nodes and edges.
 *
 * It has deliberately NO supported cross-source relationship schema: identical
 * names/addresses, matching reported hashes, and temporal adjacency do not
 * establish an architectural connection. A separate verified binding contract
 * must be introduced before this changes.
 */
export const architectureAtlasSchema = z.strictObject({
  schema: z.literal("ReverseArchitectureAtlas"),
  version: z.literal(1),
  sources: z.array(sourceSchema).min(2).max(8),
  nodes: z.array(nodesSchema),
  relationships: z.array(relationshipsSchema),
  boundary_hypotheses: z.array(
    z.strictObject({
      atlas_hypothesis_id: atlasHypothesisId,
      projection_evidence_id: evidenceId,
      from_atlas_node_id: atlasNodeId,
      to_atlas_node_id: atlasNodeId,
      hypothesis:
        architectureProjectionSchema.shape.boundary_candidates.element,
    }),
  ),
  unresolved: z.array(findingsSchema),
  /** These are digest reports only; this array NEVER authorizes node merging. */
  reported_artifact_digest_matches: z.array(
    z.strictObject({
      sha256: digestSchema,
      projection_evidence_ids: z.array(evidenceId).min(2),
      fact: z.literal("matching-reported-artifact-sha256"),
    }),
  ),
  cross_source_relationships: z.array(z.never()),
  overall_completeness: z.enum([
    "complete-within-declared-scopes",
    "partial-or-unknown",
  ]),
  limitations: strings,
  summary: z.strictObject({
    sources: z.number().int().nonnegative(),
    application_sources: z.number().int().nonnegative(),
    native_sources: z.number().int().nonnegative(),
    packet_sources: z.number().int().nonnegative(),
    nodes: z.number().int().nonnegative(),
    relationships: z.number().int().nonnegative(),
    boundary_hypotheses: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
    reported_artifact_digest_matches: z.number().int().nonnegative(),
    cross_source_relationships: z.literal(0),
  }),
});
export type ArchitectureAtlas = z.infer<typeof architectureAtlasSchema>;
