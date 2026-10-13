import { expect, it } from "vitest";

import {
  parseMacOSLsofSocketReadout,
  parseMacOSBootTime,
  buildMacOSProcessSocketSnapshot,
} from "./macOSSocketReadout.js";
import { macOSProcessSocketSnapshotSchema } from "./macOSProcessSocketSnapshot.js";

const PID = 412;
const boot = parseMacOSBootTime(
  "{ sec = 1791552720, usec = 300323 } Fri Oct  9 09:32:00 2026",
);
const tcp = "p412\ncnode\nf11u\nPTCP\nn127.0.0.1:51000\nTST=LISTEN\n";
const udp = "f12u\nPUDP\nn127.0.0.1:5353\n";
const lsofFirst = tcp + udp;
const lsofSecond =
  tcp + "f13u\nPTCP\nn127.0.0.1:51001->127.0.0.1:443\nTST=ESTABLISHED\n";

it("parses only exact selected PID sockets and preserves opaque endpoints", () => {
  const sockets = parseMacOSLsofSocketReadout(lsofFirst, PID);
  expect(sockets).toEqual([
    {
      file_descriptor: "11u",
      protocol: "TCP",
      endpoint: "127.0.0.1:51000",
      tcp_state: "LISTEN",
    },
    {
      file_descriptor: "12u",
      protocol: "UDP",
      endpoint: "127.0.0.1:5353",
      tcp_state: null,
    },
  ]);
  expect(parseMacOSLsofSocketReadout("", PID)).toEqual([]);
});

it("retains both readouts and identifies fluctuating file descriptors", () => {
  const first = parseMacOSLsofSocketReadout(lsofFirst, PID);
  const second = parseMacOSLsofSocketReadout(lsofSecond, PID);
  const snapshot = buildMacOSProcessSocketSnapshot({
    pid: PID,
    boot,
    process_start_lstart: "Tue Oct 13 10:00:00 2026",
    observed_from: "2026-10-13T14:01:00.000Z",
    observed_until: "2026-10-13T14:01:01.000Z",
    first,
    second,
  });
  expect(macOSProcessSocketSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  expect(snapshot.coverage).toMatchObject({
    target_scope: "one-explicit-pid",
    first_socket_entries: 2,
    second_socket_entries: 2,
    retained_in_both: 1,
    first_only: 1,
    second_only: 1,
    completeness: "partial-point-in-time",
  });
  expect(snapshot.sockets.map((s) => s.stability).sort()).toEqual([
    "first-readout-only",
    "reported-in-both-readouts",
    "second-readout-only",
  ]);
  expect(snapshot.sockets.map((s) => s.endpoint).sort()).toEqual([
    "127.0.0.1:51000",
    "127.0.0.1:51001->127.0.0.1:443",
    "127.0.0.1:5353",
  ]);
  expect(snapshot.limitations.join(" ")).toMatch(/not.*packet event/u);
  expect(snapshot.process.process_instance_id).toMatch(
    /^raa_process_[a-f0-9]{64}$/u,
  );
});

it("makes observation IDs capture-local even if PID, FD and endpoint are reused", () => {
  const settings = {
    pid: PID,
    boot,
    process_start_lstart: "Tue Oct 13 10:00:00 2026",
    observed_from: "2026-10-13T14:01:00.000Z",
    observed_until: "2026-10-13T14:01:01.000Z",
    first: parseMacOSLsofSocketReadout(tcp, PID),
    second: parseMacOSLsofSocketReadout(tcp, PID),
  };
  const first = buildMacOSProcessSocketSnapshot(settings);
  const replay = buildMacOSProcessSocketSnapshot(settings);
  const later = buildMacOSProcessSocketSnapshot({
    ...settings,
    observed_from: "2026-10-13T14:02:00.000Z",
    observed_until: "2026-10-13T14:02:01.000Z",
  });
  expect(first).toEqual(replay);
  expect(first.process.process_instance_id).toBe(
    later.process.process_instance_id,
  );
  expect(first.sockets[0]?.socket_observation_id).not.toBe(
    later.sockets[0]?.socket_observation_id,
  );
});

it("refuses PID confusion, duplicate sockets and incomplete lsof records", () => {
  for (const raw of [
    lsofFirst.replace("p412", "p413"),
    lsofFirst + "p413\nf9\nPTCP\nn*:4000\n",
    tcp + tcp.replace("p412\ncnode\n", ""),
    tcp + "f11u\nPTCP\nn127.0.0.1:7777\n",
    "p412\nf11\nPTCP\n",
    "p412\nf11\nn127.0.0.1:22\n",
    "p412\nfxyz\nPTCP\nn127.0.0.1:22\n",
    "p412\nf11\nPTCP\nn127.0.0.1:22\nn127.0.0.1:23\n",
    "p412\nf11\nPTCP\nn127.0.0.1:22\n\0",
  ]) {
    expect(
      () => parseMacOSLsofSocketReadout(raw, PID),
      JSON.stringify(raw),
    ).toThrow();
  }
});

it("rejects malformed boot markers and inconsistent coverage", () => {
  expect(boot).toEqual({
    boot_seconds: 1791552720,
    boot_microseconds: 300323,
  });
  for (const text of [
    "Fri Oct 9 09:32:00 2026",
    "{ sec = -1, usec = 0 }",
    "{ sec = 123, usec = 1000000 }",
  ])
    expect(() => parseMacOSBootTime(text)).toThrow();

  const good = buildMacOSProcessSocketSnapshot({
    pid: PID,
    boot,
    process_start_lstart: "Tue Oct 13 10:00:00 2026",
    observed_from: "2026-10-13T14:01:00.000Z",
    observed_until: "2026-10-13T14:01:01.000Z",
    first: [],
    second: [],
  });
  expect(good.sockets).toEqual([]);
  expect(
    macOSProcessSocketSnapshotSchema.safeParse({
      ...good,
      coverage: { ...good.coverage, first_socket_entries: 17 },
    }).success,
  ).toBe(false);
  expect(
    macOSProcessSocketSnapshotSchema.safeParse({
      ...good,
      observed_until: "2026-10-13T14:00:00.000Z",
    }).success,
  ).toBe(false);
});
