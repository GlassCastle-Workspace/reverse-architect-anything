import { z } from "zod";

import {
  RAA_ARCHITECTURE_PROVIDER,
  REA_WORKFLOW_PROVIDER,
} from "../InvestigationProviders.js";
import { observationArchitectureInputSchema } from "../../domain/architecture/architectureObservationSurfaceInput.js";
import {
  projectNativeArchitectureSurface,
  projectPacketArchitectureSurface,
  MAX_OBSERVATION_FRAMES,
} from "../../domain/architecture/architectureObservationSurface.js";
import { architectureObservationSurfaceSchema } from "../../domain/architecture/architectureObservationSurfaceSchema.js";
import {
  packetCaptureSchema,
  inspectPacketCaptureInputSchema,
} from "../../domain/captures/packetCapture.js";
import { nativeInvestigationTraceSchema } from "../../domain/native/nativeInvestigationGraph.js";
import {
  createEvidence,
  parseEvidence,
  type Evidence,
} from "../../domain/evidence.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { jsonValueSchema } from "../../domain/jsonValue.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisInputError } from "../../domain/analysisErrorCore.js";
import { err, ok, type Result } from "../../domain/result.js";
import { canonicalJson } from "../../domain/comparisonSemantics.js";

const OPERATION = "project_observation_architecture" as const;

const reject = (description: string): Result<never, AnalysisError> =>
  err(
    new AnalysisInputError(OPERATION, undefined, [
      {
        path: ["evidence"],
        reason: "invalid_value",
        message: description,
      },
    ]),
  );

/** Authenticate producer and source identity before architectural interpretation. */
export const projectObservationArchitectureEvidence = (
  rawInput: unknown,
): Result<Evidence, AnalysisError> => {
  const parsed = observationArchitectureInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return err(
      analysisInputErrorFromIssues(OPERATION, parsed.error.issues, rawInput),
    );
  return projectObservationArchitectureEvidenceValidated(parsed.data);
};

export const projectObservationArchitectureEvidenceValidated = (
  input: z.output<typeof observationArchitectureInputSchema>,
): Result<Evidence, AnalysisError> => {
  let source: Evidence;
  try {
    source = parseEvidence(input.evidence);
  } catch {
    return reject(
      "Source Evidence record or semantic digest did not authenticate",
    );
  }

  let projection: z.infer<typeof architectureObservationSurfaceSchema>;
  if (input.source_kind === "native-trace") {
    if (
      source.operation !== "trace_native_ui_action" ||
      source.predicate_type !== "rea.analysis" ||
      source.provider.id !== REA_WORKFLOW_PROVIDER.id ||
      source.provider.name !== REA_WORKFLOW_PROVIDER.name ||
      source.provider.version !== REA_WORKFLOW_PROVIDER.version ||
      source.confidence !== "derived" ||
      source.authority !== "shipped-artifact"
    )
      return reject("Expected REA's derived native UI action trace Evidence");
    const trace = nativeInvestigationTraceSchema.safeParse(
      source.normalized_result,
    );
    if (!trace.success)
      return reject("Native trace output does not match the producer schema");
    if (
      source.subject === null ||
      source.subject.digest.sha256 !== trace.data.target_sha256
    )
      return reject("Native trace artifact digest does not match its subject");
    if (
      trace.data.nodes.length > 2_000 ||
      trace.data.edges.length + trace.data.unresolved.length > 10_000
    )
      return reject(
        "Native trace exceeds bounded architecture projection limits",
      );
    try {
      projection = projectNativeArchitectureSurface(
        source.evidence_id,
        trace.data,
      );
    } catch {
      return reject(
        "Native trace contains ambiguous or duplicate source identities",
      );
    }
  } else {
    if (
      source.operation !== "inspect_packet_capture" ||
      source.predicate_type !== "rea.analysis" ||
      source.confidence !== "observed" ||
      source.authority !== "shipped-artifact"
    )
      return reject("Expected a recorded packet capture inspection Evidence");
    const report = packetCaptureSchema.safeParse(source.normalized_result);
    if (!report.success)
      return reject("Capture report failed the canonical packet schema");
    if (
      source.subject === null ||
      source.subject.digest.sha256 !== report.data.artifact.sha256 ||
      source.subject.local_path !== report.data.artifact.path
    )
      return reject(
        "Capture report path or digest does not match Evidence subject",
      );
    const parameters = inspectPacketCaptureInputSchema.safeParse(
      source.parameters,
    );
    if (
      !parameters.success ||
      canonicalJson(
        jsonValueSchema.parse(parameters.data),
        "Capture options",
      ) !==
        canonicalJson(
          jsonValueSchema.parse(report.data.selection),
          "Capture options",
        )
    )
      return reject(
        "Capture selection diverged from authenticated Evidence parameters",
      );
    if (report.data.packets.length > MAX_OBSERVATION_FRAMES)
      return reject(
        "Capture returns more frames than the projection safety budget",
      );
    try {
      projection = projectPacketArchitectureSurface(
        source.evidence_id,
        report.data,
      );
    } catch {
      return reject("Capture contains duplicate or invalid frame identities");
    }
  }

  const validated = architectureObservationSurfaceSchema.parse(projection);
  return ok(
    createEvidence(undefined, RAA_ARCHITECTURE_PROVIDER, {
      predicateType: "raa.observation-architecture-surface",
      operation: OPERATION,
      parameters: {
        source_kind: input.source_kind,
        source_evidence_id: source.evidence_id,
        surface_version: 1,
      },
      result: jsonValueSchema.parse(validated),
      rawResult: null,
      confidence: "inferred",
      authority: "analyst-inference",
      environment: null,
      limitations: validated.limitations,
      evidenceLinks: [source.evidence_id],
    }),
  );
};
