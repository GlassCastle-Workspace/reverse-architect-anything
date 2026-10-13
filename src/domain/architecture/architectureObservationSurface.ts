import { digestCanonicalValue } from "../canonicalDigest.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import type { NativeInvestigationTrace } from "../native/nativeInvestigationGraph.js";
import type { NativeInvestigationEdge } from "../native/nativeInvestigationGraph.js";
import type { z } from "zod";
import type { packetCaptureSchema } from "../captures/packetCapture.js";
import type { ArchitectureObservationSurface } from "./architectureObservationSurfaceSchema.js";

const compare = compareUnicodeCodePoints;

const identity = (
  sourceEvidenceId: string,
  kind: "native" | "frame" | "relation",
  originalId: string,
  prefix: "rao_component" | "rao_relation",
): string =>
  `${prefix}_${digestCanonicalValue(
    [sourceEvidenceId, kind, originalId],
    "RAA observation source-scoped identity",
  )}`;

const NATIVE_CATEGORIES = {
  storyboard: "presentation",
  scene: "presentation",
  view_controller: "presentation",
  view: "presentation",
  control: "interaction",
  constraint: "presentation",
  layout_guide: "presentation",
  resource: "resource",
  placeholder: "resource",
  external_object: "resource",
  outlet: "interaction",
  action: "interaction",
  segue: "interaction",
  objc_class: "execution",
  objc_selector: "dispatch",
  swift_declaration: "execution",
  swift_requirement: "dispatch",
  dispatch_table: "dispatch",
  dispatch_slot: "dispatch",
  thunk: "execution",
  function: "execution",
  state_value: "data",
  global_value: "data",
  field: "data",
  branch_condition: "data",
  sink: "sink",
  unknown: "unresolved",
} as const satisfies Record<
  NativeInvestigationTrace["nodes"][number]["kind"],
  Extract<
    ArchitectureObservationSurface,
    { source_kind: "native-trace" }
  >["components"][number]["category"]
>;

const nativeLimitations = [
  "Native dispatch and value-flow edges retain their original resolution; resolved is not equivalent to directly observed.",
  "A bounded native trace cannot establish complete call coverage or runtime behavior.",
];

export const projectNativeArchitectureSurface = (
  sourceEvidenceId: string,
  trace: NativeInvestigationTrace,
): Extract<ArchitectureObservationSurface, { source_kind: "native-trace" }> => {
  const nodes = new Map<string, string>();
  const components = trace.nodes
    .map((node) => {
      if (nodes.has(node.id)) {
        throw new TypeError("Duplicate native node identity in source trace");
      }
      const componentId = identity(
        sourceEvidenceId,
        "native",
        node.id,
        "rao_component",
      );
      nodes.set(node.id, componentId);
      return {
        component_id: componentId,
        source_node_id: node.id,
        original_kind: node.kind,
        category: NATIVE_CATEGORIES[node.kind],
        category_basis: "native-node-kind" as const,
        label: node.name,
        location: node.location,
        attributes: { ...node.attributes },
        source_evidence: [...node.evidence],
      };
    })
    .sort((a, b) => compare(a.component_id, b.component_id));

  const reportedEdges = new Map<string, NativeInvestigationEdge>();
  const edges = trace.edges
    .map((edge) => {
      if (reportedEdges.has(edge.id))
        throw new TypeError("Duplicate native edge identity in source trace");
      reportedEdges.set(edge.id, edge);
      return {
        relationship_id: identity(
          sourceEvidenceId,
          "relation",
          edge.id,
          "rao_relation",
        ),
        source_edge_id: edge.id,
        from_source_node_id: edge.from,
        to_source_node_id: edge.to,
        from_component_id: nodes.get(edge.from) ?? null,
        to_component_id: edge.to === null ? null : (nodes.get(edge.to) ?? null),
        original_relation: edge.relation,
        resolution: edge.resolution,
        reason: edge.resolution === "unresolved" ? edge.reason : null,
        source_evidence: [...edge.evidence],
        limitations: [
          ...edge.limitations,
          ...(nodes.has(edge.from)
            ? []
            : ["Source node was not included in the bounded trace."]),
          ...(edge.to === null || nodes.has(edge.to)
            ? []
            : ["Target node was not included in the bounded trace."]),
        ],
      };
    })
    .sort((a, b) => compare(a.relationship_id, b.relationship_id));

  const missing = new Map<
    string,
    {
      source_edge_id: string;
      from_source_node_id: string;
      to_source_node_id: string | null;
      reason: string;
    }
  >();
  const markUnresolved = (edge: NativeInvestigationEdge, reason: string) => {
    const existing = reportedEdges.get(edge.id);
    if (
      existing !== undefined &&
      JSON.stringify(existing) !== JSON.stringify(edge)
    ) {
      throw new TypeError(
        "Conflicting duplicate native unresolved edge identity",
      );
    }
    const prior = missing.get(edge.id);
    if (prior !== undefined) return;
    missing.set(edge.id, {
      source_edge_id: edge.id,
      from_source_node_id: edge.from,
      to_source_node_id: edge.to,
      reason,
    });
  };

  for (const edge of trace.edges) {
    if (edge.resolution === "unresolved") markUnresolved(edge, edge.reason);
    else if (
      !nodes.has(edge.from) ||
      (edge.to !== null && !nodes.has(edge.to))
    ) {
      markUnresolved(
        edge,
        "Referenced entity not included in the bounded native trace",
      );
    }
  }
  for (const edge of trace.unresolved) {
    markUnresolved(
      edge,
      edge.resolution === "unresolved"
        ? edge.reason
        : "Source separately reported this relationship as unresolved",
    );
  }

  const unresolved = [...missing.values()].sort((a, b) =>
    compare(a.source_edge_id, b.source_edge_id),
  );
  const limitations = [
    ...trace.limitations,
    ...nativeLimitations,
    ...(trace.truncated ? ["The native trace was truncated."] : []),
    ...(trace.coverage.some(({ status }) => status !== "complete")
      ? ["Native facet coverage is incomplete or not requested."]
      : []),
    ...(unresolved.length > 0
      ? ["One or more native dispatch paths remain unresolved."]
      : []),
  ];
  return {
    schema: "ReverseArchitectureObservationSurface",
    version: 1,
    source_kind: "native-trace",
    source_evidence_id: sourceEvidenceId,
    source_target_sha256: trace.target_sha256,
    components,
    relationships: edges,
    unresolved,
    coverage: {
      kind: "native-trace",
      truncated: trace.truncated,
      reached_depth: trace.reached_depth,
      direction: trace.direction,
      query_start: trace.start,
      reason: trace.reason,
      facets: trace.coverage.map((facet) => ({ ...facet })),
    },
    limitations,
    summary: {
      components: components.length,
      relationships: edges.length,
      unresolved: unresolved.length,
    },
  };
};

