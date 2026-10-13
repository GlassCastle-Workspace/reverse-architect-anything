import { z } from "zod";

import { prefixedDigestSchema } from "../digests.js";
import { jsonValueSchema } from "../jsonValue.js";
import {
  nativeInvestigationNodeKindSchema,
  nativeInvestigationRelationSchema,
  nativeInvestigationCoverageSchema,
} from "../native/nativeInvestigationGraph.js";
import {
  nativeMetadataEvidenceSchema,
  nativeMetadataLocationSchema,
} from "../native/objcSwiftMetadata.js";
import { packetFieldsSchema } from "../captures/packetCapture.js";

const componentId = prefixedDigestSchema("rao_component");
const relationId = prefixedDigestSchema("rao_relation");
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

const nativeComponentSchema = z.strictObject({
  component_id: componentId,
  source_node_id: z.string().min(1),
  original_kind: nativeInvestigationNodeKindSchema,
  category: z.enum([
    "presentation",
    "interaction",
    "execution",
    "dispatch",
    "data",
    "resource",
    "sink",
    "unresolved",
  ]),
  category_basis: z.literal("native-node-kind"),
  label: z.string().min(1),
  location: nativeMetadataLocationSchema.nullable(),
  attributes: z.record(z.string(), jsonValueSchema),
  source_evidence: z.array(nativeMetadataEvidenceSchema),
});

const packetComponentSchema = z.strictObject({
  component_id: componentId,
  frame_number: z.string().regex(/^[1-9][0-9]*$/u),
  category: z.literal("network-frame"),
  category_basis: z.literal("reported-frame-number"),
  selected_fields: packetFieldsSchema,
});

const nativeRelationshipSchema = z.strictObject({
  relationship_id: relationId,
  source_edge_id: z.string().min(1),
  from_source_node_id: z.string().min(1),
  to_source_node_id: z.string().nullable(),
  from_component_id: componentId.nullable(),
  to_component_id: componentId.nullable(),
  original_relation: nativeInvestigationRelationSchema,
  resolution: z.enum([
    "observed",
    "inferred",
    "resolved",
    "ambiguous",
    "unresolved",
  ]),
  reason: z.string().nullable(),
  source_evidence: z.array(nativeMetadataEvidenceSchema),
  limitations: z.array(z.string()),
});

const nativeUnresolvedSchema = z.strictObject({
  source_edge_id: z.string().min(1),
  from_source_node_id: z.string().min(1),
  to_source_node_id: z.string().nullable(),
  reason: z.string().min(1),
});

const base = {
  schema: z.literal("ReverseArchitectureObservationSurface"),
  version: z.literal(1),
  source_evidence_id: prefixedDigestSchema("ev"),
  source_target_sha256: sha256,
  limitations: z.array(z.string()),
} as const;

/**
 * Native relationships preserve the original provider's resolution term,
 * including ambiguous/unresolved. Missing endpoints remain null, never
 * fabricated or inferred from matching names or numeric addresses.
 */
const nativeSurface = z.strictObject({
  ...base,
  source_kind: z.literal("native-trace"),
  components: z.array(nativeComponentSchema),
  relationships: z.array(nativeRelationshipSchema),
  unresolved: z.array(nativeUnresolvedSchema),
  coverage: z.strictObject({
    kind: z.literal("native-trace"),
    truncated: z.boolean(),
    reached_depth: z.number().int().nonnegative(),
    direction: z.enum(["forward", "backward"]),
    query_start: z.string().min(1),
    reason: z.string().nullable(),
    facets: z.array(nativeInvestigationCoverageSchema),
  }),
  summary: z.strictObject({
    components: z.number().int().nonnegative(),
    relationships: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
  }),
});

/**
 * Packets are selected observations, not flows or sessions. Exactly the
 * returned packet/field arrays are preserved with bounded-window metadata.
 */
const packetSurface = z.strictObject({
  ...base,
  source_kind: z.literal("packet-capture"),
  components: z.array(packetComponentSchema),
  relationships: z.array(z.never()),
  unresolved: z.array(z.never()),
  coverage: z.strictObject({
    kind: z.literal("packet-capture"),
    read_scope: z.enum(["to-eof", "up-to-input-packet-limit"]),
    matching_packets: z.number().int().nonnegative(),
    returned_packets: z.number().int().nonnegative(),
    has_more: z.boolean(),
    match_offset: z.number().int().nonnegative(),
    match_limit: z.number().int().positive().nullable(),
    packet_limit: z.number().int().positive().nullable(),
    display_filter: z.string().nullable(),
    selected_field_names: z.array(z.string().min(1)),
  }),
  summary: z.strictObject({
    components: z.number().int().nonnegative(),
    relationships: z.literal(0),
    unresolved: z.literal(0),
  }),
});

export const architectureObservationSurfaceSchema = z.discriminatedUnion(
  "source_kind",
  [nativeSurface, packetSurface],
);
export type ArchitectureObservationSurface = z.infer<
  typeof architectureObservationSurfaceSchema
>;
