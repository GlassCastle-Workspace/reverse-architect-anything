import { writeFile } from "node:fs/promises";
import { createServer as createTcpServer } from "node:net";
import { once } from "node:events";
import { join } from "node:path";
import { expect } from "vitest";

import { cliTest } from "../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { macOSProcessSocketSnapshotSchema } from "../../src/domain/architecture/macOSProcessSocketSnapshot.js";

cliTest.skipIf(process.platform !== "darwin")(
  "reads a real macOS loopback listener from this exact process through CLI",
  async ({ cli }) => {
    const listener = createTcpServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    try {
      const address = listener.address();
      if (!address || typeof address === "string")
        throw new Error("Fixture loopback address missing");
      const root = await createTestTempDirectory("raa-socket-observation-");
      const inputPath = join(root, "input.json");
      await writeFile(inputPath, JSON.stringify({ pid: process.pid }));
      const cliResult = await cli.run({
        arguments: [
          "observe-macos-process-sockets",
          inputPath,
          "--format",
          "json",
        ],
        timeoutMs: 20_000,
      });
      expect(cliResult.exitCode, cliResult.stderr).toBe(0);
      const evidence = parseEvidence(cliResult.json);
      expect(evidence).toMatchObject({
        operation: "observe_macos_process_sockets",
        predicate_type: "raa.macos-process-socket-readout",
        confidence: "observed",
        authority: "external-service",
      });
      const output = macOSProcessSocketSnapshotSchema.parse(
        evidence.normalized_result,
      );
      expect(output.process.pid).toBe(process.pid);
      expect(output.coverage).toMatchObject({
        target_scope: "one-explicit-pid",
        completeness: "partial-point-in-time",
      });
      expect(
        output.sockets.some(
          (socket) =>
            socket.protocol === "TCP" &&
            socket.endpoint.includes(`127.0.0.1:${address.port}`),
        ),
      ).toBe(true);
      expect(output.limitations.join(" ")).toMatch(/PID reuse/u);
    } finally {
      listener.close();
      await once(listener, "close");
    }
  },
);

cliTest(
  "rejects arbitrary shell fragments and invalid numeric PID",
  async ({ cli }) => {
    const root = await createTestTempDirectory("raa-socket-reject-");
    for (const pid of ["123; whoami", -1, 0]) {
      const inputPath = join(root, `invalid-${String(pid).length}.json`);
      await writeFile(inputPath, JSON.stringify({ pid }));
      const result = await cli.run({
        arguments: [
          "observe-macos-process-sockets",
          inputPath,
          "--format",
          "json",
        ],
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.json).toMatchObject({
        error: "Application workflow failed",
        category: "invalid_input",
      });
    }
  },
);
