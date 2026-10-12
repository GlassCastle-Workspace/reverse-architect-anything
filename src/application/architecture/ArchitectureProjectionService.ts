import { z } from "zod";

import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { reverseArchitectureProjectionInputSchema } from "../../domain/architecture/architectureProjectionInput.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  projectJavaScriptArchitecture,
  type ArchitectureProjection,
} from "../../domain/architecture/architectureProjection.js";
import {
  applicationGraphEvidenceInputError,
  parseApplicationGraphEvidence,
} from "../javascript/JavaScriptApplicationEvidenceGraph.js";

const OPERATION = "project_reverse_architecture";

/**
 * Read-only architectural interpretation of a validated application graph.
 * No disassembly, target execution, graph mutation or credential access.
 */
export const projectReverseArchitectureEvidence = (
  rawInput: unknown,
): Result<ArchitectureProjection, AnalysisError> => {
  const parsed = reverseArchitectureProjectionInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return err(
      analysisInputErrorFromIssues(OPERATION, parsed.error.issues, rawInput),
    );
  return projectReverseArchitectureEvidenceValidated(parsed.data);
};

export const projectReverseArchitectureEvidenceValidated = (
  input: z.output<typeof reverseArchitectureProjectionInputSchema>,
): Result<ArchitectureProjection, AnalysisError> => {
  const source = parseApplicationGraphEvidence(input.application, [
    "application",
  ]);
  if (!source.ok)
    return err(applicationGraphEvidenceInputError(OPERATION, source.error));

  return ok(
    projectJavaScriptArchitecture(
      source.value.graph,
      source.value.evidence.evidence_id,
    ),
  );
};
