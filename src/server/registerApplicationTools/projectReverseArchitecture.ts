import type { EvidenceMcpServer } from "../EvidenceMcpServer.js";
import { runAdmittedToolOperation } from "../admittedToolOperation.js";
import { resolveApplicationEvidenceRequest } from "../../application/EvidenceInputResolver.js";
import { projectReverseArchitectureEvidenceValidated } from "../../application/architecture/ArchitectureProjectionService.js";
import { applicationToolContract } from "../../contracts/applicationToolContracts.js";
import { recordSessionEvidenceSources } from "../sessionEvidence.js";
import { logToolExecution } from "../toolLogging.js";
import { toolRegistrationOptions } from "../toolRegistrationOptions.js";
import { recordResult } from "./helpers.js";
import type { ApplicationToolRegistration } from "./types.js";

const contract = applicationToolContract("project_reverse_architecture");

/**
 * Register an evidence-only architectural projection.
 *
 * References are resolved against this session before application-level
 * authentication. No provider is opened, launched or attached.
 */
export const registerProjectReverseArchitectureTool = (
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
          const resolved = resolveApplicationEvidenceRequest(
            input,
            options.evidenceById,
          );
          if (!resolved.ok)
            return server.delivery.toCallToolResult(resolved, contract);
          const result = await logToolExecution(
            options.logger,
            contract.name,
            () =>
              Promise.resolve(
                projectReverseArchitectureEvidenceValidated(resolved.value),
              ),
          );
          if (!result.ok)
            return server.delivery.toCallToolResult(result, contract);
          const recorded = recordSessionEvidenceSources(
            options.recordEvidence,
            [resolved.value.application],
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
