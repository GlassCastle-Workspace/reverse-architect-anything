import { digestCanonicalValue } from "../canonicalDigest.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import type { ArchitectureProjection } from "./architectureProjection.js";
import type { ArchitectureFederation } from "./architectureFederationSchema.js";

/** A source is an individually validated and Evidence-linked RAA projection. */
export interface ArchitectureFederationSource {
  readonly projection_evidence_id: string;
  readonly projection: ArchitectureProjection;
}

const sorted = (values: readonly string[]): string[] =>
  [...new Set(values)].sort(compareUnicodeCodePoints);

const sortBy = <T>(values: T[], key: (value: T) => string): T[] =>
  values.sort((left, right) => compareUnicodeCodePoints(key(left), key(right)));

const federatedNodeId = (evidenceId: string, nodeId: string): string =>
  `raf_node_${digestCanonicalValue(
    [evidenceId, nodeId],
    "RAA source-scoped component identity",
  )}`;

const federatedId = (
  prefix: "raf_link" | "raf_boundary",
  evidenceId: string,
  id: string,
): string =>
  `${prefix}_${digestCanonicalValue(
    [evidenceId, id],
    "RAA source-scoped relationship identity",
  )}`;

const FEDERATION_LIMITATION =
  "Cross-source SHA-256 digest matches compare reported artifact identities only; federation does not rehash source bytes or establish identical logical components, runtime identities, deployments, trust boundaries or original design intent.";

/**
 * Project multiple distinct, validated RAA architectural sources into a
 * federation WITHOUT unifying their scoped entity identifiers.
 *
 * All carried edges remain inside their original source. Shared digest groups
 * link evidence of byte equality only, never inferred subsystem membership.
 */
