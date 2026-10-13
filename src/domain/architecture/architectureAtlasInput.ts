import { z } from "zod";
import { evidenceSchema } from "../evidence.js";

/** Strict bounded collection of content-identified architecture sources. */
export const architectureAtlasInputSchema = z.strictObject({
  sources: z.array(evidenceSchema).min(2).max(8),
});
