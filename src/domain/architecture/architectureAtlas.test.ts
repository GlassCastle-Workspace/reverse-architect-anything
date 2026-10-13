import { expect, it } from "vitest";

import { architectureAtlasSchema } from "./architectureAtlasSchema.js";
import { buildArchitectureAtlas } from "./architectureAtlas.js";
import {
  atlasFixtureSources,
  atlasFixtureApplication,
  atlasFixtureNative,
  atlasFixturePacket,
} from "./architectureAtlas.fixture.js";

const sources = atlasFixtureSources;
const applicationSchema = atlasFixtureApplication;
const nativeSchema = atlasFixtureNative;
const packetSchema = atlasFixturePacket;

it("retains three fully typed source domains without cross-source edges", () => {
  const atlas = buildArchitectureAtlas(sources);
  expect(architectureAtlasSchema.parse(atlas)).toEqual(atlas);
  expect(atlas.summary).toMatchObject({
    sources: 3,
    application_sources: 1,
    native_sources: 1,
    packet_sources: 1,
    nodes:
      applicationSchema.components.length +
      nativeSchema.components.length +
      packetSchema.components.length,
    relationships:
      applicationSchema.relationships.length +
      nativeSchema.relationships.length,
    unresolved:
      applicationSchema.unresolved.length + nativeSchema.unresolved.length,
    cross_source_relationships: 0,
  });
  expect(atlas.cross_source_relationships).toEqual([]);
  expect(
    new Set(atlas.nodes.map(({ atlas_node_id }) => atlas_node_id)).size,
  ).toBe(atlas.nodes.length);
  expect(atlas.nodes.some(({ domain }) => domain === "application")).toBe(true);
  expect(atlas.nodes.some(({ domain }) => domain === "native")).toBe(true);
  expect(atlas.nodes.some(({ domain }) => domain === "packet")).toBe(true);
  expect(atlas.overall_completeness).toBe("partial-or-unknown");
});

it("preserves native unknown targets and ordered repeated packet fields without inventing a session", () => {
  const atlas = buildArchitectureAtlas(sources);
  const unknown = atlas.relationships.find(
    (entry) =>
      entry.domain === "native" &&
      entry.relationship.source_edge_id === "edge:unknown",
  );
  expect(unknown).toMatchObject({
    domain: "native",
    to_atlas_node_id: null,
    relationship: { resolution: "unresolved" },
  });
  const packetNode = atlas.nodes.find(
    (entry) =>
      entry.domain === "packet" && entry.component.frame_number === "7",
  );
  expect(packetNode?.domain).toBe("packet");
  if (packetNode?.domain !== "packet")
    throw new Error("Fixture frame was omitted");
  expect(packetNode.component.selected_fields["ip.src"]).toEqual([
    "198.51.100.10",
    "192.0.2.2",
  ]);
  expect(
    atlas.sources.find(({ source_kind }) => source_kind === "packet-capture")
      ?.completeness,
  ).toBe("partial-or-unknown");
});

it("has deterministic content regardless of input ordering", () => {
  const forward = buildArchitectureAtlas(sources);
  const reverse = buildArchitectureAtlas([...sources].reverse());
  expect(reverse).toEqual(forward);
  expect(architectureAtlasSchema.parse(reverse)).toEqual(forward);
});

it("rejects duplicate Evidence identities or homogeneous app-only inputs", () => {
  expect(() => buildArchitectureAtlas([sources[0]!, sources[0]!])).toThrow(
    /distinct source Evidence/u,
  );
  expect(() =>
    buildArchitectureAtlas([
      sources[0]!,
      { ...sources[0]!, projection_evidence_id: `ev_${"f".repeat(64)}` },
    ]),
  ).toThrow(/Heterogeneous atlas/u);
});

it("rejects orphaned source edges instead of promoting them into atlas relations", () => {
  const candidate = {
    ...applicationSchema,
    relationships: [
      {
        ...applicationSchema.relationships[0]!,
        to_component_id: `jag_node_${"f".repeat(64)}`,
      },
    ],
    summary: {
      ...applicationSchema.summary,
      relationships: 1,
    },
  };
  expect(() =>
    buildArchitectureAtlas([
      {
        projection_evidence_id: sources[0]!.projection_evidence_id,
        projection: candidate,
      },
      sources[1]!,
    ]),
  ).toThrow(/unknown component/u);
});

it("rejects an inconsistent application source summary even when source IDs are distinct", () => {
  const candidate = {
    ...applicationSchema,
    summary: {
      ...applicationSchema.summary,
      components: 42_000,
    },
  };
  expect(() =>
    buildArchitectureAtlas([
      {
        projection_evidence_id: sources[0]!.projection_evidence_id,
        projection: candidate,
      },
      sources[1]!,
    ]),
  ).toThrow(/summary disagrees/u);
});

it("only reports exact supplied artifact digest coincidences, never cross-source edges", () => {
  const nativeWithReportedMatchingDigest = {
    ...nativeSchema,
    source_target_sha256: applicationSchema.source_root_artifact_sha256,
  };
  const atlas = buildArchitectureAtlas([
    sources[0]!,
    {
      projection_evidence_id: sources[1]!.projection_evidence_id,
      surface: nativeWithReportedMatchingDigest,
    },
  ]);
  expect(atlas.reported_artifact_digest_matches).toEqual([
    {
      sha256: applicationSchema.source_root_artifact_sha256,
      projection_evidence_ids: [
        sources[0]!.projection_evidence_id,
        sources[1]!.projection_evidence_id,
      ].sort(),
      fact: "matching-reported-artifact-sha256",
    },
  ]);
  expect(atlas.cross_source_relationships).toEqual([]);
});

it("rejects self-consistent-looking native edges whose original and projected IDs disagree", () => {
  const first = nativeSchema.relationships[0];
  const other = nativeSchema.components[1];
  if (first === undefined || other === undefined)
    throw new Error("Missing native fixture identities");
  const incorrect = {
    ...nativeSchema,
    relationships: [
      { ...first, from_component_id: other.component_id },
      ...nativeSchema.relationships.slice(1),
    ],
  };
  expect(() =>
    buildArchitectureAtlas([
      sources[0]!,
      {
        projection_evidence_id: sources[1]!.projection_evidence_id,
        surface: incorrect,
      },
    ]),
  ).toThrow(/original and projected identities disagree/u);
});

it("rejects packet frame IDs that contradict original selected fields", () => {
  const first = packetSchema.components[0];
  if (first === undefined) throw new Error("Missing selected packet fixture");
  const incorrect = {
    ...packetSchema,
    components: [
      {
        ...first,
        selected_fields: {
          ...first.selected_fields,
          "frame.number": ["999"] as [string],
        },
      },
      ...packetSchema.components.slice(1),
    ],
  };
  expect(() =>
    buildArchitectureAtlas([
      sources[0]!,
      {
        projection_evidence_id: sources[2]!.projection_evidence_id,
        surface: incorrect,
      },
    ]),
  ).toThrow(/frame identity conflicts/u);
});
