import { z } from "zod";
import { evidenceSchema } from "../evidence.js";

/** A bounded set of complete RAA Evidence records. */
export const reverseArchitectureFederationInputSchema = z
  .strictObject({
    projections: z.array(evidenceSchema).min(2).max(6),
  })
  .superRefine((input, context) => {
    const ids = input.projections.map((source) => source.evidence_id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["projections"],
        message: "Federation requires distinct source Evidence IDs",
      });
    }
  });
