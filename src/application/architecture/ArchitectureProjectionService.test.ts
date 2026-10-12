import { describe, expect, it } from "vitest";

import { JAVASCRIPT_FEATURE_TRACE_EXAMPLE } from "../../contracts/javascript/javascriptApplicationWorkflowExamples.js";
import { parseEvidence } from "../../domain/evidence.js";
import {
  projectReverseArchitectureEvidence,
  projectReverseArchitectureEvidenceValidated,
} from "./ArchitectureProjectionService.js";

const application = JAVASCRIPT_FEATURE_TRACE_EXAMPLE.application;

describe("RAA architecture Evidence service", () => {
  it("rejects invalid raw inputs without creating an architectural claim", () => {
    for (const input of [
      null,
      {},
      { application: {} },
      { application, unauthorized: true },
    ]) {
      const result = projectReverseArchitectureEvidence(input);
      expect(result.ok).toBe(false);
    }
  });

  it("produces deterministic derived Evidence anchored to its authenticated source", () => {
    const first = projectReverseArchitectureEvidence({ application });
    const second = projectReverseArchitectureEvidenceValidated({ application });
    if (!first.ok || !second.ok)
      throw new Error("Valid application fixture was rejected");

    expect(first.value.evidence_id).toBe(second.value.evidence_id);
    expect(parseEvidence(first.value)).toEqual(first.value);
    expect(first.value).toMatchObject({
      authority: "analyst-inference",
      confidence: "inferred",
      evidence_links: [application.evidence_id],
      predicate_type: "raa.reverse-architecture-projection",
      operation: "project_reverse_architecture",
      normalized_result: {
        source_evidence_id: application.evidence_id,
        schema: "ReverseArchitectureProjection",
      },
    });
  });

  it("refuses source records whose semantic Evidence identity has been altered", () => {
    const tampered = {
      ...application,
      operation: "inventory_artifact",
    };
    const result = projectReverseArchitectureEvidence({
      application: tampered,
    });
    expect(result.ok).toBe(false);
  });
});
