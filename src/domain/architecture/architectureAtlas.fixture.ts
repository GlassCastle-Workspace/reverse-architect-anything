import {
  buildSyntheticJavaScriptApplicationGraph,
  APPLICATION_GRAPH_DIGESTS,
} from "../javascript/javascriptApplicationGraph.fixture.js";
import {
  NATIVE_TRACE_EVIDENCE,
  PACKET_CAPTURE_EVIDENCE,
  nativeFixtureTrace,
  packetFixtureReport,
} from "./architectureObservationSurface.fixture.js";
import {
  projectNativeArchitectureSurface,
  projectPacketArchitectureSurface,
} from "./architectureObservationSurface.js";
import { projectJavaScriptArchitecture } from "./architectureProjection.js";
import type { ArchitectureAtlasSource } from "./architectureAtlas.js";

/** Pure-domain fixtures; no application-layer dependencies. */
export const atlasFixtureApplication = projectJavaScriptArchitecture(
  buildSyntheticJavaScriptApplicationGraph(),
  `ev_${"e".repeat(64)}`,
  {
    kind: "static-application",
    rootArtifactSha256: APPLICATION_GRAPH_DIGESTS.asar,
  },
);

export const atlasFixtureNative = projectNativeArchitectureSurface(
  NATIVE_TRACE_EVIDENCE.evidence_id,
  nativeFixtureTrace,
);

export const atlasFixturePacket = projectPacketArchitectureSurface(
  PACKET_CAPTURE_EVIDENCE.evidence_id,
  packetFixtureReport,
);

export const atlasFixtureSources: ArchitectureAtlasSource[] = [
  {
    projection_evidence_id: `ev_${"1".repeat(64)}`,
    projection: atlasFixtureApplication,
  },
  {
    projection_evidence_id: `ev_${"2".repeat(64)}`,
    surface: atlasFixtureNative,
  },
  {
    projection_evidence_id: `ev_${"3".repeat(64)}`,
    surface: atlasFixturePacket,
  },
];
