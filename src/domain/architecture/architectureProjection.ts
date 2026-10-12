import { digestCanonicalValue } from "../canonicalDigest.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import type { JavaScriptApplicationGraph } from "../javascript/javascriptApplicationGraph.js";
import type {
  ApplicationEdge,
  ApplicationNode,
} from "../javascript/javascriptApplicationGraphSchemas.js";
import type { ApplicationGraphEvidence } from "../javascript/javascriptApplicationEvidenceSchemas.js";

/**
 * An architectural interpretation of authenticated application evidence.
 *
 * This model is intentionally NOT a recovered design document: its categories
 * are derived, and its proposed boundaries are hypotheses to be verified.
 */
export type ArchitectureCategory =
  | "distribution"
  | "artifact"
  | "execution-context"
  | "interface"
  | "implementation"
  | "storage"
  | "unresolved";

type FactState = ApplicationGraphEvidence["state"];
type FactConfidence = ApplicationGraphEvidence["confidence"];

export interface ArchitectureObservation {
  readonly observation_id: string;
  readonly fact_state: FactState;
  readonly confidence: FactConfidence;
  readonly evidence_ids: readonly string[];
  readonly limitations: readonly string[];
}

export interface ArchitectureComponent {
  /** Original graph identity: never merge entities by similar display names. */
  readonly component_id: string;
  readonly original_kind: ApplicationNode["kind"];
  /** Original scoped identity, never inferred from a display label. */
  readonly identity: ApplicationNode["identity"];
  /** This category is DERIVED from the original node kind, not observed. */
  readonly category: ArchitectureCategory;
  readonly category_basis: "source-node-kind";
  readonly identity_stability: ApplicationNode["identity"]["stability"];
  readonly labels: readonly string[];
  readonly observations: readonly ArchitectureObservation[];
}

export interface ArchitectureRelationship {
  readonly relationship_id: string;
  readonly from_component_id: string;
  readonly to_component_id: string;
  readonly original_relation: ApplicationEdge["relation"];
  readonly fact_state: FactState;
  readonly confidence: FactConfidence;
  readonly evidence_ids: readonly string[];
  readonly limitations: readonly string[];
}

export interface ArchitectureBoundaryCandidate {
  readonly candidate_id: string;
  readonly from_component_id: string;
  readonly to_component_id: string;
  readonly supporting_relationship_id: string;
  readonly kind: "communication" | "exposure" | "invocation" | "persistence";
  /** An architectural boundary cannot be proven from an edge type alone. */
  readonly epistemic_status: "hypothesis";
  readonly source_fact_state: FactState;
  readonly evidence_ids: readonly string[];
  readonly verification_question: string;
}

export interface ArchitectureUnresolved {
  readonly component_id: string;
  readonly reason:
    | "unresolved-node-kind"
    | "unknown-or-unavailable-observation";
  readonly limitations: readonly string[];
}

export type ArchitectureSourceKind =
  | "static-application"
  | "static-runtime-reconciliation"
  | "managed-application";

export interface ArchitectureSourceDescriptor {
  readonly kind: ArchitectureSourceKind;
  readonly rootArtifactSha256: string;
}

export interface ArchitectureProjection {
  readonly schema: "ReverseArchitectureProjection";
  readonly version: 1;
  readonly source_graph_id: string;
  /** Discriminated source family: from the existing validated Evidence adapter. */
  readonly source_kind: ArchitectureSourceKind;
  /** Root artifact digest, never inferred from a display filename. */
  readonly source_root_artifact_sha256: string;
  /** Authenticated outer Evidence record; graph-local evidence may be empty. */
  readonly source_evidence_id: string;
  readonly components: readonly ArchitectureComponent[];
  readonly relationships: readonly ArchitectureRelationship[];
  readonly boundary_candidates: readonly ArchitectureBoundaryCandidate[];
  readonly unresolved: readonly ArchitectureUnresolved[];
  readonly coverage: JavaScriptApplicationGraph["coverage"];
  readonly limitations: readonly string[];
  readonly summary: {
    readonly components: number;
    readonly relationships: number;
    readonly boundary_candidates: number;
    readonly unresolved_components: number;
  };
}

const executionKinds = new Set<string>([
  "electron-main",
  "electron-preload",
  "electron-renderer",
  "electron-utility",
  "browser-window",
  "frame",
  "target",
  "worker",
  "service-worker",
  "runtime-script-instance",
]);

const interfaceKinds = new Set<string>([
  "context-bridge-api",
  "ipc-channel",
  "ipc-handler",
  "endpoint",
  "native-export",
  "managed-pinvoke-import",
]);

const artifactKinds = new Set<string>([
  "artifact",
  "asar-entry",
  "javascript-asset",
  "javascript-chunk",
  "source-map",
]);

const sortedUnique = (values: readonly string[]): string[] =>
  [...new Set(values)].sort(compareUnicodeCodePoints);

export const classifyArchitectureNode = (
  kind: ApplicationNode["kind"],
): ArchitectureCategory => {
  if (kind === "unknown") return "unresolved";
  if (kind === "package" || kind === "installer") return "distribution";
  if (kind === "storage") return "storage";
  if (executionKinds.has(kind)) return "execution-context";
  if (interfaceKinds.has(kind)) return "interface";
  if (artifactKinds.has(kind)) return "artifact";
  return "implementation";
};

