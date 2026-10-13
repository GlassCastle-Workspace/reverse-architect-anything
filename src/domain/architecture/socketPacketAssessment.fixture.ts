import { createEvidence } from "../evidence.js";
import {
  buildMacOSProcessSocketSnapshot,
  parseMacOSBootTime,
} from "./macOSSocketReadout.js";
import { packetCaptureSchema } from "../captures/packetCapture.js";
import {
  packetFixtureReport,
  PACKET_CAPTURE_EVIDENCE,
} from "./architectureObservationSurface.fixture.js";

/**
 * Synthetic test-only OS readouts and saved capture report. No network
 * observations, process execution or capture acquisition occur here.
 */
const boot = parseMacOSBootTime("{ sec = 1791552720, usec = 300323 }");
const stable = {
  file_descriptor: "11u",
  protocol: "TCP" as const,
  endpoint: "127.0.0.1:51000->127.0.0.1:443",
  tcp_state: "ESTABLISHED",
};
const listener = {
  file_descriptor: "12u",
  protocol: "TCP" as const,
  endpoint: "127.0.0.1:9000",
  tcp_state: "LISTEN",
};
const transient = {
  file_descriptor: "13u",
  protocol: "UDP" as const,
  endpoint: "127.0.0.1:5353",
  tcp_state: null,
};

export const SOCKET_PACKET_TEST_SNAPSHOT = buildMacOSProcessSocketSnapshot({
  pid: 4321,
  boot,
  process_start_lstart: "Tue Oct 13 10:35:00 2026",
  observed_from: "2026-10-13T14:01:00.000Z",
  observed_until: "2026-10-13T14:01:01.000Z",
  first: [stable, listener, transient],
  second: [stable, listener],
});

export const SOCKET_PACKET_TEST_SOCKET =
  SOCKET_PACKET_TEST_SNAPSHOT.sockets.find(
    ({ file_descriptor }) => file_descriptor === stable.file_descriptor,
  )!;
export const SOCKET_PACKET_TEST_LISTENER =
  SOCKET_PACKET_TEST_SNAPSHOT.sockets.find(
    ({ file_descriptor }) => file_descriptor === listener.file_descriptor,
  )!;
export const SOCKET_PACKET_TEST_TRANSIENT =
  SOCKET_PACKET_TEST_SNAPSHOT.sockets.find(
    ({ file_descriptor }) => file_descriptor === transient.file_descriptor,
  )!;

const time = String(Date.parse("2026-10-13T14:01:00.500Z") / 1000);
export const SOCKET_PACKET_TEST_REPORT = packetCaptureSchema.parse({
  ...packetFixtureReport,
  selection: {
    ...packetFixtureReport.selection,
    fields: [
      "ip.src",
      "ip.dst",
      "tcp.srcport",
      "tcp.dstport",
      "frame.time_epoch",
    ],
    display_filter: null,
    packet_limit: null,
    match_offset: 0,
    match_limit: 50,
  },
  packets: [
    {
      "frame.number": ["7"],
      "ip.src": ["127.0.0.1"],
      "ip.dst": ["127.0.0.1"],
      "tcp.srcport": ["51000"],
      "tcp.dstport": ["443"],
      "frame.time_epoch": [time],
    },
    {
      "frame.number": ["9"],
      "ip.src": ["127.0.0.1"],
      "ip.dst": ["127.0.0.1"],
      "tcp.srcport": ["443"],
      "tcp.dstport": ["51000"],
      "frame.time_epoch": [time],
    },
    {
      "frame.number": ["10"],
      "ip.src": ["127.0.0.1"],
      "ip.dst": ["127.0.0.1"],
      "tcp.srcport": ["8888"],
      "tcp.dstport": ["443"],
      "frame.time_epoch": [time],
    },
  ],
  output_window: {
    matching_packets: 3,
    returned_packets: 3,
    has_more: false,
  },
  read_scope: "to-eof",
});

const SOCKET_PROVIDER = {
  id: "raa-macos-socket-readout",
  name: "RAA macOS passive process socket reader",
  version: "1",
} as const;

export const SOCKET_PACKET_TEST_SOCKET_EVIDENCE = createEvidence(
  undefined,
  SOCKET_PROVIDER,
  {
    operation: "observe_macos_process_sockets",
    predicateType: "raa.macos-process-socket-readout",
    parameters: { pid: SOCKET_PACKET_TEST_SNAPSHOT.process.pid },
    result: SOCKET_PACKET_TEST_SNAPSHOT,
    confidence: "observed",
    authority: "external-service",
    subjectUnavailableReason:
      "Synthetic process observation has no immutable artifact",
    limitations: SOCKET_PACKET_TEST_SNAPSHOT.limitations,
  },
);

export const SOCKET_PACKET_TEST_CAPTURE_EVIDENCE = createEvidence(
  {
    path: SOCKET_PACKET_TEST_REPORT.artifact.path,
    sha256: SOCKET_PACKET_TEST_REPORT.artifact.sha256,
    format: "file",
  },
  PACKET_CAPTURE_EVIDENCE.provider,
  {
    operation: "inspect_packet_capture",
    parameters: SOCKET_PACKET_TEST_REPORT.selection,
    result: SOCKET_PACKET_TEST_REPORT,
    confidence: "observed",
    authority: "shipped-artifact",
    limitations: ["Synthetic packet selection; no actual capture acquired"],
  },
);

export const SOCKET_PACKET_TEST_REQUEST = {
  socket_evidence: SOCKET_PACKET_TEST_SOCKET_EVIDENCE,
  capture_evidence: SOCKET_PACKET_TEST_CAPTURE_EVIDENCE,
  socket_observation_id: SOCKET_PACKET_TEST_SOCKET.socket_observation_id,
  frame_number: "7",
} as const;
