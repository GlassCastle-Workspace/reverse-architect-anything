import { isIP } from "node:net";

import type { MacOSProcessSocketSnapshot } from "./macOSProcessSocketSnapshot.js";
import type { macOSSocketEntrySchema } from "./macOSProcessSocketSnapshot.js";
import type { z } from "zod";
import type { packetCaptureSchema } from "../captures/packetCapture.js";
import type { SocketPacketAssessment } from "./socketPacketAssessmentSchema.js";

type Socket = z.infer<typeof macOSSocketEntrySchema>;
type PacketReport = z.infer<typeof packetCaptureSchema>;
type Packet = PacketReport["packets"][number];
type Endpoint = SocketPacketAssessment["socket"]["parsed_local"];
type Finding = SocketPacketAssessment["findings"][number];
type TupleStatus = SocketPacketAssessment["comparison"]["reported_tuple"];

const integerPort = (raw: string): number | null => {
  if (!/^[0-9]{1,5}$/u.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 65535 ? n : null;
};

/**
 * Strict, literal IP:port only. Wildcards, hostnames, services, zone-id scope,
 * NAT rewrites, unix sockets and ambiguous unbracketed IPv6 are NOT parsed.
 */
const endpoint = (raw: string): Endpoint => {
  const value = /^(\[[^\]]+\]|[^:\s[\]]+):([0-9]{1,5})$/u.exec(raw);
  if (value === null) return null;
  const port = integerPort(value[2] ?? "");
  const token = value[1] ?? "";
  const address = token.startsWith("[") ? token.slice(1, -1) : token;
  if (port === null || isIP(address) === 0 || address.includes("%"))
    return null;
  return { address, port };
};

const socketEndpoints = (socket: Socket) => {
  const parts = socket.endpoint.split("->");
  if (parts.length !== 2)
    return { local: endpoint(parts[0] ?? ""), peer: null };
  return {
    local: endpoint(parts[0] ?? ""),
    peer: endpoint(parts[1] ?? ""),
  };
};

const uniqueField = (packet: Packet, field: string): string | null => {
  const values = packet[field];
  return Array.isArray(values) && values.length === 1
    ? (values[0] ?? null)
    : null;
};

const packetEndpoint = (
  packet: Packet,
  addressField: string,
  portField: string,
): Endpoint => {
  const addr = uniqueField(packet, addressField);
  const rawPort = uniqueField(packet, portField);
  const port = rawPort === null ? null : integerPort(rawPort);
  if (addr === null || port === null || isIP(addr) === 0 || addr.includes("%"))
    return null;
  return { address: addr, port };
};

/** No heuristic precedence when encapsulated fields contain multiple tuples. */
const selectedPacket = (packet: Packet) => {
  const protocolVariants = (["tcp", "udp"] as const).filter(
    (kind) =>
      packet[`${kind}.srcport`] !== undefined ||
      packet[`${kind}.dstport`] !== undefined,
  );
  const ipFamilies = (["ip", "ipv6"] as const).filter(
    (kind) =>
      packet[`${kind}.src`] !== undefined ||
      packet[`${kind}.dst`] !== undefined,
  );
  const kind = protocolVariants.length === 1 ? protocolVariants[0] : null;
  const family = ipFamilies.length === 1 ? ipFamilies[0] : null;
  const source =
    kind !== null && family !== null
      ? packetEndpoint(packet, `${family}.src`, `${kind}.srcport`)
      : null;
  const destination =
    kind !== null && family !== null
      ? packetEndpoint(packet, `${family}.dst`, `${kind}.dstport`)
      : null;
  return {
    reported_protocol:
      kind === null
        ? null
        : kind === "tcp"
          ? ("TCP" as const)
          : ("UDP" as const),
    source,
    destination,
  };
};

const same = (left: Endpoint, right: Endpoint): boolean =>
  left !== null &&
  right !== null &&
  left.address === right.address &&
  left.port === right.port;

const compareTuple = (
  socket: Socket,
  local: Endpoint,
  peer: Endpoint,
  packet: ReturnType<typeof selectedPacket>,
): TupleStatus => {
  if (
    socket.tcp_state === "LISTEN" ||
    local === null ||
    peer === null ||
    packet.source === null ||
    packet.destination === null ||
    packet.reported_protocol === null
  )
    return "not-comparable";
  if (packet.reported_protocol !== socket.protocol)
    return "different-reported-tuple";
  if (same(local, packet.source) && same(peer, packet.destination))
    return "matches-outbound";
  if (same(local, packet.destination) && same(peer, packet.source))
    return "matches-inbound";
  return "different-reported-tuple";
};

