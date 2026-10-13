import { z } from "zod";

import { prefixedDigestSchema, digestSchema } from "../digests.js";
import { evidenceSchema } from "../evidence.js";

const port = z.number().int().min(1).max(65535);
const endpoint = z.strictObject({
  address: z.string().min(1).max(128),
  port,
});

/** Exact complete Evidence only; MCP resolves same-session references first. */
export const socketPacketAssessmentInputSchema = z.strictObject({
  socket_evidence: evidenceSchema,
  capture_evidence: evidenceSchema,
  socket_observation_id: prefixedDigestSchema("raa_socketobs"),
  frame_number: z.string().regex(/^[1-9][0-9]*$/u),
});

/**
 * A tuple comparison is NOT packet-to-process attribution. Even identical
 * reported tuples can be reused, NAT-rewritten, sampled outside the emission
 * interval, or observed from a different capture vantage.
 */
export const socketPacketAssessmentSchema = z.strictObject({
  schema: z.literal("RAASocketPacketAssessment"),
  version: z.literal(1),
  socket_evidence_id: prefixedDigestSchema("ev"),
  capture_evidence_id: prefixedDigestSchema("ev"),
  capture_artifact_sha256: digestSchema,
  socket_observation_id: prefixedDigestSchema("raa_socketobs"),
  frame_number: z.string().regex(/^[1-9][0-9]*$/u),
  process: z.strictObject({
    pid: z.number().int().positive(),
    process_instance_id: prefixedDigestSchema("raa_process"),
    identity_precision: z.literal("ps-lstart-second-granularity"),
    boot_seconds: z.number().int().positive(),
    boot_microseconds: z.number().int().min(0).max(999999),
    start_label: z.string().min(1).max(128),
  }),
  socket: z.strictObject({
    file_descriptor: z.string().min(1),
    socket_protocol: z.enum(["TCP", "UDP"]),
    original_endpoint: z.string().min(1),
    tcp_state: z.string().nullable(),
    sampling: z.enum([
      "reported-in-both-readouts",
      "first-readout-only",
      "second-readout-only",
    ]),
    parsed_local: endpoint.nullable(),
    parsed_peer: endpoint.nullable(),
  }),
  packet: z.strictObject({
    reported_protocol: z.enum(["TCP", "UDP"]).nullable(),
    source: endpoint.nullable(),
    destination: endpoint.nullable(),
    reported_epoch: z.string().nullable(),
  }),
  comparison: z.strictObject({
    reported_tuple: z.enum([
      "matches-outbound",
      "matches-inbound",
      "different-reported-tuple",
      "not-comparable",
    ]),
    reported_time: z.enum([
      "inside-readout-window",
      "before-readout-window",
      "after-readout-window",
      "not-comparable",
    ]),
    socket_readout_from: z.iso.datetime(),
    socket_readout_until: z.iso.datetime(),
    packet_reported_time: z.iso.datetime().nullable(),
    clock_alignment: z.literal("unverified"),
    capture_vantage: z.literal("unverified"),
    process_socket_lifecycle: z.literal("point-in-time-only"),
  }),
  findings: z.array(
    z.enum([
      "missing-or-ambiguous-packet-fields",
      "opaque-or-listening-socket",
      "reported-protocol-or-tuple-difference",
      "packet-reported-outside-readout-window",
      "packet-time-unavailable",
      "socket-not-present-in-both-readouts",
      "capture-selection-is-partial",
      "pid-reuse-cannot-be-excluded",
      "socket-reuse-cannot-be-excluded",
      "network-vantage-or-nat-unverified",
      "clock-alignment-unverified",
      "no-independent-packet-to-socket-emission-event",
    ]),
  ),
  attribution: z.strictObject({
    verification: z.literal("not-established"),
    independently_verified: z.literal(false),
    process_packet_relationships: z.array(z.never()),
    explanation: z.string().min(1),
  }),
});

export type SocketPacketAssessment = z.infer<
  typeof socketPacketAssessmentSchema
>;
