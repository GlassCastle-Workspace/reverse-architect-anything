import type { EvidenceMcpServer } from "../EvidenceMcpServer.js";
import { runAdmittedToolOperation } from "../admittedToolOperation.js";
import {
  resolveEvidenceInput,
  resolveEvidenceInputs,
} from "../../application/EvidenceInputResolver.js";
import { reviewReverseArchitectureCorrespondenceEvidenceValidated } from "../../application/architecture/ArchitectureCorrespondenceReviewService.js";
import { applicationToolContract } from "../../contracts/applicationToolContracts.js";
import { recordSessionEvidenceSources } from "../sessionEvidence.js";
import { logToolExecution } from "../toolLogging.js";
import { toolRegistrationOptions } from "../toolRegistrationOptions.js";
import { recordResult } from "./helpers.js";
import type { ApplicationToolRegistration } from "./types.js";

const contract = applicationToolContract("review_architecture_correspondences");

/**
 * Review reports without loading or executing any provider. Source Evidence
 * references are exact and bound to the current session's investigation.
 */
export const registerReviewArchitectureCorrespondencesTool = (
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
          const atlas = resolveEvidenceInput(input.atlas, options.evidenceById);
          if (!atlas.ok)
            return server.delivery.toCallToolResult(atlas, contract);
          const reports = resolveEvidenceInputs(
            input.reports,
            options.evidenceById,
          );
          if (!reports.ok)
            return server.delivery.toCallToolResult(reports, contract);
          const result = await logToolExecution(
            options.logger,
            contract.name,
            () =>
              Promise.resolve(
                reviewReverseArchitectureCorrespondenceEvidenceValidated({
                  atlas: atlas.value,
                  reports: reports.value,
                }),
              ),
          );
          if (!result.ok)
            return server.delivery.toCallToolResult(result, contract);
          const sources = [atlas.value, ...reports.value];
          const recorded = recordSessionEvidenceSources(
            options.recordEvidence,
            sources,
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
