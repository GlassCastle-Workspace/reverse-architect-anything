import { describe, expect, it } from "vitest";

import { RAA_ARCHITECTURE_PROVIDER } from "../InvestigationProviders.js";
import {
  architectureAtlasEvidenceFixtures as fixtures,
  architectureAtlasEvidenceSources as sources,
} from "./ArchitectureAtlas.fixture.js";
import { buildReverseArchitectureAtlasEvidence } from "./ArchitectureAtlasService.js";
import { architectureAtlasSchema } from "../../domain/architecture/architectureAtlasSchema.js";
import { createEvidence, parseEvidence } from "../../domain/evidence.js";

describe("heterogeneous RAA Atlas Evidence service", () => {
  it("creates authenticatable derived Evidence over three source families", () => {
    const result = buildReverseArchitectureAtlasEvidence({ sources });
    if (!result.ok) throw new Error("Valid source Evidence was rejected");
    const replay = buildReverseArchitectureAtlasEvidence({
      sources: [...sources].reverse(),
    });
    if (!replay.ok) throw new Error("Reordered Evidence sources were rejected");
    expect(replay.value.evidence_id).toBe(result.value.evidence_id);
    expect(parseEvidence(result.value)).toEqual(result.value);
    const atlas = architectureAtlasSchema.parse(result.value.normalized_result);
    expect(atlas.summary).toMatchObject({
      sources: 3,
      application_sources: 1,
      native_sources: 1,
      packet_sources: 1,
      cross_source_relationships: 0,
    });
    expect(result.value).toMatchObject({
      operation: "build_reverse_architecture_atlas",
      predicate_type: "raa.reverse-architecture-atlas",
      authority: "analyst-inference",
      confidence: "inferred",
      evidence_links: [...sources].map((s) => s.evidence_id).sort(),
      parameters: {
        atlas_version: 1,
        source_evidence_ids: [...sources].map((s) => s.evidence_id).sort(),
      },
    });
  });

  it("refuses duplicate sources, unsupported Evidence families, and invalid raw inputs", () => {
    for (const candidate of [
      { sources: [sources[0], sources[0]] },
      { sources: [sources[0]] },
      {
        sources: [
          fixtures.native,
          {
            ...fixtures.native,
            provider: { ...fixtures.native.provider, id: "forged" },
          },
        ],
      },
      {
        sources: [
          sources[0],
          { ...fixtures.packet, evidence_id: `ev_${"0".repeat(64)}` },
        ],
      },
      { sources: [] },
      { sources: [{}, {}] },
    ]) {
      expect(buildReverseArchitectureAtlasEvidence(candidate).ok).toBe(false);
    }
  });

  it("rejects correctly hashed but semantically contradictory source lineage", () => {
    const impostor = createEvidence(undefined, RAA_ARCHITECTURE_PROVIDER, {
      operation: "project_reverse_architecture",
      predicateType: "raa.reverse-architecture-projection",
      parameters: {
        source_evidence_id: `ev_${"f".repeat(64)}`,
        projection_version: 1,
      },
      result: fixtures.application.normalized_result,
      confidence: "inferred",
      authority: "analyst-inference",
      evidenceLinks: fixtures.application.evidence_links,
    });
    expect(parseEvidence(impostor)).toEqual(impostor);
    expect(
      buildReverseArchitectureAtlasEvidence({
        sources: [impostor, fixtures.native],
      }).ok,
    ).toBe(false);
  });

  it("rejects a content-authenticated application projection with invalid relationship counts", () => {
    const raw = fixtures.application.normalized_result;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("Expected object");
    const normalized = architectureAtlasSchema.safeParse(raw);
    expect(normalized.success).toBe(false);

    const candidate = createEvidence(undefined, RAA_ARCHITECTURE_PROVIDER, {
      operation: "project_reverse_architecture",
      predicateType: "raa.reverse-architecture-projection",
      parameters: fixtures.application.parameters,
      result: {
        ...raw,
        summary: {
          components: 0,
          relationships: 0,
          boundary_candidates: 0,
          unresolved_components: 0,
        },
      },
      confidence: "inferred",
      authority: "analyst-inference",
      evidenceLinks: fixtures.application.evidence_links,
    });
    const output = buildReverseArchitectureAtlasEvidence({
      sources: [candidate, fixtures.native],
    });
    expect(output.ok).toBe(false);
  });
});
