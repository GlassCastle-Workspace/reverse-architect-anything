import { JAVASCRIPT_FEATURE_TRACE_EXAMPLE } from "../../contracts/javascript/javascriptApplicationWorkflowExamples.js";
import {
  NATIVE_TRACE_EVIDENCE,
  PACKET_CAPTURE_EVIDENCE,
} from "../../domain/architecture/architectureObservationSurface.fixture.js";
import { projectReverseArchitectureEvidence } from "./ArchitectureProjectionService.js";
import { projectObservationArchitectureEvidence } from "./ArchitectureObservationSurfaceService.js";

const application = projectReverseArchitectureEvidence({
  application: JAVASCRIPT_FEATURE_TRACE_EXAMPLE.application,
});
const native = projectObservationArchitectureEvidence({
  source_kind: "native-trace",
  evidence: NATIVE_TRACE_EVIDENCE,
});
const packet = projectObservationArchitectureEvidence({
  source_kind: "packet-capture",
  evidence: PACKET_CAPTURE_EVIDENCE,
});

if (!application.ok || !native.ok || !packet.ok)
  throw new Error("Unable to construct RAA fixture projection Evidence");

export const architectureAtlasEvidenceFixtures = {
  application: application.value,
  native: native.value,
  packet: packet.value,
} as const;

export const architectureAtlasEvidenceSources = [
  application.value,
  native.value,
  packet.value,
] as const;
