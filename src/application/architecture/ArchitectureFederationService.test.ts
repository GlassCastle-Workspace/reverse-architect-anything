import { describe, expect, it } from "vitest";

import { JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE } from "../../contracts/javascript/javascriptApplicationWorkflowExamples.js";
import { parseEvidence } from "../../domain/evidence.js";
import { architectureFederationSchema } from "../../domain/architecture/architectureFederationSchema.js";
import { projectReverseArchitectureEvidence } from "./ArchitectureProjectionService.js";
import {
  federateReverseArchitectureEvidence,
  federateReverseArchitectureEvidenceValidated,
} from "./ArchitectureFederationService.js";

const pair = JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE;
const staticResult = projectReverseArchitectureEvidence({
  application: pair.left,
});
const runtimeResult = projectReverseArchitectureEvidence({
  application: pair.right,
});
if (!staticResult.ok || !runtimeResult.ok)
  throw new Error("Static/runtime example architecture projection failed");
const projections = [staticResult.value, runtimeResult.value];

describe("RAA architectural federation Evidence", () => {
  it("federates validated static and runtime-reconciled projections with source identities", () => {
    const left = federateReverseArchitectureEvidence({ projections });
    const reversed = federateReverseArchitectureEvidenceValidated({
      projections: [...projections].reverse(),
    });
    if (!left.ok || !reversed.ok)
      throw new Error("Valid federation input was rejected");

    expect(left.value.evidence_id).toBe(reversed.value.evidence_id);
    expect(parseEvidence(left.value)).toEqual(left.value);
    expect(left.value).toMatchObject({
      operation: "federate_reverse_architecture",
      predicate_type: "raa.reverse-architecture-federation",
      provider: { id: "raa-architecture-federation" },
      authority: "analyst-inference",
      confidence: "inferred",
    });
    expect(left.value.evidence_links).toEqual(
      projections.map((p) => p.evidence_id).sort(),
    );

    const output = architectureFederationSchema.parse(
      left.value.normalized_result,
    );
    expect(output.summary.source_projections).toBe(2);
    expect(output.sources.map((s) => s.source_kind).sort()).toEqual([
      "static-application",
      "static-runtime-reconciliation",
    ]);
    expect(output.summary.components).toBe(output.components.length);
    expect(output.summary.relationships).toBe(output.relationships.length);
    for (const candidate of output.boundary_candidates)
      expect(candidate.candidate.epistemic_status).toBe("hypothesis");
  });

  it("rejects duplicates, untrusted producer metadata and tampered Evidence", () => {
    expect(federateReverseArchitectureEvidence({ projections: [] }).ok).toBe(
      false,
    );
    expect(
      federateReverseArchitectureEvidence({
        projections: [projections[0], projections[0]],
      }).ok,
    ).toBe(false);

    const tampered = { ...projections[1], evidence_links: [] };
    expect(
      federateReverseArchitectureEvidence({
        projections: [projections[0], tampered],
      }).ok,
    ).toBe(false);
    const wrongProducer = {
      ...projections[1],
      provider: { ...projections[1]?.provider, id: "not-raa" },
    };
    expect(
      federateReverseArchitectureEvidence({
        projections: [projections[0], wrongProducer],
      }).ok,
    ).toBe(false);
  });

  it("refuses a cryptographically valid but semantically incorrect producer", () => {
    const bad = projections.map((source) => ({
      ...source,
      normalized_result: null,
    }));
    expect(federateReverseArchitectureEvidence({ projections: bad }).ok).toBe(
      false,
    );
  });
});
