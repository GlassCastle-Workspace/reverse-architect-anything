import { expect, it } from "vitest";

import {
  createJavaScriptApplicationNode,
  createJavaScriptApplicationGraph,
} from "../javascript/javascriptApplicationGraph.js";
import {
  artifactEvidence,
  APPLICATION_GRAPH_DIGESTS,
  buildSyntheticJavaScriptApplicationGraph,
  completeCoverage,
  contentNode,
  graphForNode,
} from "../javascript/javascriptApplicationGraph.fixture.js";
import { projectJavaScriptArchitecture } from "./architectureProjection.js";
import { federateArchitectureProjections } from "./architectureFederation.js";
import { architectureFederationSchema } from "./architectureFederationSchema.js";

const evidenceA = `ev_${"a".repeat(64)}`;
const evidenceB = `ev_${"b".repeat(64)}`;

const projectionA = projectJavaScriptArchitecture(
  buildSyntheticJavaScriptApplicationGraph(),
  evidenceA,
  {
    kind: "static-application",
    rootArtifactSha256: APPLICATION_GRAPH_DIGESTS.package,
  },
);
const projectionB = projectJavaScriptArchitecture(
  buildSyntheticJavaScriptApplicationGraph(),
  evidenceB,
  {
    kind: "managed-application",
    rootArtifactSha256: APPLICATION_GRAPH_DIGESTS.package,
  },
);

it("is deterministic across input order and never merges scoped nodes", () => {
  const left = [
    { projection_evidence_id: evidenceA, projection: projectionA },
    { projection_evidence_id: evidenceB, projection: projectionB },
  ];
  const first = federateArchitectureProjections(left);
  const second = federateArchitectureProjections([...left].reverse());
  expect(second).toEqual(first);
  expect(architectureFederationSchema.parse(first)).toEqual(first);
  expect(first.summary.source_projections).toBe(2);
  expect(first.summary.components).toBe(2 * projectionA.components.length);
  expect(first.summary.relationships).toBe(
    2 * projectionA.relationships.length,
  );
  expect(new Set(first.components.map((item) => item.federated_id)).size).toBe(
    first.components.length,
  );
  expect(first.sources.map(({ source_kind }) => source_kind)).toEqual([
    "static-application",
    "managed-application",
  ]);
  const sourceById = new Map(
    first.components.map((item) => [
      item.federated_id,
      item.projection_evidence_id,
    ]),
  );
  for (const relation of first.relationships) {
    expect(sourceById.get(relation.from_federated_id)).toBe(
      relation.projection_evidence_id,
    );
    expect(sourceById.get(relation.to_federated_id)).toBe(
      relation.projection_evidence_id,
    );
  }
  expect(
    first.boundary_candidates.every(
      (item) => item.candidate.epistemic_status === "hypothesis",
    ),
  ).toBe(true);
});

it("matches the same SHA-256 bytes but never claims equivalent logical entities", () => {
  const report = federateArchitectureProjections([
    { projection_evidence_id: evidenceA, projection: projectionA },
    { projection_evidence_id: evidenceB, projection: projectionB },
  ]);
  expect(report.shared_root_artifacts).toEqual([
    {
      sha256: APPLICATION_GRAPH_DIGESTS.package,
      projection_evidence_ids: [evidenceA, evidenceB],
      fact: "matching-reported-root-sha256",
    },
  ]);
  expect(report.shared_component_content.length).toBeGreaterThan(0);
  expect(
    report.shared_component_content.every(
      (group) => group.fact === "matching-reported-content-sha256",
    ),
  ).toBe(true);
  expect(
    report.limitations.some((item) =>
      item.includes("identical logical components"),
    ),
  ).toBe(true);
});

it("does not link equal names when byte identities differ", () => {
  const first = graphForNode(
    contentNode(
      artifactEvidence(APPLICATION_GRAPH_DIGESTS.asar, "same-name.js"),
    ),
  );
  const other = createJavaScriptApplicationNode({
    kind: "javascript-module",
    identity: {
      strategy: "content-digest",
      stability: "global-exact",
      sha256: APPLICATION_GRAPH_DIGESTS.nativeAddon,
    },
    observations: [
      {
        label: "module",
        properties: {},
        evidence: artifactEvidence(
          APPLICATION_GRAPH_DIGESTS.nativeAddon,
          "same-name.js",
        ),
      },
    ],
  });
  const second = graphForNode(other);
  const report = federateArchitectureProjections([
    {
      projection_evidence_id: evidenceA,
      projection: projectJavaScriptArchitecture(first, evidenceA, {
        kind: "static-application",
        rootArtifactSha256: APPLICATION_GRAPH_DIGESTS.asar,
      }),
    },
    {
      projection_evidence_id: evidenceB,
      projection: projectJavaScriptArchitecture(second, evidenceB, {
        kind: "managed-application",
        rootArtifactSha256: APPLICATION_GRAPH_DIGESTS.nativeAddon,
      }),
    },
  ]);
  expect(report.components[0]?.component.labels).toEqual(["module"]);
  expect(report.components[1]?.component.labels).toEqual(["module"]);
  expect(report.shared_component_content).toEqual([]);
  expect(report.shared_root_artifacts).toEqual([]);
  expect(report.summary.components).toBe(2);
});

it("propagates incomplete coverage instead of claiming source absence", () => {
  const node = contentNode(
    artifactEvidence(APPLICATION_GRAPH_DIGESTS.asar, "src/file.js"),
  );
  const partial = createJavaScriptApplicationGraph({
    schema: "JavaScriptApplicationGraph",
    root_node_ids: [node.node_id],
    nodes: [node],
    edges: [],
    coverage: {
      status: "partial",
      truncated: false,
      omitted_count: 2,
      limits: [],
    },
    limitations: ["Source map was unavailable."],
  });
  const projection = projectJavaScriptArchitecture(partial, evidenceB, {
    kind: "static-application",
    rootArtifactSha256: APPLICATION_GRAPH_DIGESTS.asar,
  });
  const result = federateArchitectureProjections([
    { projection_evidence_id: evidenceA, projection: projectionA },
    { projection_evidence_id: evidenceB, projection },
  ]);
  expect(result.overall_coverage).toBe("partial-or-unknown");
  expect(
    result.sources.find((item) => item.projection_evidence_id === evidenceB)
      ?.coverage.status,
  ).toBe("partial");
  expect(result.limitations).toContain("Source map was unavailable.");
});

it("refuses duplicate source IDs, absent source IDs, or dangling local facts", () => {
  const source = {
    projection_evidence_id: evidenceA,
    projection: projectionA,
  };
  expect(() => federateArchitectureProjections([source])).toThrow();
  expect(() => federateArchitectureProjections([source, source])).toThrow();
  expect(() =>
    federateArchitectureProjections([
      { projection_evidence_id: evidenceB, projection: projectionA },
      source,
    ]),
  ).not.toThrow();

  const firstEdge = projectionA.relationships[0];
  if (firstEdge === undefined) throw new Error("Fixture has no edge");
  const broken = {
    ...projectionA,
    relationships: [
      {
        ...firstEdge,
        from_component_id: `jag_node_${"0".repeat(64)}`,
      },
    ],
  };
  expect(() =>
    federateArchitectureProjections([
      { projection_evidence_id: evidenceA, projection: broken },
      { projection_evidence_id: evidenceB, projection: projectionB },
    ]),
  ).toThrow(/missing source component/);
});
