import { describe, expect, it } from "vitest";

import { packetCaptureSchema } from "../captures/packetCapture.js";
import { nativeInvestigationTraceSchema } from "../native/nativeInvestigationGraph.js";
import {
  NATIVE_TRACE_EVIDENCE,
  PACKET_CAPTURE_EVIDENCE,
  nativeFixtureTrace,
  packetFixtureReport,
} from "./architectureObservationSurface.fixture.js";
import {
  projectNativeArchitectureSurface,
  projectPacketArchitectureSurface,
} from "./architectureObservationSurface.js";
import { architectureObservationSurfaceSchema } from "./architectureObservationSurfaceSchema.js";

describe("native architecture observation surface", () => {
  it("retains exact source identities, directed calls, native locations and unresolved dispatch", () => {
    const result = projectNativeArchitectureSurface(
      NATIVE_TRACE_EVIDENCE.evidence_id,
      nativeFixtureTrace,
    );
    expect(architectureObservationSurfaceSchema.parse(result)).toEqual(result);
    expect(result.summary).toEqual({
      components: 3,
      relationships: 2,
      unresolved: 1,
    });
    const functions = result.components.filter(
      ({ original_kind }) => original_kind === "function",
    );
    expect(functions).toHaveLength(2);
    expect(functions[0]?.label).toBe("process");
    expect(functions[1]?.label).toBe("process");
    expect(functions[0]?.component_id).not.toBe(functions[1]?.component_id);
    const direct = result.relationships.find(
      ({ source_edge_id }) => source_edge_id === "edge:direct",
    );
    expect(direct).toMatchObject({
      original_relation: "direct_call",
      resolution: "observed",
      from_source_node_id: "fn:start",
      to_source_node_id: "fn:end",
    });
    expect(direct?.to_component_id).not.toBeNull();
    expect(result.unresolved).toEqual([
      {
        source_edge_id: "edge:unknown",
        from_source_node_id: "fn:end",
        to_source_node_id: null,
        reason: "Target is dynamically computed.",
      },
    ]);
    expect(
      result.relationships.find(
        ({ source_edge_id }) => source_edge_id === "edge:unknown",
      )?.to_component_id,
    ).toBeNull();
    expect(result.coverage.truncated).toBe(true);
    expect(result.coverage.facets[0]?.status).toBe("partial");
  });

  it("keeps relationships with omitted endpoints explicitly unresolved", () => {
    const trace = nativeInvestigationTraceSchema.parse({
      ...nativeFixtureTrace,
      nodes: nativeFixtureTrace.nodes.slice(0, 1),
    });
    const result = projectNativeArchitectureSurface(
      NATIVE_TRACE_EVIDENCE.evidence_id,
      trace,
    );
    expect(result.unresolved).toHaveLength(2);
    const reported = result.relationships.find(
      ({ source_edge_id }) => source_edge_id === "edge:direct",
    );
    expect(reported?.to_source_node_id).toBe("fn:end");
    expect(reported?.to_component_id).toBeNull();
    expect(reported?.limitations).toContain(
      "Target node was not included in the bounded trace.",
    );
  });

  it("rejects duplicate native identities instead of merging similar labels", () => {
    const trace = nativeInvestigationTraceSchema.parse({
      ...nativeFixtureTrace,
      nodes: [nativeFixtureTrace.nodes[0], nativeFixtureTrace.nodes[0]],
    });
    expect(() =>
      projectNativeArchitectureSurface(
        NATIVE_TRACE_EVIDENCE.evidence_id,
        trace,
      ),
    ).toThrow(/Duplicate native node identity/u);
  });
});

describe("packet observation architecture surface", () => {
  it("preserves ordered repeated field values without asserting a network flow", () => {
    const result = projectPacketArchitectureSurface(
      PACKET_CAPTURE_EVIDENCE.evidence_id,
      packetFixtureReport,
    );
    expect(architectureObservationSurfaceSchema.parse(result)).toEqual(result);
    expect(result.summary).toEqual({
      components: 2,
      relationships: 0,
      unresolved: 0,
    });
    expect(
      result.components.some(({ frame_number }) => frame_number === "7"),
    ).toBe(true);
    expect(
      result.components.find(({ frame_number }) => frame_number === "7")
        ?.selected_fields["ip.src"],
    ).toEqual(["198.51.100.10", "192.0.2.2"]);
    expect(result.relationships).toEqual([]);
    expect(result.coverage).toMatchObject({
      kind: "packet-capture",
      read_scope: "up-to-input-packet-limit",
      matching_packets: 4,
      returned_packets: 2,
      has_more: true,
      match_offset: 1,
    });
    expect(result.limitations.join(" ")).toMatch(/unknown/u);
  });

  it("rejects duplicate frame numbers despite otherwise valid packet windows", () => {
    const bad = packetCaptureSchema.parse({
      ...packetFixtureReport,
      packets: [packetFixtureReport.packets[0], packetFixtureReport.packets[0]],
    });
    expect(() =>
      projectPacketArchitectureSurface(
        PACKET_CAPTURE_EVIDENCE.evidence_id,
        bad,
      ),
    ).toThrow(/Duplicate or missing packet frame identity/u);
  });

  it("keeps empty filtered packet windows distinct from evidence of absent traffic", () => {
    const selection = { ...packetFixtureReport.selection, match_offset: 5 };
    const empty = packetCaptureSchema.parse({
      ...packetFixtureReport,
      selection,
      packets: [],
      output_window: {
        matching_packets: 4,
        returned_packets: 0,
        has_more: false,
      },
    });
    const result = projectPacketArchitectureSurface(
      PACKET_CAPTURE_EVIDENCE.evidence_id,
      empty,
    );
    expect(result.components).toHaveLength(0);
    expect(result.coverage.match_offset).toBe(5);
    expect(result.limitations.join(" ")).toMatch(
      /unreported traffic is unknown/u,
    );
  });
});
