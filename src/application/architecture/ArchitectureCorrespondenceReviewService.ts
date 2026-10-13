import { z } from "zod";

import { architectureAtlasSchema } from "../../domain/architecture/architectureAtlasSchema.js";
import { architectureCorrespondenceReviewInputSchema } from "../../domain/architecture/architectureCorrespondenceReviewInput.js";
import { architectureCorrespondenceReportSchema } from "../../domain/architecture/architectureCorrespondenceReportSchema.js";
import { architectureCorrespondenceReviewSchema } from "../../domain/architecture/architectureCorrespondenceReviewSchema.js";
import {
  reviewArchitectureCorrespondences,
  type CorrespondenceReportSource,
} from "../../domain/architecture/architectureCorrespondenceReview.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisInputError } from "../../domain/analysisErrorCore.js";
import {
  createEvidence,
  parseEvidence,
  type Evidence,
} from "../../domain/evidence.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { jsonValueSchema } from "../../domain/jsonValue.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  RAA_ATLAS_PROVIDER,
  RAA_CORRESPONDENCE_REVIEW_PROVIDER,
} from "../InvestigationProviders.js";

const OPERATION = "review_architecture_correspondences" as const;

const reject = (
  index: number | null,
  explanation: string,
): AnalysisInputError =>
  new AnalysisInputError(OPERATION, undefined, [
    {
      path: index === null ? ["atlas"] : ["reports", index],
      reason: "invalid_value",
      message: explanation,
    },
  ]);

const authenticateAtlas = (
  raw: Evidence,
): Result<
  {
    atlas_evidence: Evidence;
    atlas: z.infer<typeof architectureAtlasSchema>;
  },
  AnalysisError
> => {
  let record: Evidence;
  try {
    record = parseEvidence(raw);
  } catch {
    return err(reject(null, "Invalid atlas Evidence record or digest"));
  }
  if (
    record.provider.id !== RAA_ATLAS_PROVIDER.id ||
    record.provider.name !== RAA_ATLAS_PROVIDER.name ||
    record.provider.version !== RAA_ATLAS_PROVIDER.version ||
    record.operation !== "build_reverse_architecture_atlas" ||
    record.predicate_type !== "raa.reverse-architecture-atlas" ||
    record.authority !== "analyst-inference" ||
    record.confidence !== "inferred"
  )
    return err(reject(null, "Expected an RAA Atlas derived Evidence producer"));

  const parsed = architectureAtlasSchema.safeParse(record.normalized_result);
  if (!parsed.success)
    return err(reject(null, "Atlas normalized result is malformed"));
  const claimed = parsed.data.sources.map((s) => s.projection_evidence_id).sort();
  const linked = [...record.evidence_links].sort();
  const parameterIds = record.parameters.source_evidence_ids;
  if (
    record.parameters.atlas_version !== parsed.data.version ||
    !Array.isArray(parameterIds) ||
    JSON.stringify(parameterIds) !== JSON.stringify(claimed) ||
    JSON.stringify(linked) !== JSON.stringify(claimed)
  )
    return err(
      reject(null, "Atlas Evidence source lineage does not match its graph"),
    );
  return ok({ atlas_evidence: record, atlas: parsed.data });
};

