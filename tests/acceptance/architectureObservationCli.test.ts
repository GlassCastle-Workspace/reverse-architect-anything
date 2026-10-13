import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { projectObservationArchitectureEvidence } from "../../src/application/architecture/ArchitectureObservationSurfaceService.js";
import {
  NATIVE_TRACE_EVIDENCE,
  PACKET_CAPTURE_EVIDENCE,
} from "../../src/domain/architecture/architectureObservationSurface.fixture.js";
import { architectureObservationSurfaceSchema } from "../../src/domain/architecture/architectureObservationSurfaceSchema.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "projects source-scoped native and packet Evidence through public CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("raa-observation-cli-");
    for (const input of [
      { source_kind: "native-trace", evidence: NATIVE_TRACE_EVIDENCE },
      { source_kind: "packet-capture", evidence: PACKET_CAPTURE_EVIDENCE },
    ] as const) {
      const path = join(root, `${input.source_kind}.json`);
      await writeFile(path, JSON.stringify(input));
      const response = await cli.run({
        arguments: [
          "project-observation-architecture",
          path,
          "--format",
          "json",
        ],
      });
      expect(response.exitCode, response.stderr).toBe(0);
      const output = parseEvidence(response.json);
      const direct = projectObservationArchitectureEvidence(input);
      if (!direct.ok) throw new Error("Fixture could not be projected");
      expect(output.evidence_id).toBe(direct.value.evidence_id);
      expect(output.evidence_links).toEqual([input.evidence.evidence_id]);
      const surface = architectureObservationSurfaceSchema.parse(
        output.normalized_result,
      );
      expect(surface.source_kind).toBe(input.source_kind);
      if (surface.source_kind === "packet-capture") {
        expect(surface.relationships).toEqual([]);
        expect(surface.components).toHaveLength(2);
      } else {
        expect(surface.summary.unresolved).toBe(1);
        expect(surface.summary.relationships).toBe(2);
      }
    }
  },
);

cliTest(
  "rejects source-family impersonation without fabricating a model",
  async ({ cli }) => {
    const path = join(
      await createTestTempDirectory("raa-observation-reject-"),
      "impostor.json",
    );
    await writeFile(
      path,
      JSON.stringify({
        source_kind: "native-trace",
        evidence: PACKET_CAPTURE_EVIDENCE,
      }),
    );
    const response = await cli.run({
      arguments: ["project-observation-architecture", path, "--format", "json"],
    });
    expect(response.exitCode).not.toBe(0);
    expect(response.json).toMatchObject({
      category: "invalid_input",
      error: "Application workflow failed",
    });
  },
);
