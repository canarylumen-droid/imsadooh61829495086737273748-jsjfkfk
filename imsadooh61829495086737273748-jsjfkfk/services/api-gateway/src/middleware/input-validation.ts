
import { Request, Response, NextFunction } from "express";
import { body, param, query, validationResult } from "express-validator";

/**
 * Security: Input validation middleware
 * Prevents SQL injection, XSS, and other injection attacks
 */

export const validateEmail = body("email")
  .trim()
  .isEmail()
  .normalizeEmail()
  .withMessage("Invalid email format");

export const validateUserId = param("userId")
  .trim()
  .isUUID()
  .withMessage("Invalid user ID format");

export const validateLeadId = param("id")
  .trim()
  .isUUID()
  .withMessage("Invalid lead ID format");

export const validateMessageBody = body("body")
  .trim()
  .isLength({ min: 1, max: 5000 })
  .escape() // Prevent XSS
  .withMessage("Message body must be between 1 and 5000 characters");

export const validateLeadName = body("name")
  .trim()
  .isLength({ min: 1, max: 100 })
  .escape() // Prevent XSS
  .withMessage("Name must be between 1 and 100 characters");

export const validateSearchQuery = query("search")
  .optional()
  .trim()
  .isLength({ max: 100 })
  .escape() // Prevent XSS and SQL injection
  .withMessage("Search query too long");

export const validatePlanKey = body("planKey")
  .trim()
  .isIn(["starter", "pro", "enterprise"])
  .withMessage("Invalid plan selection");

export const validateChannel = body("channel")
  .trim()
  .isIn(["instagram", "email"])
  .withMessage("Invalid channel");

export const validateProvider = param("provider")
  .trim()
  .isIn(["instagram", "gmail", "outlook", "manychat"])
  .withMessage("Invalid provider");

export const validateWebhookUrl = body("url")
  .trim()
  .isURL({ protocols: ["https"], require_protocol: true })
  .withMessage("Webhook URL must be a valid HTTPS URL");

/**
 * Middleware to check validation results and return errors
 */
export function handleValidationErrors(req: Request, res: Response, next: NextFunction) {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    // Security: Don't expose internal validation details
    return res.status(400).json({
      error: "Invalid input",
      details: errors.array().map(err => ({
        field: err.type === 'field' ? (err as any).path : 'unknown',
        message: err.msg
      }))
    });
  }

  next();
}

/**
 * Sanitize object to prevent prototype pollution
 */
export function sanitizeObject(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // Remove dangerous properties
  const sanitized = Array.isArray(obj) ? [] : {};

  for (const key in obj) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue; // Skip dangerous properties
    }

    if (obj.hasOwnProperty(key)) {
      (sanitized as any)[key] = sanitizeObject(obj[key]);
    }
  }

  return sanitized;
}

/**
 * Middleware to sanitize request body
 */
export function sanitizeBody(req: Request, res: Response, next: NextFunction) {
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  next();
}