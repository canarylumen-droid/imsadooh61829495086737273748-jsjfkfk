
import { Request, Response, NextFunction } from "express";
import { storage } from "@shared/lib/storage/storage.js";

/**
 * Security: Audit logging middleware
 * Tracks sensitive operations for security monitoring
 */

interface AuditEvent {
  userId?: string;
  action: string;
  resource: string;
  ip: string;
  userAgent: string;
  timestamp: Date;
  success: boolean;
  details?: any;
}

const auditLog: AuditEvent[] = [];

export function logAuditEvent(event: AuditEvent) {
  auditLog.push(event);
  
  // Log to console for monitoring
  console.log(`[AUDIT] ${event.action} on ${event.resource} by ${event.userId || 'anonymous'} - ${event.success ? 'SUCCESS' : 'FAILED'}`);
  
  // Keep only last 1000 events in memory
  if (auditLog.length > 1000) {
    auditLog.shift();
  }
}

export function auditAuth(req: Request, res: Response, next: NextFunction) {
  const originalJson = res.json.bind(res);
  
  res.json = function(body: any) {
    const userId = req.session?.userId;
    const success = res.statusCode < 400;
    
    logAuditEvent({
      userId,
      action: 'AUTH_ATTEMPT',
      resource: req.path,
      ip: req.ip || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
      timestamp: new Date(),
      success,
    });
    
    return originalJson(body);
  };
  
  next();
}

export function auditSensitiveOperation(req: Request, res: Response, next: NextFunction) {
  const originalJson = res.json.bind(res);
  
  res.json = function(body: any) {
    const userId = req.session?.userId;
    const success = res.statusCode < 400;
    
    logAuditEvent({
      userId,
      action: req.method,
      resource: req.path,
      ip: req.ip || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
      timestamp: new Date(),
      success,
      details: { method: req.method, statusCode: res.statusCode },
    });
    
    return originalJson(body);
  };
  
  next();
}

export function getAuditLog(): AuditEvent[] {
  return auditLog.slice(-100); // Return last 100 events
}
