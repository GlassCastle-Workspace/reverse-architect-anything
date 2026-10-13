import { z } from "zod";

import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisInputError,
  AnalysisResourceConstraintError,
} from "../../domain/analysisErrorCore.js";
import { macOSProcessSocketSnapshotSchema } from "../../domain/architecture/macOSProcessSocketSnapshot.js";
import {
  socketPacketAssessmentInputSchema,
  socketPacketAssessmentSchema,
} from "../../domain/architecture/socketPacketAssessmentSchema.js";
import { compareSocketAndPacket } from "../../domain/architecture/socketPacketAssessment.js";
import {
  inspectPacketCaptureInputSchema,
  packetCaptureSchema,
} from "../../domain/captures/packetCapture.js";
import {
  createEvidence,
  parseEvidence,
  type Evidence,
} from "../../domain/evidence.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { jsonValueSchema } from "../../domain/jsonValue.js";
import { canonicalJson } from "../../domain/comparisonSemantics.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  RAA_MACOS_SOCKET_PROVIDER,
  RAA_SOCKET_PACKET_ASSESSMENT_PROVIDER,
} from "../InvestigationProviders.js";

const OPERATION = "assess_socket_packet_correspondence" as const;
const MAX_PACKET_WINDOW = 2_000;

const rejected = (
  field:
    | "socket_evidence"
    | "capture_evidence"
    | "frame_number"
    | "socket_observation_id",
  description: string,
): Result<never, AnalysisError> =>
  err(
    new AnalysisInputError(OPERATION, undefined, [
      {
        path: [field],
        reason: "invalid_value",
        message: description,
      },
    ]),
  );

const authenticated = (raw: Evidence): Evidence | null => {
  try {
    return parseEvidence(raw);
  } catch {
    return null;
  }
};

/**
 * Compare two previously recorded producer observations, without launching a
 * target or acquiring a packet. No reported match is an attribution proof.
 */
export const assessSocketPacketCorrespondence = (
  raw: unknown,
): Result<Evidence, AnalysisError> => {
  const parsed = socketPacketAssessmentInputSchema.safeParse(raw);
  if (!parsed.success)
    return err(
      analysisInputErrorFromIssues(OPERATION, parsed.error.issues, raw),
    );
  return assessSocketPacketCorrespondenceValidated(parsed.data);
};

export const assessSocketPacketCorrespondenceValidated = (
  input: z.output<typeof socketPacketAssessmentInputSchema>,
): Result<Evidence, AnalysisError> => {
  const socketEvidence = authenticated(input.socket_evidence);
  const captureEvidence = authenticated(input.capture_evidence);
  if (
    socketEvidence === null ||
    socketEvidence.provider.id !== RAA_MACOS_SOCKET_PROVIDER.id ||
    socketEvidence.provider.name !== RAA_MACOS_SOCKET_PROVIDER.name ||
    socketEvidence.provider.version !== RAA_MACOS_SOCKET_PROVIDER.version ||
    socketEvidence.operation !== "observe_macos_process_sockets" ||
    socketEvidence.predicate_type !== "raa.macos-process-socket-readout" ||
    socketEvidence.confidence !== "observed" ||
    socketEvidence.authority !== "external-service" ||
    socketEvidence.subject !== null
  )
    return rejected(
      "socket_evidence",
      "Expected a complete RAA macOS dual-readout socket observation Evidence",
    );

  const snapshot = macOSProcessSocketSnapshotSchema.safeParse(
    socketEvidence.normalized_result,
  );
  if (
    !snapshot.success ||
    socketEvidence.parameters.pid !== snapshot.data.process.pid
  )
    return rejected(
      "socket_evidence",
      "Socket process identity or snapshot schema differs",
    );
  if (
    captureEvidence === null ||
    captureEvidence.operation !== "inspect_packet_capture" ||
    captureEvidence.predicate_type !== "rea.analysis" ||
    captureEvidence.confidence !== "observed" ||
    captureEvidence.authority !== "shipped-artifact"
  )
    return rejected(
      "capture_evidence",
      "Expected recorded REA saved packet capture Evidence",
    );

  const reportRaw = captureEvidence.normalized_result;
  if (
    typeof reportRaw !== "object" ||
    reportRaw === null ||
    Array.isArray(reportRaw) ||
    !Array.isArray(reportRaw.packets)
  )
    return rejected(
      "capture_evidence",
      "Capture output must include a bounded packet window",
    );
  if (reportRaw.packets.length > MAX_PACKET_WINDOW)
    return err(
      new AnalysisResourceConstraintError(
        OPERATION,
        "capacity",
        "Capture selection exceeds the 2000-frame comparison budget",
        { max_frames: MAX_PACKET_WINDOW },
      ),
    );
  const report = packetCaptureSchema.safeParse(reportRaw);
  if (
    !report.success ||
    captureEvidence.subject === null ||
    captureEvidence.subject.digest.sha256 !== report.data.artifact.sha256 ||
    captureEvidence.subject.local_path !== report.data.artifact.path
  )
    return rejected(
      "capture_evidence",
      "Capture artifact or packet report identity mismatches Evidence",
    );

  const selection = inspectPacketCaptureInputSchema.safeParse(
    captureEvidence.parameters,
  );
  if (
    !selection.success ||
    canonicalJson(
      jsonValueSchema.parse(selection.data),
      "Capture selection",
    ) !==
      canonicalJson(
        jsonValueSchema.parse(report.data.selection),
        "Capture selection",
      )
  )
    return rejected(
      "capture_evidence",
      "Saved capture selection and original parameters disagree",
    );

  let assessed;
  try {
    assessed = socketPacketAssessmentSchema.parse(
      compareSocketAndPacket({
        socketEvidenceId: socketEvidence.evidence_id,
        captureEvidenceId: captureEvidence.evidence_id,
        snapshot: snapshot.data,
        report: report.data,
        socketObservationId: input.socket_observation_id,
        frameNumber: input.frame_number,
      }),
    );
  } catch {
    return rejected(
      "frame_number",
      "Selected frame/socket identity is missing or the reported contents are inconsistent",
    );
  }
  const linked = [
    socketEvidence.evidence_id,
    captureEvidence.evidence_id,
  ].sort();
  return ok(
    createEvidence(undefined, RAA_SOCKET_PACKET_ASSESSMENT_PROVIDER, {
      predicateType: "raa.socket-packet-compatibility-assessment",
      operation: OPERATION,
      parameters: {
        socket_evidence_id: socketEvidence.evidence_id,
        capture_evidence_id: captureEvidence.evidence_id,
        socket_observation_id: input.socket_observation_id,
        frame_number: input.frame_number,
        assessment_version: 1,
      },
      result: jsonValueSchema.parse(assessed),
      confidence: "inferred",
      authority: "analyst-inference",
      evidenceLinks: linked,
      limitations: [
        assessed.attribution.explanation,
        "This assessment is limited to a specific reported socket and selected saved-capture frame; no live packet acquisition or independently verified process attribution occurred.",
      ],
    }),
  );
};
