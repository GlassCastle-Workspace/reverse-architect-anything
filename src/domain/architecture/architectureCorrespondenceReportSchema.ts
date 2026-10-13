import { z } from "zod";

import { digestSchema, prefixedDigestSchema } from "../digests.js";

const evidenceId = prefixedDigestSchema("ev");
const nodeId = prefixedDigestSchema("raa_node");
const nonEmpty = z.string().min(1).max(256);
const maybe = nonEmpty.nullable();
const date = z.iso.datetime({ offset: true });

export const correspondenceScopeSchema = z
  .strictObject({
    subject_sha256: digestSchema.nullable(),
    process_instance_id: maybe,
    network_namespace: maybe,
    connection_id: maybe,
    sensor_id: maybe,
    window_start: date.nullable(),
    window_end: date.nullable(),
  })
  .superRefine((scope, context) => {
    if ((scope.window_start === null) !== (scope.window_end === null))
      context.addIssue({
        code: "custom",
        path: ["window_start"],
        message: "A binding time window requires both start and end",
      });
    if (
      scope.window_start !== null &&
      scope.window_end !== null &&
      Date.parse(scope.window_start) > Date.parse(scope.window_end)
    )
      context.addIssue({
        code: "custom",
        path: ["window_end"],
        message: "A correspondence time window cannot run backward",
      });
  });

export const correspondenceKindSchema = z.enum([
  "application-loads-native",
  "native-emits-packet",
  "application-emits-packet",
]);

/**
 * An independently *reported* claim, not proof of the physical relationship.
 * The semantic Evidence envelope binds this report to the atlas and its sources.
 */
export const architectureCorrespondenceReportSchema = z.strictObject({
  schema: z.literal("RAACorrespondenceReport"),
  version: z.literal(1),
  atlas_evidence_id: evidenceId,
  from_atlas_node_id: nodeId,
  to_atlas_node_id: nodeId,
  relation: correspondenceKindSchema,
  polarity: z.enum(["supports", "challenges"]),
  scope: correspondenceScopeSchema,
  rationale: z.string().min(1).max(1024),
});

export type ArchitectureCorrespondenceReport = z.infer<
  typeof architectureCorrespondenceReportSchema
>;
