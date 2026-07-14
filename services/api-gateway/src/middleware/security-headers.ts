
import { Request, Response, NextFunction } from "express";

/**
 * Additional security headers middleware
 * Complements helmet with extra protection
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "DENY");
  
  // Prevent MIME type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");
  
  // Enable XSS filter in older browsers
  res.setHeader("X-XSS-Protection", "1; mode=block");
  
  // Referrer policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  
  // Permissions policy
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  
  next();
}

/**
 * CORS configuration for production
 */
export function corsConfig(req: Request, res: Response, next: NextFunction) {
  next();
}
