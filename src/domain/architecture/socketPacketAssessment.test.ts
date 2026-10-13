import { expect, it } from "vitest";

import { packetCaptureSchema } from "../captures/packetCapture.js";
import {
  buildMacOSProcessSocketSnapshot,
  parseMacOSBootTime,
} from "./macOSSocketReadout.js";
import { compareSocketAndPacket } from "./socketPacketAssessment.js";
import { socketPacketAssessmentSchema } from "./socketPacketAssessmentSchema.js";
import {
  SOCKET_PACKET_TEST_REPORT,
  SOCKET_PACKET_TEST_REQUEST,
  SOCKET_PACKET_TEST_SNAPSHOT,
  SOCKET_PACKET_TEST_SOCKET,
  SOCKET_PACKET_TEST_LISTENER,
  SOCKET_PACKET_TEST_TRANSIENT,
} from "./socketPacketAssessment.fixture.js";

const original = {
  socketEvidenceId: SOCKET_PACKET_TEST_REQUEST.socket_evidence.evidence_id,
  captureEvidenceId: SOCKET_PACKET_TEST_REQUEST.capture_evidence.evidence_id,
  snapshot: SOCKET_PACKET_TEST_SNAPSHOT,
  report: SOCKET_PACKET_TEST_REPORT,
  socketObservationId: SOCKET_PACKET_TEST_SOCKET.socket_observation_id,
  frameNumber: "7",
};

it("recognizes only reported outbound tuple compatibility, never packet attribution", () => {
  const result = compareSocketAndPacket(original);
  expect(socketPacketAssessmentSchema.parse(result)).toEqual(result);
  expect(result.comparison).toMatchObject({
    reported_tuple: "matches-outbound",
    reported_time: "inside-readout-window",
    clock_alignment: "unverified",
    capture_vantage: "unverified",
  });
  expect(result.socket.sampling).toBe("reported-in-both-readouts");
  expect(result.process.process_instance_id).toBe(
    SOCKET_PACKET_TEST_SNAPSHOT.process.process_instance_id,
  );
  expect(result.attribution).toMatchObject({
    verification: "not-established",
    independently_verified: false,
    process_packet_relationships: [],
  });
  expect(result.findings).toContain(
    "no-independent-packet-to-socket-emission-event",
  );
});

it("distinguishes inbound, different tuple, and listener from a proven emission", () => {
  const incoming = compareSocketAndPacket({ ...original, frameNumber: "9" });
  expect(incoming.comparison.reported_tuple).toBe("matches-inbound");
  const mismatch = compareSocketAndPacket({ ...original, frameNumber: "10" });
  expect(mismatch.comparison.reported_tuple).toBe("different-reported-tuple");
  expect(mismatch.findings).toContain("reported-protocol-or-tuple-difference");
  expect(mismatch.attribution.independently_verified).toBe(false);
  const listener = compareSocketAndPacket({
    ...original,
    socketObservationId: SOCKET_PACKET_TEST_LISTENER.socket_observation_id,
  });
  expect(listener.comparison.reported_tuple).toBe("not-comparable");
  expect(listener.findings).toContain("opaque-or-listening-socket");
});

it("treats incomplete and multilayer packet fields as unknown instead of choosing a layer", () => {
  const sample = SOCKET_PACKET_TEST_REPORT.packets[0]!;
  const capture = packetCaptureSchema.parse({
    ...SOCKET_PACKET_TEST_REPORT,
    packets: [
      {
        ...sample,
        "ip.src": ["127.0.0.1", "198.51.100.8"],
        "tcp.dstport": ["443", "8080"],
      },
    ],
    output_window: {
      matching_packets: 1,
      returned_packets: 1,
      has_more: false,
    },
  });
  const result = compareSocketAndPacket({ ...original, report: capture });
  expect(result.comparison.reported_tuple).toBe("not-comparable");
  expect(result.findings).toContain("missing-or-ambiguous-packet-fields");
  expect(result.attribution.independently_verified).toBe(false);
});

it("exposes missing timestamps and raw-clock separation without treating them as proof", () => {
  const packet = SOCKET_PACKET_TEST_REPORT.packets[0]!;
  const absent = packetCaptureSchema.parse({
    ...SOCKET_PACKET_TEST_REPORT,
    packets: [
      {
        ...packet,
        "frame.time_epoch": [],
      },
    ],
    output_window: {
      matching_packets: 1,
      returned_packets: 1,
      has_more: false,
    },
  });
  const unknown = compareSocketAndPacket({ ...original, report: absent });
  expect(unknown.comparison.reported_time).toBe("not-comparable");
  expect(unknown.findings).toContain("packet-time-unavailable");

  const outside = packetCaptureSchema.parse({
    ...SOCKET_PACKET_TEST_REPORT,
    packets: [
      {
        ...packet,
        "frame.time_epoch": [
          String(Date.parse("2026-10-13T13:58:00.000Z") / 1000),
        ],
      },
    ],
    output_window: {
      matching_packets: 1,
      returned_packets: 1,
      has_more: false,
    },
  });
  const earlier = compareSocketAndPacket({ ...original, report: outside });
  expect(earlier.comparison.reported_time).toBe("before-readout-window");
  expect(earlier.findings).toContain("packet-reported-outside-readout-window");
  expect(earlier.attribution.verification).toBe("not-established");
});

