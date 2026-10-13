import { expect, it } from "vitest";

import { createEvidence, parseEvidence } from "../../domain/evidence.js";
import { socketPacketAssessmentSchema } from "../../domain/architecture/socketPacketAssessmentSchema.js";
import {
  SOCKET_PACKET_TEST_REQUEST as request,
  SOCKET_PACKET_TEST_REPORT as report,
} from "../../domain/architecture/socketPacketAssessment.fixture.js";
import {
  assessSocketPacketCorrespondence,
  assessSocketPacketCorrespondenceValidated,
} from "./SocketPacketAssessmentService.js";

it("emits deterministic source-linked inferred Evidence with explicitly unverified attribution", () => {
  const direct = assessSocketPacketCorrespondence(request);
  const validated = assessSocketPacketCorrespondenceValidated(request);
  if (!direct.ok || !validated.ok)
    throw new Error("Valid source Evidence rejected");
  expect(parseEvidence(direct.value)).toEqual(direct.value);
  expect(direct.value.evidence_id).toBe(validated.value.evidence_id);
  expect(direct.value).toMatchObject({
    operation: "assess_socket_packet_correspondence",
    predicate_type: "raa.socket-packet-compatibility-assessment",
    confidence: "inferred",
    authority: "analyst-inference",
    evidence_links: [
      request.capture_evidence.evidence_id,
      request.socket_evidence.evidence_id,
    ].sort(),
  });
  const comparison = socketPacketAssessmentSchema.parse(
    direct.value.normalized_result,
  );
  expect(comparison.comparison.reported_tuple).toBe("matches-outbound");
  expect(comparison.attribution).toMatchObject({
    verification: "not-established",
    independently_verified: false,
    process_packet_relationships: [],
  });
});

it("rejects semantic Evidence tampering and impersonated source operations", () => {
  for (const item of [
    { ...request.socket_evidence, operation: "inventory_artifact" },
    {
      ...request.socket_evidence,
      provider: { ...request.socket_evidence.provider, id: "forged" },
    },
  ])
    expect(
      assessSocketPacketCorrespondence({
        ...request,
        socket_evidence: item,
      }).ok,
    ).toBe(false);
  for (const item of [
    { ...request.capture_evidence, operation: "another-operation" },
    {
      ...request.capture_evidence,
      evidence_links: [request.socket_evidence.evidence_id],
    },
  ])
    expect(
      assessSocketPacketCorrespondence({
        ...request,
        capture_evidence: item,
      }).ok,
    ).toBe(false);
});

it("rejects separately hash-committed capture report mismatching subject or original query selection", () => {
  const source = request.capture_evidence;
  const target = {
    path: report.artifact.path,
    sha256: report.artifact.sha256,
    format: "file" as const,
  };
  const wrongSubject = createEvidence(
    { ...target, sha256: "d".repeat(64) },
    source.provider,
    {
      operation: "inspect_packet_capture",
      parameters: report.selection,
      result: report,
      confidence: "observed",
      authority: "shipped-artifact",
    },
  );
  expect(
    assessSocketPacketCorrespondence({
      ...request,
      capture_evidence: wrongSubject,
    }).ok,
  ).toBe(false);
  const changedSelection = createEvidence(target, source.provider, {
    operation: "inspect_packet_capture",
    parameters: { ...report.selection, display_filter: "udp" },
    result: report,
    confidence: "observed",
    authority: "shipped-artifact",
  });
  expect(
    assessSocketPacketCorrespondence({
      ...request,
      capture_evidence: changedSelection,
    }).ok,
  ).toBe(false);
});

it("rejects a separately valid snapshot with a mismatched queried PID", () => {
  const source = request.socket_evidence;
  const result = createEvidence(undefined, source.provider, {
    operation: "observe_macos_process_sockets",
    predicateType: "raa.macos-process-socket-readout",
    parameters: { pid: 999 },
    result: source.normalized_result,
    confidence: "observed",
    authority: "external-service",
  });
  expect(
    assessSocketPacketCorrespondence({
      ...request,
      socket_evidence: result,
    }).ok,
  ).toBe(false);
});

it("refuses arbitrary or duplicated frame/socket selection without a matching source observation", () => {
  for (const selection of [
    { ...request, frame_number: "444" },
    { ...request, socket_observation_id: `raa_socketobs_${"f".repeat(64)}` },
    { ...request, frame_number: "7; ls" },
    { ...request, socket_observation_id: "temporary-socket-id" },
  ])
    expect(assessSocketPacketCorrespondence(selection).ok).toBe(false);
});

it("rejects malformed request or missing evidence rather than looking up other users or providers", () => {
  for (const input of [
    {},
    { ...request, capture_evidence: {} },
    { ...request, socket_evidence: {} },
    { ...request, unknown: "123" },
    null,
  ])
    expect(assessSocketPacketCorrespondence(input).ok).toBe(false);
});