/** Millisecond conversion is an explicit truncation of epoch fractional precision. */
const packetTime = (packet: Packet): string | null => {
  const raw = uniqueField(packet, "frame.time_epoch");
  const parsed = /^([0-9]{9,12})(?:\.([0-9]{1,9}))?$/u.exec(raw ?? "");
  if (parsed === null) return null;
  const millis =
    Number(parsed[1]) * 1000 +
    Number((parsed[2] ?? "").padEnd(3, "0").slice(0, 3));
  if (!Number.isSafeInteger(millis)) return null;
  const time = new Date(millis);
  return Number.isFinite(time.valueOf()) ? time.toISOString() : null;
};

const EXPLANATION =
  "A match compares two *reported* tuples, not a packet emission event. Neither lsof sample provides continuous process/socket ownership; frame timestamps and capture vantage are not synchronized or authenticated. PID and descriptor reuse, NAT, aliases, and other processes can explain identical values. No packet-to-process relationship is independently verified.";

export const compareSocketAndPacket = (input: {
  socketEvidenceId: string;
  captureEvidenceId: string;
  snapshot: MacOSProcessSocketSnapshot;
  report: PacketReport;
  socketObservationId: string;
  frameNumber: string;
}): SocketPacketAssessment => {
  const { snapshot, report } = input;
  const sockets = snapshot.sockets.filter(
    (entry) => entry.socket_observation_id === input.socketObservationId,
  );
  const frames = report.packets.filter(
    (entry) => entry["frame.number"][0] === input.frameNumber,
  );
  if (sockets.length !== 1 || frames.length !== 1)
    throw new TypeError(
      "Selected socket or packet frame identity is missing or duplicated",
    );
  const socket = sockets[0]!;
  const frame = frames[0]!;
  const parsedSocket = socketEndpoints(socket);
  const parsedPacket = selectedPacket(frame);
  const tuple = compareTuple(
    socket,
    parsedSocket.local,
    parsedSocket.peer,
    parsedPacket,
  );
  const time = packetTime(frame);
  const when =
    time === null
      ? ("not-comparable" as const)
      : Date.parse(time) < Date.parse(snapshot.observed_from)
        ? ("before-readout-window" as const)
        : Date.parse(time) > Date.parse(snapshot.observed_until)
          ? ("after-readout-window" as const)
          : ("inside-readout-window" as const);
  const findings: Finding[] = [
    "pid-reuse-cannot-be-excluded",
    "socket-reuse-cannot-be-excluded",
    "network-vantage-or-nat-unverified",
    "clock-alignment-unverified",
    "no-independent-packet-to-socket-emission-event",
  ];
  if (
    parsedPacket.source === null ||
    parsedPacket.destination === null ||
    parsedPacket.reported_protocol === null
  )
    findings.push("missing-or-ambiguous-packet-fields");
  if (
    socket.tcp_state === "LISTEN" ||
    parsedSocket.local === null ||
    parsedSocket.peer === null
  )
    findings.push("opaque-or-listening-socket");
  if (tuple === "different-reported-tuple")
    findings.push("reported-protocol-or-tuple-difference");
  if (when === "not-comparable") findings.push("packet-time-unavailable");
  else if (when !== "inside-readout-window")
    findings.push("packet-reported-outside-readout-window");
  if (socket.stability !== "reported-in-both-readouts")
    findings.push("socket-not-present-in-both-readouts");
  if (
    report.selection.display_filter !== null ||
    report.selection.match_offset > 0 ||
    report.output_window.has_more ||
    report.read_scope !== "to-eof"
  )
    findings.push("capture-selection-is-partial");

  return {
    schema: "RAASocketPacketAssessment",
    version: 1,
    socket_evidence_id: input.socketEvidenceId,
    capture_evidence_id: input.captureEvidenceId,
    capture_artifact_sha256: report.artifact.sha256,
    socket_observation_id: socket.socket_observation_id,
    frame_number: frame["frame.number"][0],
    process: {
      pid: snapshot.process.pid,
      process_instance_id: snapshot.process.process_instance_id,
      identity_precision: snapshot.process.start_identity_precision,
      boot_seconds: snapshot.process.boot_seconds,
      boot_microseconds: snapshot.process.boot_microseconds,
      start_label: snapshot.process.process_start_lstart,
    },
    socket: {
      file_descriptor: socket.file_descriptor,
      socket_protocol: socket.protocol,
      original_endpoint: socket.endpoint,
      tcp_state: socket.tcp_state,
      sampling: socket.stability,
      parsed_local: parsedSocket.local,
      parsed_peer: parsedSocket.peer,
    },
    packet: {
      ...parsedPacket,
      reported_epoch: uniqueField(frame, "frame.time_epoch"),
    },
    comparison: {
      reported_tuple: tuple,
      reported_time: when,
      socket_readout_from: snapshot.observed_from,
      socket_readout_until: snapshot.observed_until,
      packet_reported_time: time,
      clock_alignment: "unverified",
      capture_vantage: "unverified",
      process_socket_lifecycle: "point-in-time-only",
    },
    findings,
    attribution: {
      verification: "not-established",
      independently_verified: false,
      process_packet_relationships: [],
      explanation: EXPLANATION,
    },
  };
};
