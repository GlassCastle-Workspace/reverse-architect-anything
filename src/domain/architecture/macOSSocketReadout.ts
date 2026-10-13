import { digestCanonicalValue } from "../canonicalDigest.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import {
  macOSProcessSocketSnapshotSchema,
  type MacOSProcessSocketSnapshot,
} from "./macOSProcessSocketSnapshot.js";

export interface ReadoutSocket {
  readonly file_descriptor: string;
  readonly protocol: "TCP" | "UDP";
  readonly endpoint: string;
  readonly tcp_state: string | null;
}

const MAX_READOUT_SOCKETS = 2000;

/**
 * Parse only lsof -FpcfnPT field lines for a SINGLE selected PID. Reject
 * ambiguity/partial structured records instead of silently attaching a
 * socket from another process. No endpoint-to-flow interpretation occurs.
 */
export const parseMacOSLsofSocketReadout = (
  output: string,
  expectedPid: number,
): ReadoutSocket[] => {
  if (output.includes("\0")) throw new TypeError("NUL in lsof field output");
  const records: ReadoutSocket[] = [];
  let pidSection: number | null = null;
  let current:
    | {
        fd: string;
        protocol: "TCP" | "UDP" | null;
        endpoint: string | null;
        tcpState: string | null;
      }
    | undefined;
  const flush = (): void => {
    if (current === undefined) return;
    if (current.protocol === null || current.endpoint === null)
      throw new TypeError("lsof returned incomplete socket fields");
    records.push({
      file_descriptor: current.fd,
      protocol: current.protocol,
      endpoint: current.endpoint,
      tcp_state: current.tcpState,
    });
    if (records.length > MAX_READOUT_SOCKETS)
      throw new TypeError("Selected process exceeds socket readout budget");
    current = undefined;
  };

  for (const line of output.split("\n")) {
    if (line === "") continue;
    const kind = line[0];
    const field = line.slice(1);
    if (kind === "p") {
      flush();
      if (
        !/^[1-9][0-9]*$/u.test(field) ||
        Number(field) !== expectedPid ||
        pidSection !== null
      )
        throw new TypeError(
          "lsof reported an unexpected process or duplicate process section",
        );
      pidSection = expectedPid;
    } else if (kind === "f") {
      flush();
      if (pidSection !== expectedPid || !/^[0-9]{1,7}[a-zA-Z-]?$/u.test(field))
        throw new TypeError("Malformed or unscoped lsof file descriptor");
      current = {
        fd: field,
        protocol: null,
        endpoint: null,
        tcpState: null,
      };
    } else if (kind === "P" && current !== undefined) {
      if (field !== "TCP" && field !== "UDP")
        throw new TypeError("Unexpected lsof socket protocol");
      if (current.protocol !== null)
        throw new TypeError("Duplicate lsof protocol");
      current.protocol = field;
    } else if (kind === "n" && current !== undefined) {
      if (field.length < 1 || field.length > 4096 || current.endpoint !== null)
        throw new TypeError("Invalid or duplicate lsof network endpoint");
      current.endpoint = field;
    } else if (
      kind === "T" &&
      current !== undefined &&
      field.startsWith("ST=")
    ) {
      if (field.length <= 3 || field.length > 67 || current.tcpState !== null)
        throw new TypeError("Invalid lsof TCP state");
      current.tcpState = field.slice(3);
    }
  }
  flush();
  const ids = records.map((record) => record.file_descriptor);
  if (new Set(ids).size !== ids.length)
    throw new TypeError(
      "Duplicate lsof file descriptors in one process readout",
    );
  if (output.trim() !== "" && pidSection !== expectedPid)
    throw new TypeError("lsof returned data without the selected PID");
  return records;
};

export const parseMacOSBootTime = (raw: string) => {
  const match = /\bsec\s*=\s*([0-9]+)\s*,\s*usec\s*=\s*([0-9]+)\b/u.exec(raw);
  if (match === null)
    throw new TypeError("macOS system boot time is unavailable");
  const bootSeconds = Number(match[1]);
  const bootMicros = Number(match[2]);
  if (
    !Number.isSafeInteger(bootSeconds) ||
    bootSeconds <= 0 ||
    !Number.isSafeInteger(bootMicros) ||
    bootMicros < 0 ||
    bootMicros > 999999
  )
    throw new TypeError("Invalid macOS boot time");
  return { boot_seconds: bootSeconds, boot_microseconds: bootMicros };
};

