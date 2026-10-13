import { z } from "zod";

import { architectureAtlasInputSchema } from "../../domain/architecture/architectureAtlasInput.js";
import { architectureAtlasSchema } from "../../domain/architecture/architectureAtlasSchema.js";
import {
  buildArchitectureAtlas,
  type ArchitectureAtlasSource,
} from "../../domain/architecture/architectureAtlas.js";
import { architectureProjectionSchema } from "../../domain/architecture/architectureProjectionSchema.js";
import { architectureObservationSurfaceSchema } from "../../domain/architecture/architectureObservationSurfaceSchema.js";
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
  RAA_ATLAS_PROVIDER,
} from "../InvestigationProviders.js";

const OPERATION = "build_reverse_architecture_atlas" as const;
const MAX_NODES = 20_000;
const MAX_RELATIONSHIPS = 50_000;

const invalidSource = (
  index: number,
  description: string,
): AnalysisInputError =>
  new AnalysisInputError(OPERATION, undefined, [
    {
      path: ["sources", index],
      reason: "invalid_value",
      message: description,
    },
  ]);

/**
 * Validate a content-addressed RAA source, not an arbitrary Evidence envelope.
 * This preserves producer/operation semantics and checks source linkage.
 * Hash agreement is content integrity, never an independent signature.
 */
const parseAtlasSource = (
  raw: Evidence,
  index: number,
): Result<ArchitectureAtlasSource, AnalysisError> => {
  let evidence: Evidence;
  try {
    evidence = parseEvidence(raw);
  } catch {
    return err(
      invalidSource(index, "Invalid source Evidence identity or structure"),
    );
  }
  if (
    evidence.provider.id !== RAA_ARCHITECTURE_PROVIDER.id ||
    evidence.provider.name !== RAA_ARCHITECTURE_PROVIDER.name ||
    evidence.provider.version !== RAA_ARCHITECTURE_PROVIDER.version ||
    evidence.authority !== "analyst-inference" ||
    evidence.confidence !== "inferred"
  )
    return err(
      invalidSource(index, "Expected a recognized RAA projection provider"),
    );

  const id = evidence.evidence_id;
  if (
    evidence.operation === "project_reverse_architecture" &&
    evidence.predicate_type === "raa.reverse-architecture-projection"
  ) {
    const parsed = architectureProjectionSchema.safeParse(
      evidence.normalized_result,
    );
    if (!parsed.success)
      return err(
        invalidSource(index, "Application architecture shape is invalid"),
      );
    if (
      evidence.parameters.source_evidence_id !==
        parsed.data.source_evidence_id ||
      evidence.parameters.projection_version !== parsed.data.version ||
      evidence.evidence_links.length !== 1 ||
      evidence.evidence_links[0] !== parsed.data.source_evidence_id
    )
      return err(
        invalidSource(
          index,
          "Application projection source Evidence linkage differs",
        ),
      );
    return ok({ projection_evidence_id: id, projection: parsed.data });
  }
  if (
    evidence.operation === "project_observation_architecture" &&
    evidence.predicate_type === "raa.observation-architecture-surface"
  ) {
    const parsed = architectureObservationSurfaceSchema.safeParse(
      evidence.normalized_result,
    );
    if (!parsed.success)
      return err(
        invalidSource(
          index,
          "Native or packet observation surface shape is invalid",
        ),
      );
    if (
      evidence.parameters.source_evidence_id !==
        parsed.data.source_evidence_id ||
      evidence.parameters.surface_version !== parsed.data.version ||
      evidence.parameters.source_kind !== parsed.data.source_kind ||
      evidence.evidence_links.length !== 1 ||
      evidence.evidence_links[0] !== parsed.data.source_evidence_id
    )
      return err(
        invalidSource(
          index,
          "Observation surface source Evidence linkage differs",
        ),
      );
    return ok({ projection_evidence_id: id, surface: parsed.data });
  }
  return err(
    invalidSource(
      index,
      "Expected RAA application architecture or native/packet observation Evidence",
    ),
  );
};

/** Build an atlas from complete, content-identified architectural Evidence records. */
export const buildReverseArchitectureAtlasEvidence = (
  rawInput: unknown,
): Result<Evidence, AnalysisError> => {
  const parsed = architectureAtlasInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return err(
      analysisInputErrorFromIssues(OPERATION, parsed.error.issues, rawInput),
    );
  return buildReverseArchitectureAtlasEvidenceValidated(parsed.data);
};

export const buildReverseArchitectureAtlasEvidenceValidated = (
  input: z.output<typeof architectureAtlasInputSchema>,
): Result<Evidence, AnalysisError> => {
  const sources: ArchitectureAtlasSource[] = [];
  for (let index = 0; index < input.sources.length; index++) {
    const raw = input.sources[index];
    if (raw === undefined)
      return err(invalidSource(index, "Atlas source is missing"));
    const source = parseAtlasSource(raw, index);
    if (!source.ok) return source;
    sources.push(source.value);
  }
  const sourceIds = sources.map(
    ({ projection_evidence_id }) => projection_evidence_id,
  );
  if (new Set(sourceIds).size !== sourceIds.length)
    return err(
      invalidSource(0, "Atlas source Evidence identities must be unique"),
    );

  const counts = sources.reduce(
    (totals, source) => {
      const graph = "projection" in source ? source.projection : source.surface;
      totals.nodes += graph.components.length;
      totals.relationships += graph.relationships.length;
      return totals;
    },
    { nodes: 0, relationships: 0 },
  );
  if (counts.nodes > MAX_NODES || counts.relationships > MAX_RELATIONSHIPS)
    return err(
      new AnalysisResourceConstraintError(
        OPERATION,
        "capacity",
        "Atlas input exceeds the maximum node or relationship budget",
        { max_nodes: MAX_NODES, max_relationships: MAX_RELATIONSHIPS },
      ),
    );
  let atlas;
  try {
    atlas = architectureAtlasSchema.parse(buildArchitectureAtlas(sources));
  } catch {
    return err(
      invalidSource(
        0,
        "Atlas source graph identity, coverage, or relationship invariants failed",
      ),
    );
  }
  const orderedIds = [...sourceIds].sort();
  return ok(
    createEvidence(undefined, RAA_ATLAS_PROVIDER, {
      predicateType: "raa.reverse-architecture-atlas",
      operation: OPERATION,
      parameters: { source_evidence_ids: orderedIds, atlas_version: 1 },
      result: jsonValueSchema.parse(atlas),
      rawResult: null,
      confidence: "inferred",
      authority: "analyst-inference",
      environment: null,
      limitations: atlas.limitations,
      evidenceLinks: orderedIds,
    }),
  );
};
