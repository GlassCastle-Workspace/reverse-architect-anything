import type { EvidenceMcpServer } from "../EvidenceMcpServer.js";
import { runAdmittedToolOperation } from "../admittedToolOperation.js";
import { resolveEvidenceInput } from "../../application/EvidenceInputResolver.js";
import { assessSocketPacketCorrespondenceValidated } from "../../application/architecture/SocketPacketAssessmentService.js";
import { applicationToolContract } from "../../contracts/applicationToolContracts.js";
import { recordSessionEvidenceSources } from "../sessionEvidence.js";
import { logToolExecution } from "../toolLogging.js";
import { toolRegistrationOptions } from "../toolRegistrationOptions.js";
import { recordResult } from "./helpers.js";
import type { ApplicationToolRegistration } from "./types.js";

const contract = applicationToolContract("assess_socket_packet_correspondence");

/** Offline Evidence-only comparison, never live socket inspection or packet capture. */
export const registerAssessSocketPacketCorrespondenceTool = (
  server: EvidenceMcpServer,
  options: ApplicationToolRegistration,
): void => {
  server.registerTool(
    contract.name,
    toolRegistrationOptions(contract),
    async (input, context) =>
      runAdmittedToolOperation(
        server,
        options.withAdmittedAnalysis,
        contract.name,
        context.mcpReq.signal,
        async () => {
          const socket = resolveEvidenceInput(
            input.socket_evidence,
            options.evidenceById,
          );
          if (!socket.ok)
            return server.delivery.toCallToolResult(socket, contract);
          const capture = resolveEvidenceInput(
            input.capture_evidence,
            options.evidenceById,
          );
          if (!capture.ok)
            return server.delivery.toCallToolResult(capture, contract);
          const result = await logToolExecution(
            options.logger,
            contract.name,
            () =>
              Promise.resolve(
                assessSocketPacketCorrespondenceValidated({
                  socket_evidence: socket.value,
                  capture_evidence: capture.value,
                  socket_observation_id: input.socket_observation_id,
                  frame_number: input.frame_number,
                }),
              ),
          );
          if (!result.ok)
            return server.delivery.toCallToolResult(result, contract);
          const recorded = recordSessionEvidenceSources(
            options.recordEvidence,
            [socket.value, capture.value],
          );
          if (!recorded.ok)
            return server.delivery.toCallToolResult(recorded, contract);
          return recordResult(
            { ...options, delivery: server.delivery },
            contract,
            result.value,
          );
        },
      ),
  );
};
