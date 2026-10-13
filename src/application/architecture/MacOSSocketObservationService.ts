import { execFile } from "node:child_process";

import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
} from "../../domain/analysisErrorCore.js";
import {
  macOSSocketObservationInputSchema,
  macOSProcessSocketSnapshotSchema,
} from "../../domain/architecture/macOSProcessSocketSnapshot.js";
import {
  buildMacOSProcessSocketSnapshot,
  parseMacOSBootTime,
  parseMacOSLsofSocketReadout,
} from "../../domain/architecture/macOSSocketReadout.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { err, ok, type Result } from "../../domain/result.js";
import { RAA_MACOS_SOCKET_PROVIDER } from "../InvestigationProviders.js";

const OPERATION = "observe_macos_process_sockets" as const;
const MAX_STDOUT_BYTES = 256 * 1024;
const MAX_COMMAND_DURATION_MS = 4_000;

export interface MacOSSocketCommandResult {
  readonly exit_code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Injected for exact-pid negative controls; no caller-selected executable. */
export type MacOSSocketCommandRunner = (
  command: "/usr/sbin/lsof" | "/bin/ps" | "/usr/sbin/sysctl",
  arguments_: readonly string[],
  signal?: AbortSignal,
) => Promise<MacOSSocketCommandResult>;

export const runPinnedMacOSSocketCommand: MacOSSocketCommandRunner = (
  command,
  arguments_,
  signal,
) =>
  new Promise((resolve) => {
    execFile(
      command,
      [...arguments_],
      {
        timeout: MAX_COMMAND_DURATION_MS,
        maxBuffer: MAX_STDOUT_BYTES,
        encoding: "utf8",
        windowsHide: true,
        env: {
          PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
          LC_ALL: "C",
          LANG: "C",
        },
        ...(signal === undefined ? {} : { signal }),
      },
      (error, stdout, stderr) => {
        resolve({
          exit_code:
            error === null
              ? 0
              : typeof error.code === "number"
                ? error.code
                : null,
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: typeof stderr === "string" ? stderr : "",
        });
      },
    );
  });

const incomplete = (description: string): Result<never, AnalysisError> =>
  err(new AnalysisOutputError(OPERATION, description));

const outOfBounds = (): Result<never, AnalysisError> =>
  err(
    new AnalysisResourceConstraintError(
      OPERATION,
      "capacity",
      "Selected process has more than the supported 2000 readout sockets or command output exceeds the 256 KiB budget",
      {
        max_sockets_per_readout: 2000,
        max_command_output_bytes: MAX_STDOUT_BYTES,
      },
    ),
  );

/**
 * Collect OS-reported descriptors for exactly one PID; never attach to the
 * process, inspect its memory, run its code, or capture packets.
 */
export const observeMacOSProcessSockets = async (
  raw: unknown,
  options: {
    readonly platform?: NodeJS.Platform;
    readonly runner?: MacOSSocketCommandRunner;
    readonly signal?: AbortSignal;
    readonly now?: () => string;
  } = {},
): Promise<Result<Evidence, AnalysisError>> => {
  const parsed = macOSSocketObservationInputSchema.safeParse(raw);
  if (!parsed.success)
    return err(
      analysisInputErrorFromIssues(OPERATION, parsed.error.issues, raw),
    );
  if ((options.platform ?? process.platform) !== "darwin")
    return err(
      new AnalysisInputError(OPERATION, undefined, [
        {
          path: ["pid"],
          reason: "invalid_value",
          message: "This passive collector is supported on macOS only.",
        },
      ]),
    );
  const signal = options.signal;
  if (signal?.aborted) return err(new AnalysisCancelledError(OPERATION));

  const run = options.runner ?? runPinnedMacOSSocketCommand;
  const now = options.now ?? (() => new Date().toISOString());
  const pid = parsed.data.pid;
  const pidText = String(pid);

  // All arguments are fixed except the bounded numeric PID.
  const sysctlArgs = ["-n", "kern.boottime"] as const;
  const psArgs = ["-p", pidText, "-o", "lstart="] as const;
  const lsofArgs = ["-nP", "-a", "-p", pidText, "-i", "-FpcfnPT"] as const;

  try {
    const bootBefore = await run("/usr/sbin/sysctl", sysctlArgs, signal);
    const startBefore = await run("/bin/ps", psArgs, signal);
    if (
      bootBefore.exit_code !== 0 ||
      startBefore.exit_code !== 0 ||
      startBefore.stdout.trim() === ""
    )
      return incomplete(
        "Boot identity or selected PID start time could not be read",
      );

    const observedFrom = now();
    const first = await run("/usr/sbin/lsof", lsofArgs, signal);
    const second = await run("/usr/sbin/lsof", lsofArgs, signal);
    const observedUntil = now();
    const startAfter = await run("/bin/ps", psArgs, signal);
    const bootAfter = await run("/usr/sbin/sysctl", sysctlArgs, signal);

    if (signal?.aborted) return err(new AnalysisCancelledError(OPERATION));
    if (
      startAfter.exit_code !== 0 ||
      bootAfter.exit_code !== 0 ||
      startAfter.stdout.trim() !== startBefore.stdout.trim() ||
      bootAfter.stdout.trim() !== bootBefore.stdout.trim()
    )
      return incomplete(
        "PID process-start label or host boot context changed across the readouts",
      );

    // lsof exit 1 with completely empty output is a legitimate no-match
    // outcome. Any diagnostics, partial output or other failure is NOT proof
    // that the target had no sockets.
    for (const sample of [first, second]) {
      const noMatch =
        sample.exit_code === 1 &&
        sample.stdout.trim() === "" &&
        sample.stderr.trim() === "";
      if (!noMatch && (sample.exit_code !== 0 || sample.stderr.trim() !== ""))
        return incomplete(
          "Selected-PID lsof inspection failed or yielded incomplete diagnostics",
        );
    }
    if (
      first.stdout.length > MAX_STDOUT_BYTES ||
      second.stdout.length > MAX_STDOUT_BYTES
    )
      return outOfBounds();

    const boot = parseMacOSBootTime(bootBefore.stdout);
    const firstSockets = parseMacOSLsofSocketReadout(first.stdout, pid);
    const secondSockets = parseMacOSLsofSocketReadout(second.stdout, pid);

    const snapshot = macOSProcessSocketSnapshotSchema.parse(
      buildMacOSProcessSocketSnapshot({
        pid,
        boot,
        process_start_lstart: startBefore.stdout.trim(),
        observed_from: observedFrom,
        observed_until: observedUntil,
        first: firstSockets,
        second: secondSockets,
      }),
    );

    return ok(
      createEvidence(undefined, RAA_MACOS_SOCKET_PROVIDER, {
        predicateType: "raa.macos-process-socket-readout",
        operation: OPERATION,
        parameters: { pid },
        result: snapshot,
        confidence: "observed",
        authority: "external-service",
        subjectUnavailableReason:
          "The selected live process is not an immutable artifact subject.",
        environment: {
          id: "macos-lsof-ps-sysctl",
          platform: "darwin",
          architecture: process.arch,
          isolation: "none",
        },
        rawResult: null,
        limitations: snapshot.limitations,
      }),
    );
  } catch (cause: unknown) {
    if (signal?.aborted) return err(new AnalysisCancelledError(OPERATION));
    if (cause instanceof TypeError && /exceeds|budget/u.test(cause.message))
      return outOfBounds();
    return incomplete(
      "The OS readouts could not be safely parsed or their identities disagreed",
    );
  }
};