export const federateArchitectureProjections = (
  sources: readonly ArchitectureFederationSource[],
): ArchitectureFederation => {
  const ordered = [...sources].sort((left, right) =>
    compareUnicodeCodePoints(
      left.projection_evidence_id,
      right.projection_evidence_id,
    ),
  );
  if (ordered.length < 2) {
    throw new TypeError(
      "Architecture federation requires at least two distinct Evidence sources",
    );
  }
  const identifiers = new Set(
    ordered.map((source) => source.projection_evidence_id),
  );
  if (identifiers.size !== ordered.length) {
    throw new TypeError(
      "Architecture federation cannot duplicate Evidence source identities",
    );
  }

  let coverageComplete = true;

  const sourceItems: ArchitectureFederation["sources"][number][] = [];
  const nodes: ArchitectureFederation["components"][number][] = [];
  const edges: ArchitectureFederation["relationships"][number][] = [];
  const candidates: ArchitectureFederation["boundary_candidates"][number][] =
    [];
  const unresolved: ArchitectureFederation["unresolved"][number][] = [];
  const rootDigests = new Map<string, string[]>();
  const contentDigests = new Map<
    string,
    {
      projection_evidence_id: string;
      federated_id: string;
    }[]
  >();
  const limitations = [FEDERATION_LIMITATION];

  for (const source of ordered) {
    const id = source.projection_evidence_id;
    const projection = source.projection;
    sourceItems.push({
      projection_evidence_id: id,
      graph_evidence_id: projection.source_evidence_id,
      graph_id: projection.source_graph_id,
      source_kind: projection.source_kind,
      root_artifact_sha256: projection.source_root_artifact_sha256,
      coverage: projection.coverage,
      limitations: [...projection.limitations],
    });
    limitations.push(...projection.limitations);
    if (projection.coverage.status !== "complete") {
      coverageComplete = false;
    }

    const owners =
      rootDigests.get(projection.source_root_artifact_sha256) ?? [];
    owners.push(id);
    rootDigests.set(projection.source_root_artifact_sha256, owners);

    const localNodes = new Map<string, string>();
    for (const component of projection.components) {
      const federated_id = federatedNodeId(id, component.component_id);
      if (localNodes.has(component.component_id))
        throw new TypeError(
          "Duplicate component identity within architecture source",
        );
      localNodes.set(component.component_id, federated_id);
      nodes.push({
        federated_id,
        projection_evidence_id: id,
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
      if (
        component.identity.strategy === "content-digest" &&
        component.identity.stability === "global-exact"
      ) {
        const contentSha = component.identity.sha256;
        const equalBytes = contentDigests.get(contentSha) ?? [];
        equalBytes.push({ projection_evidence_id: id, federated_id });
        contentDigests.set(contentSha, equalBytes);
      }
    }

    const originalEdges = new Set<string>();
    for (const relationship of projection.relationships) {
      if (originalEdges.has(relationship.relationship_id))
        throw new TypeError(
          "Duplicate relationship identity within architecture source",
        );
      originalEdges.add(relationship.relationship_id);
      const from_federated_id = localNodes.get(relationship.from_component_id);
      const to_federated_id = localNodes.get(relationship.to_component_id);
      if (from_federated_id === undefined || to_federated_id === undefined)
        throw new TypeError(
          "Federated relationship references a missing source component",
        );
      edges.push({
        federated_id: federatedId("raf_link", id, relationship.relationship_id),
        projection_evidence_id: id,
        from_federated_id,
        to_federated_id,
        relationship: {
          ...relationship,
          evidence_ids: [...relationship.evidence_ids],
          limitations: [...relationship.limitations],
        },
      });
    }
    for (const candidate of projection.boundary_candidates) {
      const from_federated_id = localNodes.get(candidate.from_component_id);
      const to_federated_id = localNodes.get(candidate.to_component_id);
      if (
        from_federated_id === undefined ||
        to_federated_id === undefined ||
        !originalEdges.has(candidate.supporting_relationship_id)
      ) {
        throw new TypeError(
          "Architecture hypothesis lacks source-owned relationship Evidence",
        );
      }
      candidates.push({
        federated_id: federatedId("raf_boundary", id, candidate.candidate_id),
        projection_evidence_id: id,
        from_federated_id,
        to_federated_id,
        candidate: { ...candidate, evidence_ids: [...candidate.evidence_ids] },
      });
    }
    for (const finding of projection.unresolved) {
      const federated_component_id = localNodes.get(finding.component_id);
      if (federated_component_id === undefined)
        throw new TypeError(
          "Unresolved architectural fact references a missing node",
        );
      unresolved.push({
        projection_evidence_id: id,
        federated_component_id,
        finding: { ...finding, limitations: [...finding.limitations] },
      });
    }
  }

  const sharedRoots: ArchitectureFederation["shared_root_artifacts"][number][] =
    [];
  for (const [sha256, evidenceIds] of rootDigests) {
    if (evidenceIds.length < 2) continue;
    sharedRoots.push({
      sha256,
      projection_evidence_ids: sorted(evidenceIds),
      fact: "matching-reported-root-sha256",
    });
  }
  const sharedContent: ArchitectureFederation["shared_component_content"][number][] =
    [];
  for (const [sha256, references] of contentDigests) {
    if (new Set(references.map((item) => item.projection_evidence_id)).size < 2)
      continue;
    sharedContent.push({
      sha256,
      federated_component_ids: sorted(
        references.map((item) => item.federated_id),
      ),
      fact: "matching-reported-content-sha256",
    });
  }

  const result: ArchitectureFederation = {
    schema: "ReverseArchitectureFederation",
    version: 1,
    overall_coverage: coverageComplete
      ? "complete-within-sources"
      : "partial-or-unknown",
    sources: sourceItems,
    components: sortBy(nodes, ({ federated_id }) => federated_id),
    relationships: sortBy(edges, ({ federated_id }) => federated_id),
    boundary_candidates: sortBy(candidates, ({ federated_id }) => federated_id),
    unresolved: sortBy(
      unresolved,
      (finding) =>
        `${finding.projection_evidence_id}:${finding.federated_component_id}`,
    ),
    shared_root_artifacts: sortBy(sharedRoots, (item) => item.sha256),
    shared_component_content: sortBy(sharedContent, (item) => item.sha256),
    limitations: sorted(limitations),
    summary: {
      source_projections: ordered.length,
      components: nodes.length,
      relationships: edges.length,
      boundary_candidates: candidates.length,
      unresolved: unresolved.length,
      shared_root_artifacts: sharedRoots.length,
      shared_component_content: sharedContent.length,
    },
  };
  return result;
};
