import type { EvidenceMcpServer } from "../EvidenceMcpServer.js";
import { runAdmittedToolOperation } from "../admittedToolOperation.js";
import { resolveEvidenceInputs } from "../../application/EvidenceInputResolver.js";
import { buildReverseArchitectureAtlasEvidenceValidated } from "../../application/architecture/ArchitectureAtlasService.js";
import { applicationToolContract } from "../../contracts/applicationToolContracts.js";
import { recordSessionEvidenceSources } from "../sessionEvidence.js";
import { logToolExecution } from "../toolLogging.js";
import { toolRegistrationOptions } from "../toolRegistrationOptions.js";
import { recordResult } from "./helpers.js";
import type { ApplicationToolRegistration } from "./types.js";

const contract = applicationToolContract("build_reverse_architecture_atlas");

/** Bind an execution-free atlas workflow to exact same-session Evidence. */
export const registerBuildReverseArchitectureAtlasTool = (
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
          const resolved = resolveEvidenceInputs(
            input.sources,
            options.evidenceById,
          );
          if (!resolved.ok)
            return server.delivery.toCallToolResult(resolved, contract);
          const result = await logToolExecution(
            options.logger,
            contract.name,
            () =>
              Promise.resolve(
                buildReverseArchitectureAtlasEvidenceValidated({
                  sources: resolved.value,
                }),
              ),
          );
          if (!result.ok)
            return server.delivery.toCallToolResult(result, contract);
          const recorded = recordSessionEvidenceSources(
            options.recordEvidence,
            resolved.value,
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
