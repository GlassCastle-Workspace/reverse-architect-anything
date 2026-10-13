import { createEvidence } from "../evidence.js";
/** Test-only producer identity; domain fixtures cannot import application services. */
const REA_WORKFLOW_PROVIDER = {
  id: "rea-workflow",
  name: "REA composed investigation workflow",
  version: "1",
} as const;
import { nativeInvestigationTraceSchema } from "../native/nativeInvestigationGraph.js";
import {
  inspectPacketCaptureInputSchema,
  packetCaptureSchema,
} from "../captures/packetCapture.js";

export const NATIVE_FIXTURE_DIGEST = "a".repeat(64);
export const CAPTURE_FIXTURE_DIGEST = "b".repeat(64);

const location = { address: "0x1000", file_offset: 128 };
const sourceLocation = {
  kind: "symbol" as const,
  description: "Selected native symbol",
  location,
  artifact_path: "/artifacts/native.example",
  artifact_sha256: NATIVE_FIXTURE_DIGEST,
};

export const nativeFixtureTrace = nativeInvestigationTraceSchema.parse({
  target_sha256: NATIVE_FIXTURE_DIGEST,
  provider: {
    id: "fixture-native-provider",
    version: "1",
    tool_version: "1",
  },
  start: "fn:start",
  direction: "forward",
  nodes: [
    {
      id: "fn:start",
      kind: "function",
      name: "process",
      location,
      attributes: { address: "0x1000" },
      evidence: [sourceLocation],
    },
    {
      id: "fn:end",
      kind: "function",
      name: "process",
      location: { address: "0x2000", file_offset: 256 },
      attributes: {},
      evidence: [],
    },
    {
      id: "global:key",
      kind: "global_value",
      name: "globalData",
      location: null,
      attributes: {},
      evidence: [],
    },
  ],
  edges: [
    {
      id: "edge:direct",
      from: "fn:start",
      to: "fn:end",
      relation: "direct_call",
      resolution: "observed",
      evidence: [sourceLocation],
      limitations: [],
    },
    {
      id: "edge:unknown",
      from: "fn:end",
      to: null,
      relation: "indirect_call",
      resolution: "unresolved",
      reason: "Target is dynamically computed.",
      evidence: [],
      limitations: ["Indirect dispatch not resolved"],
    },
  ],
  unresolved: [
    {
      id: "edge:unknown",
      from: "fn:end",
      to: null,
      relation: "indirect_call",
      resolution: "unresolved",
      reason: "Target is dynamically computed.",
      evidence: [],
      limitations: ["Indirect dispatch not resolved"],
    },
  ],
  reached_depth: 2,
  truncated: true,
  reason: "Bounded traversal",
  coverage: [
    {
      facet: "native-call-graph",
      status: "partial",
      reason: "Indirect dispatch unavailable",
      examined: 2,
      omitted: 1,
    },
  ],
  limitations: ["Source graph has incomplete call coverage"],
});

export const NATIVE_TRACE_EVIDENCE = createEvidence(
  {
    path: "/artifacts/native.example",
    sha256: NATIVE_FIXTURE_DIGEST,
    format: "mach-o",
  },
  REA_WORKFLOW_PROVIDER,
  {
    operation: "trace_native_ui_action",
    parameters: { action: "process" },
    result: nativeFixtureTrace,
    confidence: "derived",
    authority: "shipped-artifact",
    limitations: ["Fixture: simulated native producer, not a real Hopper run"],
  },
);

const packetSelection = inspectPacketCaptureInputSchema.parse({
  path: "/artifacts/traffic.pcapng",
  fields: ["ip.src", "ip.dst", "tcp.srcport"],
  display_filter: "tcp",
  decode_as: [],
  packet_limit: 30,
  two_pass: true,
  match_offset: 1,
  match_limit: 2,
});

export const packetFixtureReport = packetCaptureSchema.parse({
  artifact: {
    path: packetSelection.path,
    sha256: CAPTURE_FIXTURE_DIGEST,
    bytes: 1024,
  },
  selection: packetSelection,
  packets: [
    {
      "frame.number": ["7"],
      "ip.src": ["198.51.100.10", "192.0.2.2"],
      "ip.dst": ["198.51.100.20"],
      "tcp.srcport": ["443"],
    },
    {
      "frame.number": ["9"],
      "ip.src": ["198.51.100.10"],
      "ip.dst": ["198.51.100.30"],
      "tcp.srcport": ["8443"],
    },
  ],
  output_window: {
    matching_packets: 4,
    returned_packets: 2,
    has_more: true,
  },
  read_scope: "up-to-input-packet-limit",
  diagnostics: "Fixture: selected frames only",
  tool: {
    configured_path: "/usr/bin/tshark",
    path: "/usr/bin/tshark",
    sha256: "c".repeat(64),
    version_banner: "TShark fixture",
    version_diagnostics: "",
    arguments: [],
  },
  configuration: "private-empty-personal-profile",
  resource_limiter: {
    configured_path: "/usr/bin/prlimit",
    path: "/usr/bin/prlimit",
    sha256: "d".repeat(64),
    arguments: [],
  },
  limits: {
    input_bytes: 4096,
    output_bytes: 4096,
    command_timeout_ms: 1000,
    address_space_bytes: 0,
    file_bytes: 0,
    cpu_seconds: 0,
  },
  hardware_acquisition: "not-performed",
});

export const PACKET_CAPTURE_EVIDENCE = createEvidence(
  {
    path: packetSelection.path,
    sha256: CAPTURE_FIXTURE_DIGEST,
    format: "file",
  },
  {
    id: "fixture-tshark-inspection",
    name: "Synthetic capture producer",
    version: "1",
  },
  {
    operation: "inspect_packet_capture",
    parameters: packetSelection,
    result: packetFixtureReport,
    confidence: "observed",
    authority: "shipped-artifact",
    limitations: ["Fixture: synthetic packets, not a real TShark observation"],
  },
);