const readoutKey = (socket: ReadoutSocket): string =>
  JSON.stringify([
    socket.file_descriptor,
    socket.protocol,
    socket.endpoint,
    socket.tcp_state,
  ]);

const LIMITATIONS = [
  "This is an operating-system lsof report of descriptors for one caller-selected PID, not a packet event, byte-counted flow, socket-to-frame attribution, or proof of network transmission.",
  "Two lsof readouts are point-in-time samples, not continuous monitoring. Entries seen in both could still close and be reopened between reads.",
  "macOS ps lstart has second-level resolution and may collide under rapid PID reuse; PID, boot time, and process start label are not cryptographic process attestation.",
  "User privileges and lsof process visibility may omit sockets; absent descriptors do not establish absence of network activity.",
  "Addresses and TCP state are unverified OS-reported strings; NAT, namespace, interface, sensor vantage and packet timestamps are not established.",
];

/** Produce source-scoped descriptors while explicitly retaining fluctuations. */
export const buildMacOSProcessSocketSnapshot = (input: {
  readonly pid: number;
  readonly boot: ReturnType<typeof parseMacOSBootTime>;
  readonly process_start_lstart: string;
  readonly observed_from: string;
  readonly observed_until: string;
  readonly first: readonly ReadoutSocket[];
  readonly second: readonly ReadoutSocket[];
}): MacOSProcessSocketSnapshot => {
  const start = input.process_start_lstart.trim();
  if (start.length < 1 || start.length > 128)
    throw new TypeError("macOS process start label is unavailable");
  if (
    input.first.length > MAX_READOUT_SOCKETS ||
    input.second.length > MAX_READOUT_SOCKETS
  )
    throw new TypeError("Socket readout exceeds budget");
  const process_instance_id = `raa_process_${digestCanonicalValue(
    [
      "macos-boot-and-process-start",
      input.boot.boot_seconds,
      input.boot.boot_microseconds,
      input.pid,
      start,
    ],
    "RAA OS-reported process instance",
  )}`;
  const previous = new Map(input.first.map((item) => [readoutKey(item), item]));
  const latest = new Map(input.second.map((item) => [readoutKey(item), item]));
  if (
    previous.size !== input.first.length ||
    latest.size !== input.second.length
  )
    throw new TypeError("Duplicate socket identities within one readout");

  const entries: MacOSProcessSocketSnapshot["sockets"] = [];
  let both = 0;
  let firstOnly = 0;
  let secondOnly = 0;
  for (const [key, socket] of previous) {
    const stability = latest.has(key)
      ? ("reported-in-both-readouts" as const)
      : ("first-readout-only" as const);
    if (latest.has(key)) both++;
    else firstOnly++;
    entries.push({
      ...socket,
      stability,
      socket_observation_id: `raa_socketobs_${digestCanonicalValue(
        [process_instance_id, input.observed_from, key],
        "RAA sampled socket observation",
      )}`,
    });
  }
  for (const [key, socket] of latest) {
    if (previous.has(key)) continue;
    secondOnly++;
    entries.push({
      ...socket,
      stability: "second-readout-only",
      socket_observation_id: `raa_socketobs_${digestCanonicalValue(
        [process_instance_id, input.observed_from, key],
        "RAA sampled socket observation",
      )}`,
    });
  }
  entries.sort((a, b) =>
    compareUnicodeCodePoints(a.socket_observation_id, b.socket_observation_id),
  );
  return macOSProcessSocketSnapshotSchema.parse({
    schema: "RAAMacOSProcessSocketSnapshot",
    version: 1,
    platform: "darwin",
    method: "targeted-lsof-dual-readout",
    process: {
      pid: input.pid,
      ...input.boot,
      process_start_lstart: start,
      process_instance_id,
      start_identity_precision: "ps-lstart-second-granularity",
    },
    observed_from: input.observed_from,
    observed_until: input.observed_until,
    sockets: entries,
    coverage: {
      target_scope: "one-explicit-pid",
      command_access: "current-user",
      first_socket_entries: input.first.length,
      second_socket_entries: input.second.length,
      retained_in_both: both,
      first_only: firstOnly,
      second_only: secondOnly,
      completeness: "partial-point-in-time",
    },
    limitations: LIMITATIONS,
  });
};
