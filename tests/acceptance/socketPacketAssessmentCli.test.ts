import { writeFile } from "node:fs/promises";
import { createServer as createTcpServer } from "node:net";
import { once } from "node:events";
import { join } from "node:path";

import { expect } from "vitest";

import { cliTest } from "../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { parseEvidence, createEvidence } from "../../src/domain/evidence.js";
import { packetCaptureSchema } from "../../src/domain/captures/packetCapture.js";
import { socketPacketAssessmentSchema } from "../../src/domain/architecture/socketPacketAssessmentSchema.js";
import {
  SOCKET_PACKET_TEST_REQUEST as request,
  SOCKET_PACKET_TEST_REPORT as report,
} from "../../src/domain/architecture/socketPacketAssessment.fixture.js";
import { assessSocketPacketCorrespondence } from "../../src/application/architecture/SocketPacketAssessmentService.js";
import { macOSProcessSocketSnapshotSchema } from "../../src/domain/architecture/macOSProcessSocketSnapshot.js";

cliTest(
  "assesses exact reported tuple compatibility through compiled CLI without claiming attribution",
  async ({ cli }) => {
    const root = await createTestTempDirectory("raa-socket-packet-");
    const input = join(root, "request.json");
    await writeFile(input, JSON.stringify(request));
    const run = await cli.run({
      arguments: [
        "assess-socket-packet-correspondence",
        input,
        "--format",
        "json",
      ],
    });
    expect(run.exitCode, run.stderr).toBe(0);
    const evidence = parseEvidence(run.json);
    const expected = assessSocketPacketCorrespondence(request);
    if (!expected.ok) throw new Error("Valid fixture was rejected");
    expect(evidence.evidence_id).toBe(expected.value.evidence_id);
    const result = socketPacketAssessmentSchema.parse(
      evidence.normalized_result,
    );
    expect(result.comparison).toMatchObject({
      reported_tuple: "matches-outbound",
      reported_time: "inside-readout-window",
      capture_vantage: "unverified",
    });
    expect(result.attribution.independently_verified).toBe(false);
    expect(result.attribution.process_packet_relationships).toEqual([]);
  },
);

cliTest(
  "rejects tampered or unresolvable source frames without executing a target",
  async ({ cli }) => {
    const root = await createTestTempDirectory("raa-socket-packet-reject-");
    for (const [name, contents] of [
      ["missing", { ...request, frame_number: "999999" }],
      [
        "tampered",
        {
          ...request,
          capture_evidence: {
            ...request.capture_evidence,
            operation: "not-actually-a-capture",
          },
        },
      ],
      [
        "malformed",
        {
          ...request,
          socket_observation_id: "fd3",
        },
      ],
    ] as const) {
      const input = join(root, `${name}.json`);
      await writeFile(input, JSON.stringify(contents));
      const run = await cli.run({
        arguments: [
          "assess-socket-packet-correspondence",
          input,
          "--format",
          "json",
        ],
      });
      expect(run.exitCode).not.toBe(0);
      expect(run.json).toMatchObject({
        error: "Application workflow failed",
        category: "invalid_input",
      });
    }
  },
);

cliTest.skipIf(process.platform !== "darwin")(
  "combines an actual macOS loopback listener with a synthetic packet without falsely attributing emission",
  async ({ cli }) => {
    const listener = createTcpServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    try {
      const address = listener.address();
      if (!address || typeof address === "string")
        throw new Error("Loopback listener not available");
      const root = await createTestTempDirectory(
        "raa-real-socket-synthetic-packet-",
      );
      const pidPath = join(root, "pid.json");
      await writeFile(pidPath, JSON.stringify({ pid: process.pid }));
      const observed = await cli.run({
        arguments: [
          "observe-macos-process-sockets",
          pidPath,
          "--format",
          "json",
        ],
        timeoutMs: 20_000,
      });
      expect(observed.exitCode, observed.stderr).toBe(0);
      const socketEvidence = parseEvidence(observed.json);
      const snapshot = macOSProcessSocketSnapshotSchema.parse(
        socketEvidence.normalized_result,
      );
      const reportedSocket = snapshot.sockets.find(
        (socket) =>
          socket.protocol === "TCP" &&
          socket.endpoint.includes(`127.0.0.1:${address.port}`) &&
          socket.tcp_state === "LISTEN",
      );
      if (!reportedSocket)
        throw new Error("Live loopback listening descriptor not reported");
      const frame = report.packets[0];
      if (!frame) throw new Error("Synthetic capture has no frame");
      const synthetic = packetCaptureSchema.parse({
        ...report,
        packets: [
          {
            ...frame,
            "tcp.srcport": [String(address.port)],
            "tcp.dstport": ["443"],
          },
        ],
        output_window: {
          matching_packets: 1,
          returned_packets: 1,
          has_more: false,
        },
      });
      const captureEvidence = createEvidence(
        {
          path: synthetic.artifact.path,
          sha256: synthetic.artifact.sha256,
          format: "file",
        },
        request.capture_evidence.provider,
        {
          operation: "inspect_packet_capture",
          parameters: synthetic.selection,
          result: synthetic,
          confidence: "observed",
          authority: "shipped-artifact",
          limitations: [
            "Synthetic capture report, not a packet observed on the macOS host",
          ],
        },
      );
      const inputPath = join(root, "candidate.json");
      await writeFile(
        inputPath,
        JSON.stringify({
          socket_evidence: socketEvidence,
          capture_evidence: captureEvidence,
          socket_observation_id: reportedSocket.socket_observation_id,
          frame_number: "7",
        }),
      );
      const compared = await cli.run({
        arguments: [
          "assess-socket-packet-correspondence",
          inputPath,
          "--format",
          "json",
        ],
      });
      expect(compared.exitCode, compared.stderr).toBe(0);
      const result = socketPacketAssessmentSchema.parse(
        parseEvidence(compared.json).normalized_result,
      );
      expect(result.process.pid).toBe(process.pid);
      expect(result.comparison.reported_tuple).toBe("not-comparable");
      expect(result.findings).toContain("opaque-or-listening-socket");
      expect(result.attribution.independently_verified).toBe(false);
    } finally {
      listener.close();
      await once(listener, "close");
    }
  },
);
