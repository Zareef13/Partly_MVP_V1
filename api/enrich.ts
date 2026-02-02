import { Router } from "express";
import { runProductPipeline } from "../services/runProductPipeline";

export const enrichRouter = Router();

export async function enrichHandler(req: any, res: any) {
  try {
    const { mpns, manufacturer } = req.body;

    if (!Array.isArray(mpns) || !manufacturer) {
      return res.status(400).json({
        error: "Expected { mpns: string[], manufacturer: string }"
      });
    }

    const results = [];

    for (const mpn of mpns) {
      const result = await runProductPipeline({
        mpn,
        manufacturer
      });
      results.push(result);
    }

    return res.json({ results });
  } catch (err: any) {
    console.error("ENRICH ERROR:", err);
    return res.status(500).json({
      error: err.message || "Internal error"
    });
  }
}

// wire handler to router
enrichRouter.post("/", enrichHandler);