import { expect, it } from "vitest";

import { parseEvidence } from "../../domain/evidence.js";
import { macOSProcessSocketSnapshotSchema } from "../../domain/architecture/macOSProcessSocketSnapshot.js";
import {
  observeMacOSProcessSockets,
  type MacOSSocketCommandRunner,
  type MacOSSocketCommandResult,
} from "./MacOSSocketObservationService.js";

const pid = 4321;
const psStart = "Tue Oct 13 10:35:00 2026\n";
const boot = "{ sec = 1791552720, usec = 300323 } Fri Oct  9 09:32:00 2026\n";
const lsof = "p4321\ncnode\nf9u\nPTCP\nn127.0.0.1:6060\nTST=LISTEN\n";

const ok = (stdout: string): MacOSSocketCommandResult => ({
  stdout,
  stderr: "",
  exit_code: 0,
});
const samples = (first = lsof, second = lsof): MacOSSocketCommandResult[] => [
  ok(boot),
  ok(psStart),
  ok(first),
  ok(second),
  ok(psStart),
  ok(boot),
];

const collect = (
  overrides: {
    readonly outputs?: MacOSSocketCommandResult[];
    readonly platform?: NodeJS.Platform;
    readonly pid?: unknown;
  } = {},
) => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const results = [...(overrides.outputs ?? samples())];
  const runner: MacOSSocketCommandRunner = async (command, args) => {
    calls.push({ command, args: [...args] });
    const next = results.shift();
    if (next === undefined) throw new Error("Unexpected invocation");
    return next;
  };
  let clock = 0;
  const run = observeMacOSProcessSockets(
    { pid: overrides.pid ?? pid },
    {
      platform: overrides.platform ?? "darwin",
      runner,
      now: () =>
        clock++ === 0 ? "2026-10-13T14:35:00.000Z" : "2026-10-13T14:35:00.021Z",
    },
  );
  return { run, calls };
};

it("observes only caller-selected numeric PID with pinned macOS helpers", async () => {
  const { run, calls } = collect();
  const outcome = await run;
  if (!outcome.ok) throw new Error("Safe fixture was rejected");
  const evidence = parseEvidence(outcome.value);
  expect(evidence).toMatchObject({
    operation: "observe_macos_process_sockets",
    predicate_type: "raa.macos-process-socket-readout",
    authority: "external-service",
    confidence: "observed",
    parameters: { pid },
  });
  const snapshot = macOSProcessSocketSnapshotSchema.parse(
    evidence.normalized_result,
  );
  expect(snapshot.process.pid).toBe(pid);
  expect(snapshot.process.start_identity_precision).toBe(
    "ps-lstart-second-granularity",
  );
  expect(snapshot.sockets).toHaveLength(1);
  expect(snapshot.sockets[0]).toMatchObject({
    endpoint: "127.0.0.1:6060",
    file_descriptor: "9u",
    protocol: "TCP",
    tcp_state: "LISTEN",
    stability: "reported-in-both-readouts",
  });
  expect(snapshot.coverage).toMatchObject({
    target_scope: "one-explicit-pid",
    retained_in_both: 1,
    first_only: 0,
    second_only: 0,
    completeness: "partial-point-in-time",
  });
  expect(calls.map((c) => c.command)).toEqual([
    "/usr/sbin/sysctl",
    "/bin/ps",
    "/usr/sbin/lsof",
    "/usr/sbin/lsof",
    "/bin/ps",
    "/usr/sbin/sysctl",
  ]);
  expect(calls[2]?.args).toEqual(["-nP", "-a", "-p", "4321", "-i", "-FpcfnPT"]);
});

it("preserves readout changes and zero matches as incomplete, not an absence proof", async () => {
  const changing = await collect({
    outputs: samples(lsof, "p4321\nf10u\nPUDP\nn127.0.0.1:5353\n"),
  }).run;
  if (!changing.ok) throw new Error("Changing target rejected");
  const change = macOSProcessSocketSnapshotSchema.parse(
    changing.value.normalized_result,
  );
  expect(change.coverage).toMatchObject({
    retained_in_both: 0,
    first_only: 1,
    second_only: 1,
  });
  expect(change.sockets).toHaveLength(2);
  const none = await collect({
    outputs: samples("", ""),
  }).run;
  if (!none.ok) throw new Error("Empty no-match readout rejected");
  expect(none.value.normalized_result).toMatchObject({
    sockets: [],
    coverage: { completeness: "partial-point-in-time" },
  });
});

it("refuses process start changes and boot context changes", async () => {
  const changedStart = samples();
  changedStart[4] = ok("Tue Oct 13 10:35:01 2026\n");
  expect((await collect({ outputs: changedStart }).run).ok).toBe(false);
  const rebooted = samples();
  rebooted[5] = ok("{ sec = 1791552721, usec = 300323 }\n");
  expect((await collect({ outputs: rebooted }).run).ok).toBe(false);
});

it("refuses cross-PID lsof data and diagnostic failures instead of fabricating ownership", async () => {
  expect(
    (
      await collect({
        outputs: samples(lsof.replace("p4321", "p4322"), lsof),
      }).run
    ).ok,
  ).toBe(false);
  const denied = samples();
  denied[2] = { exit_code: 1, stdout: "", stderr: "Operation not permitted" };
  expect((await collect({ outputs: denied }).run).ok).toBe(false);
  const missing = samples();
  missing[2] = { exit_code: 1, stdout: "", stderr: "" };
  missing[3] = { exit_code: 1, stdout: "", stderr: "" };
  const noMatch = await collect({ outputs: missing }).run;
  expect(noMatch.ok).toBe(true);
  const truncated = samples();
  truncated[2] = { exit_code: null, stdout: "", stderr: "maxBuffer exceeded" };
  expect((await collect({ outputs: truncated }).run).ok).toBe(false);
});

it("rejects unsupported host, unsafe PID and cancellation before any external process", async () => {
  expect((await collect({ platform: "linux" }).run).ok).toBe(false);
  for (const value of [0, -1, 3.14159, "4321; rm -rf", 99999999999999]) {
    const { run, calls } = collect({ pid: value });
    expect((await run).ok).toBe(false);
    expect(calls).toEqual([]);
  }
  const controller = new AbortController();
  controller.abort();
  const calls: string[] = [];
  const outcome = await observeMacOSProcessSockets(
    { pid },
    {
      platform: "darwin",
      signal: controller.signal,
      runner: async (name) => {
        calls.push(name);
        throw new Error("Do not start");
      },
    },
  );
  expect(outcome.ok).toBe(false);
  expect(calls).toHaveLength(0);
});
