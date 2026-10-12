import { z } from "zod";

import { prefixedDigestSchema } from "../digests.js";
import {
  JAVASCRIPT_APPLICATION_NODE_KINDS,
  JAVASCRIPT_APPLICATION_RELATIONS,
} from "../javascript/javascriptApplicationGraphSchemas.js";
import { applicationCoverageSchema } from "../javascript/javascriptApplicationEvidenceSchemas.js";
import type { ArchitectureProjection } from "./architectureProjection.js";

const factState = z.enum(["observed", "inferred", "unknown", "unavailable"]);
const confidence = z.enum(["exact", "high", "medium", "low", "unknown"]);
const evidenceIds = z.array(prefixedDigestSchema("ev"));
const strings = z.array(z.string());
const graphNodeId = prefixedDigestSchema("jag_node");
const graphEdgeId = prefixedDigestSchema("jag_edge");

const observation = z.strictObject({
  observation_id: prefixedDigestSchema("jag_observation"),
  fact_state: factState,
  confidence,
  evidence_ids: evidenceIds,
  limitations: strings,
});

const component = z.strictObject({
  component_id: graphNodeId,
  original_kind: z.enum(JAVASCRIPT_APPLICATION_NODE_KINDS),
  category: z.enum([
    "distribution",
    "artifact",
    "execution-context",
    "interface",
    "implementation",
    "storage",
    "unresolved",
  ]),
  category_basis: z.literal("source-node-kind"),
  identity_stability: z.enum([
    "global-exact",
    "source-map-exact",
    "artifact-version",
    "cross-version-inference",
    "capture-only",
    "observation-only",
  ]),
  labels: strings,
  observations: z.array(observation),
});

const relationship = z.strictObject({
  relationship_id: graphEdgeId,
  from_component_id: graphNodeId,
  to_component_id: graphNodeId,
  original_relation: z.enum(JAVASCRIPT_APPLICATION_RELATIONS),
  fact_state: factState,
  confidence,
  evidence_ids: evidenceIds,
  limitations: strings,
});

const boundaryCandidate = z.strictObject({
  candidate_id: prefixedDigestSchema("ra_boundary"),
  from_component_id: graphNodeId,
  to_component_id: graphNodeId,
  supporting_relationship_id: graphEdgeId,
  kind: z.enum(["communication", "exposure", "invocation", "persistence"]),
  epistemic_status: z.literal("hypothesis"),
  source_fact_state: factState,
  evidence_ids: evidenceIds,
  verification_question: z.string().min(1),
});

const unresolved = z.strictObject({
  component_id: graphNodeId,
  reason: z.enum([
    "unresolved-node-kind",
    "unknown-or-unavailable-observation",
  ]),
  limitations: strings,
});

/**
 * Explicit MCP-advertisable output schema. No opaque custom validators:
 * consumers can inspect every architectural fact and its evidence boundary.
 */
export const architectureProjectionSchema = z.strictObject({
  schema: z.literal("ReverseArchitectureProjection"),
  version: z.literal(1),
  source_graph_id: prefixedDigestSchema("jag"),
  source_evidence_id: prefixedDigestSchema("ev"),
  components: z.array(component),
  relationships: z.array(relationship),
  boundary_candidates: z.array(boundaryCandidate),
  unresolved: z.array(unresolved),
  coverage: applicationCoverageSchema,
  limitations: strings,
  summary: z.strictObject({
    components: z.number().int().nonnegative(),
    relationships: z.number().int().nonnegative(),
    boundary_candidates: z.number().int().nonnegative(),
    unresolved_components: z.number().int().nonnegative(),
  }),
}) satisfies z.ZodType<ArchitectureProjection>;
