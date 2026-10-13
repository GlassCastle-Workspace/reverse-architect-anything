import { digestCanonicalValue } from "../canonicalDigest.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import type { ArchitectureProjection } from "./architectureProjection.js";
import type { ArchitectureObservationSurface } from "./architectureObservationSurfaceSchema.js";
import type { ArchitectureAtlas } from "./architectureAtlasSchema.js";

/** A producer-validated projection; never resolve original source identities by name. */
export type ArchitectureAtlasSource =
  | {
      readonly projection_evidence_id: string;
      readonly projection: ArchitectureProjection;
    }
  | {
      readonly projection_evidence_id: string;
      readonly surface: ArchitectureObservationSurface;
    };

const ordered = <T>(items: T[], id: (value: T) => string): T[] =>
  items.sort((left, right) => compareUnicodeCodePoints(id(left), id(right)));

const unique = (items: readonly string[]): string[] =>
  [...new Set(items)].sort(compareUnicodeCodePoints);

const nodeId = (sourceId: string, originalId: string) =>
  `raa_node_${digestCanonicalValue(
    [sourceId, originalId],
    "RAA atlas source-scoped node",
  )}`;

const edgeId = (sourceId: string, originalId: string) =>
  `raa_edge_${digestCanonicalValue(
    [sourceId, originalId],
    "RAA atlas source-scoped edge",
  )}`;

const findingId = (sourceId: string, originalId: string) =>
  `raa_finding_${digestCanonicalValue(
    [sourceId, originalId],
    "RAA atlas source-scoped unresolved fact",
  )}`;

const hypothesisId = (sourceId: string, originalId: string) =>
  `raa_hypothesis_${digestCanonicalValue(
    [sourceId, originalId],
    "RAA atlas source-scoped hypothesis",
  )}`;

const LIMITATION =
  "This atlas preserves multiple evidence sources as separate scoped graphs. It contains no asserted cross-source relationships. Matching names, addresses, reported artifact hashes, or timestamps do not authorize merging nodes, inferring execution, network conversations, trust boundaries, or design intent.";