const PACKET_LIMIT = 2_000;
export const MAX_OBSERVATION_FRAMES = PACKET_LIMIT;
type PacketReport = z.infer<typeof packetCaptureSchema>;

export const projectPacketArchitectureSurface = (
  sourceEvidenceId: string,
  report: PacketReport,
): Extract<
  ArchitectureObservationSurface,
  { source_kind: "packet-capture" }
> => {
  if (report.packets.length > PACKET_LIMIT)
    throw new TypeError(
      "Packet observation projection exceeds frame safety limit",
    );
  const seen = new Set<string>();
  const components = report.packets
    .map((packet) => {
      const frameNumber = packet["frame.number"][0];
      if (frameNumber === undefined || seen.has(frameNumber))
        throw new TypeError("Duplicate or missing packet frame identity");
      seen.add(frameNumber);
      return {
        component_id: identity(
          sourceEvidenceId,
          "frame",
          frameNumber,
          "rao_component",
        ),
        frame_number: frameNumber,
        category: "network-frame" as const,
        category_basis: "reported-frame-number" as const,
        selected_fields: packet,
      };
    })
    .sort((a, b) => compare(a.component_id, b.component_id));

  const incomplete =
    report.read_scope !== "to-eof" ||
    report.output_window.has_more ||
    report.selection.match_offset > 0 ||
    report.selection.display_filter !== null;
  return {
    schema: "ReverseArchitectureObservationSurface",
    version: 1,
    source_kind: "packet-capture",
    source_evidence_id: sourceEvidenceId,
    source_target_sha256: report.artifact.sha256,
    components,
    relationships: [],
    unresolved: [],
    coverage: {
      kind: "packet-capture",
      read_scope: report.read_scope,
      matching_packets: report.output_window.matching_packets,
      returned_packets: report.output_window.returned_packets,
      has_more: report.output_window.has_more,
      match_offset: report.selection.match_offset,
      match_limit: report.selection.match_limit,
      packet_limit: report.selection.packet_limit,
      display_filter: report.selection.display_filter,
      selected_field_names: [...report.selection.fields],
    },
    limitations: [
      "Captured frame numbers and selected fields do not establish network flows, sessions, endpoints, or application identities.",
      "Repeated field values preserve order and may originate from nested protocol layers.",
      ...(incomplete
        ? [
            "The captured field window is filtered, paged, or not examined to EOF; unreported traffic is unknown.",
          ]
        : []),
    ],
    summary: {
      components: components.length,
      relationships: 0,
      unresolved: 0,
    },
  };
};
