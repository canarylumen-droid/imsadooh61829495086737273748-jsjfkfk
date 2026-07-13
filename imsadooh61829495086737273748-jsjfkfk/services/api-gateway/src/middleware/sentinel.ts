import { Request, Response, NextFunction } from 'express';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';

const SUSPICIOUS_PATHS = [
    '/wp-admin',
    '/wp-login.php',
    '/wp-includes',
    '/wp-content',
    '/wp-config.php',
    '.php',
    '.env',
    '/.git',
    '/xmlrpc.php',
    '/actuator',
    '/.well-known/security.txt', // Sometimes probed by bots
];

const SUSPICIOUS_USER_AGENTS = [
    'nmap',
    'sqlmap',
    'nikto',
    'dirbuster',
    'censys',
];

interface SecurityViolation {
    ip: string;
    path: string;
    userAgent: string;
    timestamp: number;
}

// Simple in-memory violation tracker (could be moved to Redis for production persistence)
const violations: SecurityViolation[] = [];
const MAX_VIOLATIONS = 1000;

export function sentinel(req: Request, res: Response, next: NextFunction) {
    const path = req.path.toLowerCase();
    const userAgent = (req.headers['user-agent'] || '').toLowerCase();
    const ip = (req.headers['x-forwarded-for'] as string || req.ip || 'unknown').split(',')[0].trim();

    const isSuspiciousPath = SUSPICIOUS_PATHS.some(p => path.includes(p));
    const isSuspiciousUA = SUSPICIOUS_USER_AGENTS.some(ua => userAgent.includes(ua));

    if (isSuspiciousPath || isSuspiciousUA) {
        const violation: SecurityViolation = {
            ip,
            path: req.path,
            userAgent: req.headers['user-agent'] as string,
            timestamp: Date.now(),
        };

        // Add to log
        violations.unshift(violation);
        if (violations.length > MAX_VIOLATIONS) violations.pop();

        // Log to console for visibility
        console.warn(`🚨 [SENTINEL] Blocked ${req.method} ${req.path} from IP ${ip} (Reason: ${isSuspiciousPath ? 'Suspicious Path' : 'Suspicious UA'})`);

        // Broadcast alert via WebSocket
        wsSync.broadcastToAdmins({
            type: 'SECURITY_ALERT',
            data: violation
        });

        // 403 Forbidden
        return res.status(403).send('Forbidden: Security Policy Violation');
    }

    next();
}

/**
 * Get recent security violations for the dashboard
 */
export function getSecurityLogs() {
    return violations;
}

