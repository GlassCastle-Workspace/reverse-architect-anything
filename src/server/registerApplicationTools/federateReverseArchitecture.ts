import type { EvidenceMcpServer } from "../EvidenceMcpServer.js";
import { runAdmittedToolOperation } from "../admittedToolOperation.js";
import { resolveEvidenceInputs } from "../../application/EvidenceInputResolver.js";
import { federateReverseArchitectureEvidenceValidated } from "../../application/architecture/ArchitectureFederationService.js";
import { applicationToolContract } from "../../contracts/applicationToolContracts.js";
import { recordSessionEvidenceSources } from "../sessionEvidence.js";
import { logToolExecution } from "../toolLogging.js";
import { toolRegistrationOptions } from "../toolRegistrationOptions.js";
import { recordResult } from "./helpers.js";
import type { ApplicationToolRegistration } from "./types.js";

const contract = applicationToolContract("federate_reverse_architecture");

/** Register a bounded, source-preserving multi-Evidence federation. */
export const registerFederateReverseArchitectureTool = (
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
            input.projections,
            options.evidenceById,
          );
          if (!resolved.ok)
            return server.delivery.toCallToolResult(resolved, contract);
          const result = await logToolExecution(
            options.logger,
            contract.name,
            () =>
              Promise.resolve(
                federateReverseArchitectureEvidenceValidated({
                  projections: resolved.value,
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
