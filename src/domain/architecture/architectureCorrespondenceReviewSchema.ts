import { z } from "zod";

import { prefixedDigestSchema } from "../digests.js";
import {
  correspondenceKindSchema,
  correspondenceScopeSchema,
} from "./architectureCorrespondenceReportSchema.js";

const evidenceId = prefixedDigestSchema("ev");
const nodeId = prefixedDigestSchema("raa_node");

const finding = z.strictObject({
  claim_id: prefixedDigestSchema("raa_claim"),
  from_atlas_node_id: nodeId,
  to_atlas_node_id: nodeId,
  from_domain: z.enum(["application", "native", "packet"]),
  to_domain: z.enum(["application", "native", "packet"]),
  relation: correspondenceKindSchema,
  scope: correspondenceScopeSchema,
  review_status: z.enum(["reported-unverified", "contested", "challenge-only"]),
  supporting_report_evidence_ids: z.array(evidenceId),
  challenging_report_evidence_ids: z.array(evidenceId),
  missing_verification_requirements: z.array(z.string().min(1)),
  disconfirmation_question: z.string().min(1),
  verification_state: z.literal("no-independent-verification"),
});

/**
 * Reports are NOT authoritative cross-source edges. A future instrumented
 * verifier may emit separately signed/attested verification, never this tool.
 */
export const architectureCorrespondenceReviewSchema = z.strictObject({
  schema: z.literal("RAACorrespondenceReview"),
  version: z.literal(1),
  atlas_evidence_id: evidenceId,
  claims: z.array(finding),
  verified_cross_source_relationships: z.array(z.never()),
  limitations: z.array(z.string().min(1)),
  summary: z.strictObject({
    reports: z.number().int().nonnegative(),
    claims: z.number().int().nonnegative(),
    reported_unverified: z.number().int().nonnegative(),
    contested: z.number().int().nonnegative(),
    challenge_only: z.number().int().nonnegative(),
    independently_verified: z.literal(0),
  }),
});
export type ArchitectureCorrespondenceReview = z.infer<
  typeof architectureCorrespondenceReviewSchema
>;
