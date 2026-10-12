import { z } from "zod";

import { evidenceSchema } from "../evidence.js";

/** A caller must provide the complete, authenticated analysis Evidence. */
export const reverseArchitectureProjectionInputSchema = z.strictObject({
  application: evidenceSchema,
});
