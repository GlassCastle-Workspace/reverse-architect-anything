import { describe, expect, it } from "vitest";
import { createJavaScriptApplicationNode } from "../javascript/javascriptApplicationGraph.js";
import {
  buildSyntheticJavaScriptApplicationGraph,
  artifactEvidence,
  contentNode,
  graphForNode,
  inferredArtifactEvidence,
  unknownEvidence,
  APPLICATION_GRAPH_DIGESTS,
} from "../javascript/javascriptApplicationGraph.fixture.js";
import {
  classifyArchitectureNode,
  projectJavaScriptArchitecture,
} from "./architectureProjection.js";

const SOURCE_EVIDENCE_ID = `ev_${"f".repeat(64)}`;
const SOURCE = {
  kind: "static-application" as const,
  rootArtifactSha256: APPLICATION_GRAPH_DIGESTS.package,
};

describe("Reverse Architecting projection", () => {
  it("deterministically classifies evidence-backed components and retains original identities", () => {
    const graph = buildSyntheticJavaScriptApplicationGraph();
    const report = projectJavaScriptArchitecture(
      graph,
      SOURCE_EVIDENCE_ID,
      SOURCE,
    );
    expect(report.schema).toBe("ReverseArchitectureProjection");
    expect(report.source_graph_id).toBe(graph.graph_id);
    expect(report.source_evidence_id).toBe(SOURCE_EVIDENCE_ID);
    expect(report.summary.components).toBe(graph.nodes.length);
    expect(report.summary.relationships).toBe(graph.edges.length);
    expect(new Set(report.components.map((node) => node.component_id))).toEqual(
      new Set(graph.nodes.map((node) => node.node_id)),
    );
    expect(
      projectJavaScriptArchitecture(graph, SOURCE_EVIDENCE_ID, SOURCE),
    ).toEqual(report);
    for (const node of graph.nodes) {
      expect(
        report.components.find(
          (component) => component.component_id === node.node_id,
        )?.identity,
      ).toEqual(node.identity);
    }
    expect(
      report.components.every(
        (node) => node.category_basis === "source-node-kind",
      ),
    ).toBe(true);
  });

  it("marks every proposed cross-category boundary as a hypothesis, never an observation", () => {
    const report = projectJavaScriptArchitecture(
      buildSyntheticJavaScriptApplicationGraph(),
      SOURCE_EVIDENCE_ID,
      SOURCE,
    );
    const byId = new Map(
      report.components.map((component) => [component.component_id, component]),
    );
    expect(report.boundary_candidates.length).toBeGreaterThan(0);
    for (const candidate of report.boundary_candidates) {
      expect(candidate.epistemic_status).toBe("hypothesis");
      expect(candidate.verification_question.length).toBeGreaterThan(20);
      expect(byId.get(candidate.from_component_id)?.category).not.toBe(
        byId.get(candidate.to_component_id)?.category,
      );
      expect(
        report.relationships.some(
          (relation) =>
            relation.relationship_id === candidate.supporting_relationship_id,
        ),
      ).toBe(true);
    }
  });

  it("does not invent architectural boundaries when no directed relation exists", () => {
    const graph = graphForNode(
      contentNode(
        artifactEvidence(APPLICATION_GRAPH_DIGESTS.asar, "src/index.js"),
      ),
    );
    const report = projectJavaScriptArchitecture(
      graph,
      SOURCE_EVIDENCE_ID,
      SOURCE,
    );
    expect(report.boundary_candidates).toEqual([]);
    expect(report.summary.relationships).toBe(0);
  });

  it("preserves unknown and inferred observations alongside valid artifact identity", () => {
    const node = createJavaScriptApplicationNode({
      kind: "javascript-module",
      identity: {
        strategy: "content-digest",
        stability: "global-exact",
        sha256: APPLICATION_GRAPH_DIGESTS.asar,
      },
      observations: [
        {
          label: "source",
          properties: {},
          evidence: artifactEvidence(
            APPLICATION_GRAPH_DIGESTS.asar,
            "src/index.js",
          ),
        },
        {
          label: "derived",
          properties: {},
          evidence: inferredArtifactEvidence(
            APPLICATION_GRAPH_DIGESTS.asar,
            "src/index.js",
          ),
        },
        {
          label: "unresolved",
          properties: {},
          evidence: unknownEvidence(["Unresolved role."]),
        },
      ],
    });
    const graph = graphForNode(node);
    const report = projectJavaScriptArchitecture(
      graph,
      SOURCE_EVIDENCE_ID,
      SOURCE,
    );
    expect(report.unresolved).toEqual([
      {
        component_id: node.node_id,
        reason: "unknown-or-unavailable-observation",
        limitations: [
          "Unresolved role.",
          ...node.observations.flatMap(({ evidence }) =>
            evidence.limitations.filter((item) => item !== "Unresolved role."),
          ),
        ].sort(),
      },
    ]);
    expect(
      report.components[0]?.observations.map((item) => item.fact_state),
    ).toEqual(expect.arrayContaining(["observed", "inferred", "unknown"]));
    expect(report.coverage).toEqual(graph.coverage);
  });

  it("does not conflate runtime and artifact identities or native and process interfaces", () => {
    expect(classifyArchitectureNode("electron-renderer")).toBe(
      "execution-context",
    );
    expect(classifyArchitectureNode("ipc-channel")).toBe("interface");
    expect(classifyArchitectureNode("native-addon")).toBe("implementation");
    expect(classifyArchitectureNode("storage")).toBe("storage");
    expect(classifyArchitectureNode("unknown")).toBe("unresolved");
  });
});