it("does not collapse PID reuse or socket reuse despite identical reported endpoints", () => {
  const endpoint = {
    file_descriptor: "11u",
    protocol: "TCP" as const,
    endpoint: "127.0.0.1:51000->127.0.0.1:443",
    tcp_state: "ESTABLISHED",
  };
  const shadow = buildMacOSProcessSocketSnapshot({
    pid: 4322,
    boot: parseMacOSBootTime("{ sec = 1791552720, usec = 300323 }"),
    process_start_lstart: "Tue Oct 13 10:35:01 2026",
    observed_from: "2026-10-13T14:02:00.000Z",
    observed_until: "2026-10-13T14:02:01.000Z",
    first: [endpoint],
    second: [endpoint],
  });
  const result = compareSocketAndPacket({
    ...original,
    snapshot: shadow,
    socketObservationId: shadow.sockets[0]!.socket_observation_id,
  });
  expect(result.comparison.reported_tuple).toBe("matches-outbound");
  expect(result.comparison.reported_time).toBe("before-readout-window");
  expect(result.process.process_instance_id).not.toBe(
    SOCKET_PACKET_TEST_SNAPSHOT.process.process_instance_id,
  );
  expect(result.socket_observation_id).not.toBe(
    SOCKET_PACKET_TEST_SOCKET.socket_observation_id,
  );
  expect(result.attribution.independently_verified).toBe(false);
});

it("preserves readout instability rather than treating a transient descriptor as continuous ownership", () => {
  const result = compareSocketAndPacket({
    ...original,
    socketObservationId: SOCKET_PACKET_TEST_TRANSIENT.socket_observation_id,
  });
  expect(result.socket.sampling).toBe("first-readout-only");
  expect(result.findings).toContain("socket-not-present-in-both-readouts");
  expect(result.comparison.reported_tuple).toBe("not-comparable");
});

it("rejects missing, duplicated or confused selected frame and socket identities", () => {
  expect(() =>
    compareSocketAndPacket({
      ...original,
      frameNumber: "999",
    }),
  ).toThrow(/missing or duplicated/u);
  expect(() =>
    compareSocketAndPacket({
      ...original,
      socketObservationId: `raa_socketobs_${"0".repeat(64)}`,
    }),
  ).toThrow(/missing or duplicated/u);
  const duplicate = packetCaptureSchema.parse({
    ...SOCKET_PACKET_TEST_REPORT,
    packets: [
      SOCKET_PACKET_TEST_REPORT.packets[0],
      SOCKET_PACKET_TEST_REPORT.packets[0],
    ],
    output_window: {
      matching_packets: 2,
      returned_packets: 2,
      has_more: false,
    },
  });
  expect(() =>
    compareSocketAndPacket({ ...original, report: duplicate }),
  ).toThrow(/missing or duplicated/u);
});

it("supports exact bracketed IPv6 tuples without confusing IPv4 and IPv6 layers", () => {
  const nativeSocket = {
    file_descriptor: "17u",
    protocol: "TCP" as const,
    endpoint: "[::1]:51000->[::1]:443",
    tcp_state: "ESTABLISHED",
  };
  const snapshot = buildMacOSProcessSocketSnapshot({
    pid: 4321,
    boot: parseMacOSBootTime("{ sec = 1791552720, usec = 300323 }"),
    process_start_lstart: "Tue Oct 13 10:35:00 2026",
    observed_from: "2026-10-13T14:01:00.000Z",
    observed_until: "2026-10-13T14:01:01.000Z",
    first: [nativeSocket],
    second: [nativeSocket],
  });
  const frame = SOCKET_PACKET_TEST_REPORT.packets[0]!;
  const report = packetCaptureSchema.parse({
    ...SOCKET_PACKET_TEST_REPORT,
    packets: [
      {
        "frame.number": frame["frame.number"],
        "ipv6.src": ["::1"],
        "ipv6.dst": ["::1"],
        "tcp.srcport": ["51000"],
        "tcp.dstport": ["443"],
        "frame.time_epoch": frame["frame.time_epoch"],
      },
    ],
    output_window: {
      matching_packets: 1,
      returned_packets: 1,
      has_more: false,
    },
  });
  const match = compareSocketAndPacket({
    ...original,
    snapshot,
    socketObservationId: snapshot.sockets[0]!.socket_observation_id,
    report,
  });
  expect(match.comparison.reported_tuple).toBe("matches-outbound");
  expect(match.attribution.independently_verified).toBe(false);

  const ambiguous = packetCaptureSchema.parse({
    ...report,
    packets: [
      {
        ...report.packets[0]!,
        "ip.src": ["127.0.0.1"],
        "ip.dst": ["127.0.0.1"],
      },
    ],
  });
  expect(
    compareSocketAndPacket({
      ...original,
      snapshot,
      socketObservationId: snapshot.sockets[0]!.socket_observation_id,
      report: ambiguous,
    }).comparison.reported_tuple,
  ).toBe("not-comparable");
});

it("treats protocol disagreement as disagreement between reports, not a process-level negative", () => {
  const report = packetCaptureSchema.parse({
    ...SOCKET_PACKET_TEST_REPORT,
    packets: [
      {
        "frame.number": ["7"],
        "ip.src": ["127.0.0.1"],
        "ip.dst": ["127.0.0.1"],
        "udp.srcport": ["51000"],
        "udp.dstport": ["443"],
      },
    ],
    output_window: {
      matching_packets: 1,
      returned_packets: 1,
      has_more: false,
    },
  });
  const result = compareSocketAndPacket({ ...original, report });
  expect(result.comparison.reported_tuple).toBe("different-reported-tuple");
  expect(result.comparison.reported_time).toBe("not-comparable");
  expect(result.attribution.verification).toBe("not-established");
});
