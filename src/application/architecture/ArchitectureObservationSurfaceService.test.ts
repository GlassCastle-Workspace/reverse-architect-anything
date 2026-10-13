import { describe, expect, it } from "vitest";

import { REA_WORKFLOW_PROVIDER } from "../InvestigationProviders.js";
import {
  NATIVE_TRACE_EVIDENCE,
  PACKET_CAPTURE_EVIDENCE,
  NATIVE_FIXTURE_DIGEST,
  nativeFixtureTrace,
  packetFixtureReport,
} from "../../domain/architecture/architectureObservationSurface.fixture.js";
import { createEvidence, parseEvidence } from "../../domain/evidence.js";
import {
  projectObservationArchitectureEvidence,
  projectObservationArchitectureEvidenceValidated,
} from "./ArchitectureObservationSurfaceService.js";

const nativeRequest = {
  source_kind: "native-trace" as const,
  evidence: NATIVE_TRACE_EVIDENCE,
};
const packetRequest = {
  source_kind: "packet-capture" as const,
  evidence: PACKET_CAPTURE_EVIDENCE,
};

describe("architectural native and packet Evidence projection", () => {
  it("derives cryptographically linked, deterministic native Evidence", () => {
    const first = projectObservationArchitectureEvidence(nativeRequest);
    const replay =
      projectObservationArchitectureEvidenceValidated(nativeRequest);
    if (!first.ok || !replay.ok)
      throw new Error("Valid native source rejected");
    expect(first.value.evidence_id).toBe(replay.value.evidence_id);
    expect(parseEvidence(first.value)).toEqual(first.value);
    expect(first.value).toMatchObject({
      operation: "project_observation_architecture",
      predicate_type: "raa.observation-architecture-surface",
      authority: "analyst-inference",
      confidence: "inferred",
      evidence_links: [NATIVE_TRACE_EVIDENCE.evidence_id],
      normalized_result: {
        source_kind: "native-trace",
        source_evidence_id: NATIVE_TRACE_EVIDENCE.evidence_id,
        source_target_sha256: NATIVE_FIXTURE_DIGEST,
        summary: { components: 3, relationships: 2, unresolved: 1 },
      },
    });
  });

  it("preserves selected network fields and source scope in derived Evidence", () => {
    const result = projectObservationArchitectureEvidence(packetRequest);
    if (!result.ok) throw new Error("Valid packet source rejected");
    expect(parseEvidence(result.value)).toEqual(result.value);
    expect(result.value).toMatchObject({
      evidence_links: [PACKET_CAPTURE_EVIDENCE.evidence_id],
      normalized_result: {
        source_kind: "packet-capture",
        source_evidence_id: PACKET_CAPTURE_EVIDENCE.evidence_id,
        summary: { components: 2, relationships: 0 },
      },
    });
  });

  it("rejects wrong producer families, malformed inputs, or forged source Evidence", () => {
    expect(
      projectObservationArchitectureEvidence({
        ...nativeRequest,
        source_kind: "packet-capture",
      }).ok,
    ).toBe(false);
    expect(
      projectObservationArchitectureEvidence({
        ...packetRequest,
        source_kind: "native-trace",
      }).ok,
    ).toBe(false);
    expect(
      projectObservationArchitectureEvidence({
        source_kind: "native-trace",
        evidence: {},
      }).ok,
    ).toBe(false);
    expect(
      projectObservationArchitectureEvidence({
        ...nativeRequest,
        evidence: {
          ...NATIVE_TRACE_EVIDENCE,
          provider: {
            ...NATIVE_TRACE_EVIDENCE.provider,
            id: "untrusted",
          },
        },
      }).ok,
    ).toBe(false);
  });

  it("rejects native target mismatch even when the source Evidence digest is internally valid", () => {
    const mismatch = createEvidence(
      {
        path: "/artifacts/native.example",
        sha256: "e".repeat(64),
        format: "mach-o",
      },
      REA_WORKFLOW_PROVIDER,
      {
        operation: "trace_native_ui_action",
        parameters: { action: "process" },
        result: nativeFixtureTrace,
        confidence: "derived",
        authority: "shipped-artifact",
      },
    );
    expect(
      projectObservationArchitectureEvidence({
        source_kind: "native-trace",
        evidence: mismatch,
      }).ok,
    ).toBe(false);
  });

  it("rejects a packet producer whose authenticated request differs from report selection", () => {
    const divergent = createEvidence(
      {
        path: packetFixtureReport.artifact.path,
        sha256: packetFixtureReport.artifact.sha256,
        format: "file",
      },
      PACKET_CAPTURE_EVIDENCE.provider,
      {
        operation: "inspect_packet_capture",
        parameters: {
          ...packetFixtureReport.selection,
          display_filter: "dns",
        },
        result: packetFixtureReport,
        confidence: "observed",
        authority: "shipped-artifact",
      },
    );
    expect(
      projectObservationArchitectureEvidence({
        source_kind: "packet-capture",
        evidence: divergent,
      }).ok,
    ).toBe(false);
  });

  it("rejects duplicate frame identities carried by otherwise valid capture Evidence", () => {
    const firstFrame = packetFixtureReport.packets[0];
    if (firstFrame === undefined) throw new Error("Missing fixture frame");
    const report = {
      ...packetFixtureReport,
      packets: [firstFrame, firstFrame],
    };
    const source = createEvidence(
      {
        path: report.artifact.path,
        sha256: report.artifact.sha256,
        format: "file",
      },
      PACKET_CAPTURE_EVIDENCE.provider,
      {
        operation: "inspect_packet_capture",
        parameters: report.selection,
        result: report,
        confidence: "observed",
      },
    );
    expect(
      projectObservationArchitectureEvidence({
        source_kind: "packet-capture",
        evidence: source,
      }).ok,
    ).toBe(false);
  });
});
