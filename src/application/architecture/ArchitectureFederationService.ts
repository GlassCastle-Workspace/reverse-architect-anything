import { z } from "zod";

import { architectureFederationSchema } from "../../domain/architecture/architectureFederationSchema.js";
import {
  federateArchitectureProjections,
  type ArchitectureFederationSource,
} from "../../domain/architecture/architectureFederation.js";
import { architectureProjectionSchema } from "../../domain/architecture/architectureProjectionSchema.js";
import { reverseArchitectureFederationInputSchema } from "../../domain/architecture/architectureFederationInput.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisInputError,
  AnalysisResourceConstraintError,
} from "../../domain/analysisErrorCore.js";
import {
  createEvidence,
  parseEvidence,
  type Evidence,
} from "../../domain/evidence.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { jsonValueSchema } from "../../domain/jsonValue.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  RAA_ARCHITECTURE_PROVIDER,
  RAA_FEDERATION_PROVIDER,
} from "../InvestigationProviders.js";

const OPERATION = "federate_reverse_architecture" as const;
const MAX_COMPONENTS = 20_000;
const MAX_RELATIONSHIPS = 50_000;

const invalidSource = (
  index: number,
  explanation: string,
): AnalysisInputError =>
  new AnalysisInputError(OPERATION, undefined, [
    {
      path: ["projections", index],
      reason: "invalid_value",
      message: explanation,
    },
  ]);

/** Require the expected RAA producer and an exact source-Evidence link. */
const parseArchitectureSource = (
  input: Evidence,
  index: number,
): Result<ArchitectureFederationSource, AnalysisError> => {
  let evidence: Evidence;
  try {
    evidence = parseEvidence(input);
  } catch {
    return err(
      invalidSource(index, "Evidence digest or record structure is invalid"),
    );
  }
  if (
    evidence.provider.id !== RAA_ARCHITECTURE_PROVIDER.id ||
    evidence.provider.name !== RAA_ARCHITECTURE_PROVIDER.name ||
    evidence.provider.version !== RAA_ARCHITECTURE_PROVIDER.version ||
    evidence.operation !== "project_reverse_architecture" ||
    evidence.predicate_type !== "raa.reverse-architecture-projection" ||
    evidence.authority !== "analyst-inference" ||
    evidence.confidence !== "inferred"
  ) {
    return err(
      invalidSource(
        index,
        "Expected an RAA architectural projection Evidence record",
      ),
    );
  }

  const parsed = architectureProjectionSchema.safeParse(
    evidence.normalized_result,
  );
  if (!parsed.success)
    return err(
      analysisInputErrorFromIssues(
        OPERATION,
        parsed.error.issues.map((issue) => ({
          ...issue,
          path: ["projections", index, "normalized_result", ...issue.path],
        })),
        input,
      ),
    );
  const projection = parsed.data;
  if (
    evidence.parameters.source_evidence_id !== projection.source_evidence_id ||
    evidence.parameters.projection_version !== projection.version ||
    evidence.evidence_links.length !== 1 ||
    evidence.evidence_links[0] !== projection.source_evidence_id
  ) {
    return err(
      invalidSource(
        index,
        "Architectural projection provenance is inconsistent",
      ),
    );
  }
  return ok({
    projection_evidence_id: evidence.evidence_id,
    projection,
  });
};

/** Validate and federate complete, content-identified architectural Evidence. */
export const federateReverseArchitectureEvidence = (
  rawInput: unknown,
): Result<Evidence, AnalysisError> => {
  const parsed = reverseArchitectureFederationInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return err(
      analysisInputErrorFromIssues(OPERATION, parsed.error.issues, rawInput),
    );
  return federateReverseArchitectureEvidenceValidated(parsed.data);
};

export const federateReverseArchitectureEvidenceValidated = (
  input: z.output<typeof reverseArchitectureFederationInputSchema>,
): Result<Evidence, AnalysisError> => {
  const sources: ArchitectureFederationSource[] = [];
  for (let index = 0; index < input.projections.length; index++) {
    const evidence = input.projections[index];
    if (evidence === undefined)
      return err(invalidSource(index, "Missing architectural Evidence"));
    const parsed = parseArchitectureSource(evidence, index);
    if (!parsed.ok) return parsed;
    sources.push(parsed.value);
  }
  if (
    new Set(sources.map((source) => source.projection_evidence_id)).size !==
    sources.length
  ) {
    return err(
      invalidSource(0, "Duplicate source Evidence IDs are not permitted"),
    );
  }
  const totalComponents = sources.reduce(
    (sum, source) => sum + source.projection.components.length,
    0,
  );
  const totalRelationships = sources.reduce(
    (sum, source) => sum + source.projection.relationships.length,
    0,
  );
  if (
    totalComponents > MAX_COMPONENTS ||
    totalRelationships > MAX_RELATIONSHIPS
  )
    return err(
      new AnalysisResourceConstraintError(
        OPERATION,
        "capacity",
        "Too many source components or relationships for one federation",
        {
          max_components: MAX_COMPONENTS,
          max_relationships: MAX_RELATIONSHIPS,
        },
      ),
    );

  let federation;
  try {
    federation = architectureFederationSchema.parse(
      federateArchitectureProjections(sources),
    );
  } catch {
    return err(
      invalidSource(
        0,
        "Source graph identities or relationships are inconsistent",
      ),
    );
  }
  const sourceIds = sources
    .map((source) => source.projection_evidence_id)
    .sort();
  return ok(
    createEvidence(undefined, RAA_FEDERATION_PROVIDER, {
      predicateType: "raa.reverse-architecture-federation",
      operation: OPERATION,
      parameters: {
        source_projection_evidence_ids: sourceIds,
        federation_version: 1,
      },
      result: jsonValueSchema.parse(federation),
      rawResult: null,
      confidence: "inferred",
      authority: "analyst-inference",
      environment: null,
      limitations: federation.limitations,
      evidenceLinks: sourceIds,
    }),
  );
};