const boundaryKind = (
  relation: ApplicationEdge["relation"],
): ArchitectureBoundaryCandidate["kind"] | null => {
  switch (relation) {
    case "sends":
    case "handles":
      return "communication";
    case "exposes":
      return "exposure";
    case "invokes":
      return "invocation";
    case "persists_to":
      return "persistence";
    default:
      return null;
  }
};

const verificationQuestion = (
  kind: ArchitectureBoundaryCandidate["kind"],
): string => {
  switch (kind) {
    case "communication":
      return "Do these endpoints cross a process, trust, or deployment boundary? Verify routing and authority at runtime.";
    case "exposure":
      return "What interface is actually exposed, to whom, and under which access controls?";
    case "invocation":
      return "Is this an in-process call, cross-process invocation, or an external dependency?";
    case "persistence":
      return "Which storage ownership, durability, and data-access boundaries apply?";
  }
};

/**
 * Project one ALREADY AUTHENTICATED and graph-validated source.
 *
 * Inputs are version-qualified by the graph and evidence IDs. In particular,
 * structural-fingerprint identities do not authorize cross-version merging.
 * Validate untrusted evidence at the application boundary before calling.
 */
export const projectJavaScriptArchitecture = (
  graph: JavaScriptApplicationGraph,
  sourceEvidenceId: string,
  source: ArchitectureSourceDescriptor,
): ArchitectureProjection => {
  const components = graph.nodes
    .map((node): ArchitectureComponent => ({
      component_id: node.node_id,
      original_kind: node.kind,
      identity: node.identity,
      category: classifyArchitectureNode(node.kind),
      category_basis: "source-node-kind",
      identity_stability: node.identity.stability,
      labels: sortedUnique(
        node.observations.flatMap(({ label }) =>
          label === null ? [] : [label],
        ),
      ),
      observations: node.observations.map((observation) => ({
        observation_id: observation.observation_id,
        fact_state: observation.evidence.state,
        confidence: observation.evidence.confidence,
        evidence_ids: sortedUnique(observation.evidence.evidence_ids),
        limitations: sortedUnique(observation.evidence.limitations),
      })),
    }))
    .sort((a, b) => compareUnicodeCodePoints(a.component_id, b.component_id));

  const componentById = new Map(
    components.map((component) => [component.component_id, component]),
  );
  const relationships = graph.edges
    .map((edge): ArchitectureRelationship => ({
      relationship_id: edge.edge_id,
      from_component_id: edge.source_node_id,
      to_component_id: edge.target_node_id,
      original_relation: edge.relation,
      fact_state: edge.evidence.state,
      confidence: edge.evidence.confidence,
      evidence_ids: sortedUnique(edge.evidence.evidence_ids),
      limitations: sortedUnique(edge.evidence.limitations),
    }))
    .sort((a, b) =>
      compareUnicodeCodePoints(a.relationship_id, b.relationship_id),
    );

  const boundaryCandidates: ArchitectureBoundaryCandidate[] = [];
  for (const relationship of relationships) {
    const kind = boundaryKind(relationship.original_relation);
    if (kind === null) continue;
    const from = componentById.get(relationship.from_component_id);
    const to = componentById.get(relationship.to_component_id);
    if (from === undefined || to === undefined) {
      throw new TypeError(
        "Validated application graph references a missing node",
      );
    }
    // Different categories suggest an architectural seam, not proof of one.
    if (from.category === to.category) continue;
    boundaryCandidates.push({
      candidate_id: `ra_boundary_${digestCanonicalValue(
        [graph.graph_id, relationship.relationship_id],
        "Reverse Architecture Boundary Candidate",
      )}`,
      from_component_id: from.component_id,
      to_component_id: to.component_id,
      supporting_relationship_id: relationship.relationship_id,
      kind,
      epistemic_status: "hypothesis",
      source_fact_state: relationship.fact_state,
      evidence_ids: relationship.evidence_ids,
      verification_question: verificationQuestion(kind),
    });
  }

  const unresolved: ArchitectureUnresolved[] = [];
  for (const node of graph.nodes) {
    const ambiguous = node.observations.some(
      ({ evidence }) =>
        evidence.state === "unknown" || evidence.state === "unavailable",
    );
    if (!ambiguous && node.kind !== "unknown") continue;
    unresolved.push({
      component_id: node.node_id,
      reason:
        node.kind === "unknown"
          ? "unresolved-node-kind"
          : "unknown-or-unavailable-observation",
      limitations: sortedUnique(
        node.observations.flatMap(({ evidence }) => evidence.limitations),
      ),
    });
  }
  unresolved.sort((a, b) =>
    compareUnicodeCodePoints(a.component_id, b.component_id),
  );

  return {
    schema: "ReverseArchitectureProjection",
    version: 1,
    source_graph_id: graph.graph_id,
    source_kind: source.kind,
    source_root_artifact_sha256: source.rootArtifactSha256,
    source_evidence_id: sourceEvidenceId,
    components,
    relationships,
    boundary_candidates: boundaryCandidates,
    unresolved,
    coverage: graph.coverage,
    limitations: graph.limitations,
    summary: {
      components: components.length,
      relationships: relationships.length,
      boundary_candidates: boundaryCandidates.length,
      unresolved_components: unresolved.length,
    },
  };
};