/** A source-bound, canonical graph: application + native trace + packet fields. */
export const buildArchitectureAtlas = (
  inputs: readonly ArchitectureAtlasSource[],
): ArchitectureAtlas => {
  const sortedSources = [...inputs].sort((a, b) =>
    compareUnicodeCodePoints(
      a.projection_evidence_id,
      b.projection_evidence_id,
    ),
  );
  const ids = new Set(sortedSources.map((s) => s.projection_evidence_id));
  if (sortedSources.length < 2 || ids.size !== sortedSources.length)
    throw new TypeError("Atlas requires distinct source Evidence identities");

  const sources: ArchitectureAtlas["sources"][number][] = [];
  const nodes: ArchitectureAtlas["nodes"][number][] = [];
  const relationships: ArchitectureAtlas["relationships"][number][] = [];
  const unresolved: ArchitectureAtlas["unresolved"][number][] = [];
  const hypotheses: ArchitectureAtlas["boundary_hypotheses"][number][] = [];
  const digestOwners = new Map<string, string[]>();
  const limitations = [LIMITATION];

  let applications = 0;
  let natives = 0;
  let packets = 0;
  let allComplete = true;

  for (const input of sortedSources) {
    const id = input.projection_evidence_id;
    const localNodes = new Map<string, string>();
    const localEdges = new Set<string>();
    if ("projection" in input) {
      applications++;
      const { projection } = input;
      const complete = projection.coverage.status === "complete";
      if (!complete) allComplete = false;
      sources.push({
        source_kind: "application",
        projection_evidence_id: id,
        source_evidence_id: projection.source_evidence_id,
        source_target_sha256: projection.source_root_artifact_sha256,
        application_source_kind: projection.source_kind,
        original_graph_id: projection.source_graph_id,
        coverage: projection.coverage,
        limitations: [...projection.limitations],
        completeness: complete
          ? "complete-within-declared-scope"
          : "partial-or-unknown",
      });
      limitations.push(...projection.limitations);
      if (
        projection.summary.components !== projection.components.length ||
        projection.summary.relationships !== projection.relationships.length ||
        projection.summary.boundary_candidates !==
          projection.boundary_candidates.length ||
        projection.summary.unresolved_components !==
          projection.unresolved.length
      )
        throw new TypeError(
          "Application projection summary disagrees with its graph",
        );

      for (const component of projection.components) {
        if (localNodes.has(component.component_id))
          throw new TypeError("Duplicate application component identity");
        const atlas_node_id = nodeId(id, component.component_id);
        localNodes.set(component.component_id, atlas_node_id);
        nodes.push({
          atlas_node_id,
          projection_evidence_id: id,
          domain: "application",
          component: {
            ...component,
            labels: [...component.labels],
            observations: component.observations.map((observation) => ({
              ...observation,
              evidence_ids: [...observation.evidence_ids],
              limitations: [...observation.limitations],
            })),
          },
        });
      }
      for (const relationship of projection.relationships) {
        if (localEdges.has(relationship.relationship_id))
          throw new TypeError("Duplicate application relationship identity");
        localEdges.add(relationship.relationship_id);
        const from = localNodes.get(relationship.from_component_id);
        const to = localNodes.get(relationship.to_component_id);
        if (from === undefined || to === undefined)
          throw new TypeError(
            "Application relationship refers to an unknown component",
          );
        relationships.push({
          atlas_edge_id: edgeId(id, relationship.relationship_id),
          projection_evidence_id: id,
          domain: "application",
          from_atlas_node_id: from,
          to_atlas_node_id: to,
          relationship: {
            ...relationship,
            evidence_ids: [...relationship.evidence_ids],
            limitations: [...relationship.limitations],
          },
        });
      }
      for (const hypothesis of projection.boundary_candidates) {
        const from = localNodes.get(hypothesis.from_component_id);
        const to = localNodes.get(hypothesis.to_component_id);
        if (
          from === undefined ||
          to === undefined ||
          !localEdges.has(hypothesis.supporting_relationship_id)
        )
          throw new TypeError(
            "Architecture hypothesis lacks its source graph relationship",
          );
        hypotheses.push({
          atlas_hypothesis_id: hypothesisId(id, hypothesis.candidate_id),
          projection_evidence_id: id,
          from_atlas_node_id: from,
          to_atlas_node_id: to,
          hypothesis: {
            ...hypothesis,
            evidence_ids: [...hypothesis.evidence_ids],
          },
        });
      }
      for (const finding of projection.unresolved) {
        const node = localNodes.get(finding.component_id);
        if (node === undefined)
          throw new TypeError("Application unknown references an absent node");
        unresolved.push({
          atlas_finding_id: findingId(id, finding.component_id),
          projection_evidence_id: id,
          domain: "application",
          atlas_node_id: node,
          finding: { ...finding, limitations: [...finding.limitations] },
        });
      }
    } else if (input.surface.source_kind === "native-trace") {
      natives++;
      const { surface } = input;
      const complete =
        !surface.coverage.truncated &&
        surface.coverage.reason === null &&
        surface.coverage.facets.length > 0 &&
        surface.coverage.facets.every(({ status }) => status === "complete") &&
        surface.unresolved.length === 0;
      if (!complete) allComplete = false;
      sources.push({
        source_kind: "native-trace",
        projection_evidence_id: id,
        source_evidence_id: surface.source_evidence_id,
        source_target_sha256: surface.source_target_sha256,
        coverage: surface.coverage,
        limitations: [...surface.limitations],
        completeness: complete
          ? "complete-within-declared-scope"
          : "partial-or-unknown",
      });
      limitations.push(...surface.limitations);
      if (
        surface.summary.components !== surface.components.length ||
        surface.summary.relationships !== surface.relationships.length ||
        surface.summary.unresolved !== surface.unresolved.length
      )
        throw new TypeError("Native surface summary disagrees with its trace");
      const nativeIdentifiers = new Map<string, string>();
      for (const component of surface.components) {
        if (localNodes.has(component.component_id))
          throw new TypeError("Duplicate native component identity");
        if (nativeIdentifiers.has(component.source_node_id))
          throw new TypeError("Duplicate native source-node identity");
        nativeIdentifiers.set(component.source_node_id, component.component_id);
        const atlas_node_id = nodeId(id, component.component_id);
        localNodes.set(component.component_id, atlas_node_id);
        nodes.push({
          atlas_node_id,
          projection_evidence_id: id,
          domain: "native",
          component,
        });
      }
      for (const relationship of surface.relationships) {
        if (localEdges.has(relationship.relationship_id))
          throw new TypeError("Duplicate native relationship identity");
        localEdges.add(relationship.relationship_id);
        const expectedFrom =
          nativeIdentifiers.get(relationship.from_source_node_id) ?? null;
        const expectedTo =
          relationship.to_source_node_id === null
            ? null
            : (nativeIdentifiers.get(relationship.to_source_node_id) ?? null);
        if (
          relationship.from_component_id !== expectedFrom ||
          relationship.to_component_id !== expectedTo
        )
          throw new TypeError(
            "Native relationship original and projected identities disagree",
          );
        const from =
          relationship.from_component_id === null
            ? null
            : localNodes.get(relationship.from_component_id);
        const to =
          relationship.to_component_id === null
            ? null
            : localNodes.get(relationship.to_component_id);
        if (from === undefined || to === undefined)
          throw new TypeError(
            "Native relationship references absent projected identity",
          );
        relationships.push({
          atlas_edge_id: edgeId(id, relationship.relationship_id),
          projection_evidence_id: id,
          domain: "native",
          from_atlas_node_id: from,
          to_atlas_node_id: to,
          relationship,
        });
      }
      const unknownIds = new Set<string>();
      for (const finding of surface.unresolved) {
        if (unknownIds.has(finding.source_edge_id))
          throw new TypeError(
            "Duplicate native unresolved relationship identity",
          );
        unknownIds.add(finding.source_edge_id);
        const from = surface.components.find(
          (component) =>
            component.source_node_id === finding.from_source_node_id,
        );
        unresolved.push({
          atlas_finding_id: findingId(id, finding.source_edge_id),
          projection_evidence_id: id,
          domain: "native",
          atlas_node_id:
            from === undefined
              ? null
              : (localNodes.get(from.component_id) ?? null),
          finding,
        });
      }
    } else {
      packets++;
      const { surface } = input;
      const complete =
        surface.coverage.read_scope === "to-eof" &&
        surface.coverage.match_offset === 0 &&
        surface.coverage.display_filter === null &&
        !surface.coverage.has_more &&
        surface.coverage.matching_packets === surface.coverage.returned_packets;
      if (!complete) allComplete = false;
      sources.push({
        source_kind: "packet-capture",
        projection_evidence_id: id,
        source_evidence_id: surface.source_evidence_id,
        source_target_sha256: surface.source_target_sha256,
        coverage: surface.coverage,
        limitations: [...surface.limitations],
        completeness: complete
          ? "complete-within-declared-scope"
          : "partial-or-unknown",
      });
      limitations.push(...surface.limitations);
      if (
        surface.summary.components !== surface.components.length ||
        surface.summary.relationships !== 0 ||
        surface.summary.unresolved !== 0 ||
        surface.relationships.length > 0 ||
        surface.unresolved.length > 0
      )
        throw new TypeError(
          "Packet surface fabricated relationships or misreported counts",
        );
      const packetFrameNumbers = new Set<string>();
      for (const component of surface.components) {
        if (localNodes.has(component.component_id))
          throw new TypeError("Duplicate packet component identity");
        if (
          packetFrameNumbers.has(component.frame_number) ||
          component.selected_fields["frame.number"][0] !==
            component.frame_number
        )
          throw new TypeError(
            "Packet component frame identity conflicts with its source fields",
          );
        packetFrameNumbers.add(component.frame_number);
        const atlas_node_id = nodeId(id, component.component_id);
        localNodes.set(component.component_id, atlas_node_id);
        nodes.push({
          atlas_node_id,
          projection_evidence_id: id,
          domain: "packet",
          component,
        });
      }
    }
    const digest = sources.at(-1)?.source_target_sha256;
    if (digest === undefined)
      throw new TypeError("Atlas source digest is missing");
    const owners = digestOwners.get(digest) ?? [];
    owners.push(id);
    digestOwners.set(digest, owners);
  }

  if (Number(applications > 0) + Number(natives > 0) + Number(packets > 0) < 2)
    throw new TypeError(
      "Heterogeneous atlas requires at least two distinct source domains",
    );

  const matches: ArchitectureAtlas["reported_artifact_digest_matches"] = [];
  for (const [digest, owners] of digestOwners) {
    if (owners.length < 2) continue;
    matches.push({
      sha256: digest,
      projection_evidence_ids: unique(owners),
      fact: "matching-reported-artifact-sha256",
    });
  }
  const atlas: ArchitectureAtlas = {
    schema: "ReverseArchitectureAtlas",
    version: 1,
    sources,
    nodes: ordered(nodes, (node) => node.atlas_node_id),
    relationships: ordered(relationships, (edge) => edge.atlas_edge_id),
    boundary_hypotheses: ordered(hypotheses, (h) => h.atlas_hypothesis_id),
    unresolved: ordered(unresolved, (finding) => finding.atlas_finding_id),
    reported_artifact_digest_matches: ordered(matches, (match) => match.sha256),
    cross_source_relationships: [],
    overall_completeness: allComplete
      ? "complete-within-declared-scopes"
      : "partial-or-unknown",
    limitations: unique(limitations),
    summary: {
      sources: sources.length,
      application_sources: applications,
      native_sources: natives,
      packet_sources: packets,
      nodes: nodes.length,
      relationships: relationships.length,
      boundary_hypotheses: hypotheses.length,
      unresolved: unresolved.length,
      reported_artifact_digest_matches: matches.length,
      cross_source_relationships: 0,
    },
  };
  return atlas;
};
