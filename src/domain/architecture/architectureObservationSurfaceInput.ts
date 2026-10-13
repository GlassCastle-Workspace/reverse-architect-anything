import { z } from "zod";

import { evidenceSchema } from "../evidence.js";

/** Complete source Evidence; MCP references are resolved before this layer. */
export const observationArchitectureInputSchema = z.strictObject({
  source_kind: z.enum(["native-trace", "packet-capture"]),
  evidence: evidenceSchema,
});
