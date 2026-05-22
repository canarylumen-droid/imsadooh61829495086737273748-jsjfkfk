import type { Request, Response, NextFunction } from "express";
import { getActivePlanId } from "@shared/plan-utils.js";

export function requireProPlan(req: Request, res: Response, next: NextFunction) {
  const plan = getActivePlanId(req.user);
  if (!["pro", "enterprise"].includes(plan)) {
    return res.status(403).json({
      error: "Pro plan required",
      message: "Lead Recovery is available on Pro and Enterprise plans.",
      requiredPlan: "pro",
      currentPlan: plan,
    });
  }

  next();
}
