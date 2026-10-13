import { z } from "zod";

import { prefixedDigestSchema } from "../digests.js";

const text = z.string().min(1).max(4096);

/** No shell strings, paths, broad process searches, or live-capture options. */
export const macOSSocketObservationInputSchema = z.strictObject({
  pid: z.number().int().min(1).max(2147483647),
});

const processContext = z.strictObject({
  pid: z.number().int().positive(),
  boot_seconds: z.number().int().positive(),
  boot_microseconds: z.number().int().min(0).max(999999),
  process_start_lstart: z.string().min(1).max(128),
  process_instance_id: prefixedDigestSchema("raa_process"),
  start_identity_precision: z.literal("ps-lstart-second-granularity"),
});

export const macOSSocketEntrySchema = z.strictObject({
  socket_observation_id: prefixedDigestSchema("raa_socketobs"),
  file_descriptor: z.string().regex(/^[0-9]{1,7}[a-zA-Z-]?$/u),
  protocol: z.enum(["TCP", "UDP"]),
  endpoint: text,
  tcp_state: z.string().min(1).max(64).nullable(),
  stability: z.enum([
    "reported-in-both-readouts",
    "first-readout-only",
    "second-readout-only",
  ]),
});

/**
 * One passive, targeted dual lsof readout. This is NOT an event stream or
 * packet emission record, and it does not establish continuous ownership.
 */
export const macOSProcessSocketSnapshotSchema = z
  .strictObject({
    schema: z.literal("RAAMacOSProcessSocketSnapshot"),
    version: z.literal(1),
    platform: z.literal("darwin"),
    method: z.literal("targeted-lsof-dual-readout"),
    process: processContext,
    observed_from: z.iso.datetime(),
    observed_until: z.iso.datetime(),
    sockets: z.array(macOSSocketEntrySchema).max(4000),
    coverage: z.strictObject({
      target_scope: z.literal("one-explicit-pid"),
      command_access: z.literal("current-user"),
      first_socket_entries: z.number().int().nonnegative(),
      second_socket_entries: z.number().int().nonnegative(),
      retained_in_both: z.number().int().nonnegative(),
      first_only: z.number().int().nonnegative(),
      second_only: z.number().int().nonnegative(),
      completeness: z.literal("partial-point-in-time"),
    }),
    limitations: z.array(z.string().min(1)),
  })
  .superRefine((snapshot, context) => {
    if (
      Date.parse(snapshot.observed_until) < Date.parse(snapshot.observed_from)
    )
      context.addIssue({
        code: "custom",
        path: ["observed_until"],
        message: "Observation end precedes start",
      });
    const coverage = snapshot.coverage;
    if (
      coverage.retained_in_both !==
        snapshot.sockets.filter(
          (s) => s.stability === "reported-in-both-readouts",
        ).length ||
      coverage.first_only !==
        snapshot.sockets.filter((s) => s.stability === "first-readout-only")
          .length ||
      coverage.second_only !==
        snapshot.sockets.filter((s) => s.stability === "second-readout-only")
          .length ||
      coverage.first_socket_entries !==
        coverage.retained_in_both + coverage.first_only ||
      coverage.second_socket_entries !==
        coverage.retained_in_both + coverage.second_only
    )
      context.addIssue({
        code: "custom",
        path: ["coverage"],
        message: "Socket readout intersection and counts disagree",
      });
  });

export type MacOSProcessSocketSnapshot = z.infer<
  typeof macOSProcessSocketSnapshotSchema
>;
