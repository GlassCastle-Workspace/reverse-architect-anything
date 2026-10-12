import { z } from "zod";

import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { reverseArchitectureProjectionInputSchema } from "../../domain/architecture/architectureProjectionInput.js";
import { projectJavaScriptArchitecture } from "../../domain/architecture/architectureProjection.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import { jsonValueSchema } from "../../domain/jsonValue.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { err, ok, type Result } from "../../domain/result.js";
import { RAA_ARCHITECTURE_PROVIDER } from "../InvestigationProviders.js";
import {
  applicationGraphEvidenceInputError,
  parseApplicationGraphEvidence,
} from "../javascript/JavaScriptApplicationEvidenceGraph.js";

const OPERATION = "project_reverse_architecture" as const;

const ARCHITECTURE_LIMITATION =
  "Component categories are derived; architecture boundary candidates are unverified hypotheses, not observed trust or process boundaries.";

/**
 * Project authenticated application Evidence without opening the target.
 * Returns a hash-linked derived Evidence record reusable by CLI and MCP.
 */
export const projectReverseArchitectureEvidence = (
  rawInput: unknown,
): Result<Evidence, AnalysisError> => {
  const parsed = reverseArchitectureProjectionInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return err(
      analysisInputErrorFromIssues(OPERATION, parsed.error.issues, rawInput),
    );
  return projectReverseArchitectureEvidenceValidated(parsed.data);
};

/** Input must already have passed the exact CLI or MCP Evidence contract. */
export const projectReverseArchitectureEvidenceValidated = (
  input: z.output<typeof reverseArchitectureProjectionInputSchema>,
): Result<Evidence, AnalysisError> => {
  const source = parseApplicationGraphEvidence(input.application, [
    "application",
  ]);
  if (!source.ok)
    return err(applicationGraphEvidenceInputError(OPERATION, source.error));

  const sourceEvidence = source.value.evidence;
  const projection = projectJavaScriptArchitecture(
    source.value.graph,
    sourceEvidence.evidence_id,
    {
      kind: source.value.kind,
      rootArtifactSha256: source.value.rootArtifactSha256,
    },
  );

  return ok(
    createEvidence(undefined, RAA_ARCHITECTURE_PROVIDER, {
      predicateType: "raa.reverse-architecture-projection",
      operation: OPERATION,
      parameters: {
        source_evidence_id: sourceEvidence.evidence_id,
        projection_version: 1,
      },
      result: jsonValueSchema.parse(projection),
      rawResult: null,
      confidence: "inferred",
      authority: "analyst-inference",
      environment: null,
      limitations: [...projection.limitations, ARCHITECTURE_LIMITATION],
      evidenceLinks: [sourceEvidence.evidence_id],
    }),
  );
};