const authenticateReport = (
  raw: Evidence,
  index: number,
  atlasRecord: Evidence,
  atlas: z.infer<typeof architectureAtlasSchema>,
): Result<CorrespondenceReportSource, AnalysisError> => {
  let evidence: Evidence;
  try {
    evidence = parseEvidence(raw);
  } catch {
    return err(
      reject(index, "Invalid report Evidence record or semantic digest"),
    );
  }
  if (
    evidence.evidence_id === atlasRecord.evidence_id ||
    evidence.operation !== "report_architecture_correspondence" ||
    evidence.predicate_type !== "raa.cross-domain-correspondence-report" ||
    evidence.authority !== "analyst-inference" ||
    evidence.confidence !== "inferred" ||
    evidence.provider.id === RAA_ATLAS_PROVIDER.id ||
    evidence.provider.id === RAA_CORRESPONDENCE_REVIEW_PROVIDER.id
  )
    return err(
      reject(
        index,
        "Expected separately reported inference, not atlas or verified observation",
      ),
    );

  const parsed = architectureCorrespondenceReportSchema.safeParse(
    evidence.normalized_result,
  );
  if (!parsed.success)
    return err(
      reject(index, "Malformed or impossible correspondence report scope"),
    );
  const report = parsed.data;
  const nodes = new Map(atlas.nodes.map((node) => [node.atlas_node_id, node]));
  const from = nodes.get(report.from_atlas_node_id);
  const to = nodes.get(report.to_atlas_node_id);
  if (from === undefined || to === undefined)
    return err(reject(index, "Reported atlas node identity is missing"));
  const requiredLinks = [
    atlasRecord.evidence_id,
    from.projection_evidence_id,
    to.projection_evidence_id,
  ].sort();
  const expected = JSON.stringify(requiredLinks);
  const declared = JSON.stringify([...evidence.evidence_links].sort());
  if (
    report.atlas_evidence_id !== atlasRecord.evidence_id ||
    declared !== expected ||
    evidence.parameters.atlas_evidence_id !== atlasRecord.evidence_id ||
    evidence.parameters.from_atlas_node_id !== report.from_atlas_node_id ||
    evidence.parameters.to_atlas_node_id !== report.to_atlas_node_id ||
    evidence.parameters.relation !== report.relation ||
    evidence.parameters.polarity !== report.polarity
  )
    return err(
      reject(index, "Report parameters or source Evidence links disagree"),
    );

  return ok({ report_evidence_id: evidence.evidence_id, report });
};

/** No classification here is an independent proof of a cross-source edge. */
export const reviewReverseArchitectureCorrespondenceEvidence = (
  rawInput: unknown,
): Result<Evidence, AnalysisError> => {
  const parsed =
    architectureCorrespondenceReviewInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return err(
      analysisInputErrorFromIssues(OPERATION, parsed.error.issues, rawInput),
    );
  return reviewReverseArchitectureCorrespondenceEvidenceValidated(parsed.data);
};

export const reviewReverseArchitectureCorrespondenceEvidenceValidated = (
  input: z.output<typeof architectureCorrespondenceReviewInputSchema>,
): Result<Evidence, AnalysisError> => {
  const atlasResult = authenticateAtlas(input.atlas);
  if (!atlasResult.ok) return atlasResult;
  const { atlas_evidence: atlasEvidence, atlas } = atlasResult.value;
  const sources: CorrespondenceReportSource[] = [];
  for (let index = 0; index < input.reports.length; index++) {
    const report = input.reports[index];
    if (report === undefined)
      return err(reject(index, "Missing report Evidence"));
    const parsed = authenticateReport(report, index, atlasEvidence, atlas);
    if (!parsed.ok) return parsed;
    sources.push(parsed.value);
  }
  let reviewed;
  try {
    reviewed = architectureCorrespondenceReviewSchema.parse(
      reviewArchitectureCorrespondences(
        atlasEvidence.evidence_id,
        atlas,
        sources,
      ),
    );
  } catch {
    return err(
      reject(0, "Report endpoints, domains, or scope are inconsistent"),
    );
  }
  const reportIds = sources.map((r) => r.report_evidence_id).sort();
  const sourceIds = [atlasEvidence.evidence_id, ...reportIds].sort();
  return ok(
    createEvidence(undefined, RAA_CORRESPONDENCE_REVIEW_PROVIDER, {
      predicateType: "raa.cross-domain-correspondence-review",
      operation: OPERATION,
      parameters: {
        atlas_evidence_id: atlasEvidence.evidence_id,
        report_evidence_ids: reportIds,
        review_version: 1,
      },
      result: jsonValueSchema.parse(reviewed),
      rawResult: null,
      confidence: "inferred",
      authority: "analyst-inference",
      environment: null,
      limitations: reviewed.limitations,
      evidenceLinks: sourceIds,
    }),
  );
};
