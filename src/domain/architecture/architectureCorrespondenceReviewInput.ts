import { z } from "zod";

import { evidenceSchema } from "../evidence.js";

/** Separate atlas Evidence and bounded independent *reports*, never facts. */
export const architectureCorrespondenceReviewInputSchema = z.strictObject({
  atlas: evidenceSchema,
  reports: z.array(evidenceSchema).min(1).max(32),
});
