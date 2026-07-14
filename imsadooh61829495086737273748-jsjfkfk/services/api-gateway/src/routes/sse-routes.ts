import { Router, Request, Response } from 'express';
import { sseService } from '../web-sockets/sse.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

/**
 * Unified SSE connection endpoint with advanced features
 * GET /api/sse/connect?compression=true&subscribe=mailbox_health,dns_verification
 */
router.get('/connect', requireAuth, async (req: Request, res: Response) => {
  try {
    const options = {
      compression: req.query.compression === 'true',
      subscriptions: Array.isArray(req.query.subscribe) 
        ? req.query.subscribe as string[]
        : req.query.subscribe 
          ? [req.query.subscribe as string]
          : undefined,
    };
    
    const clientId = await sseService.addClient(req, res, options);
    
    console.log(`[SSE] Advanced client connected: ${clientId} with options:`, options);
    
    // Send initial connection confirmation
    res.write(`data: ${JSON.stringify({ type: 'connected', clientId, timestamp: new Date().toISOString() })}\n\n`);
  } catch (e) {
    res.status(503).json({ error: 'Service unavailable', reason: (e as Error).message });
  }
});

/**
 * SSE connection endpoint for real-time metrics (legacy support)
 * GET /api/sse/metrics/:userId
 */
router.get('/metrics/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const options = {
      compression: req.query.compression === 'true',
      subscriptions: ['metrics_update', 'mailbox_health', 'alert'],
    };
    
    const clientId = await sseService.addClient(req, res, options);
    
    console.log(`[SSE] Metrics stream connected for user: ${req.params.userId}, client: ${clientId}`);
    
    res.write(`data: ${JSON.stringify({ type: 'connected', clientId, userId: req.params.userId, stream: 'metrics' })}\n\n`);
  } catch (e) {
    res.status(503).json({ error: 'Service unavailable', reason: (e as Error).message });
  }
});

/**
 * SSE connection endpoint for mailbox health updates (legacy support)
 * GET /api/sse/mailbox-health/:userId
 */
router.get('/mailbox-health/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const options = {
      compression: req.query.compression === 'true',
      subscriptions: ['mailbox_health', 'alert'],
    };
    
    const clientId = await sseService.addClient(req, res, options);
    
    console.log(`[SSE] Mailbox health stream connected for user: ${req.params.userId}, client: ${clientId}`);
    
    res.write(`data: ${JSON.stringify({ type: 'connected', clientId, userId: req.params.userId, stream: 'mailbox-health' })}\n\n`);
  } catch (e) {
    res.status(503).json({ error: 'Service unavailable', reason: (e as Error).message });
  }
});

/**
 * SSE connection endpoint for DNS verification updates (legacy support)
 * GET /api/sse/dns-verification/:userId
 */
router.get('/dns-verification/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const options = {
      compression: req.query.compression === 'true',
      subscriptions: ['dns_verification', 'alert'],
    };
    
    const clientId = await sseService.addClient(req, res, options);
    
    console.log(`[SSE] DNS verification stream connected for user: ${req.params.userId}, client: ${clientId}`);
    
    res.write(`data: ${JSON.stringify({ type: 'connected', clientId, userId: req.params.userId, stream: 'dns-verification' })}\n\n`);
  } catch (e) {
    res.status(503).json({ error: 'Service unavailable', reason: (e as Error).message });
  }
});

/**
 * Health check for SSE service with detailed metrics
 * GET /api/sse/health
 */
router.get('/health', (req: Request, res: Response) => {
  const metrics = sseService.getHealthMetrics();
  res.json({
    status: 'healthy',
    ...metrics,
    uptime: process.uptime(),
  });
});

/**
 * Get dead letter queue for monitoring
 * GET /api/sse/dead-letter?limit=100
 */
router.get('/dead-letter', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const deadLetters = sseService.getDeadLetterQueue(limit);
  res.json({
    count: deadLetters.length,
    deadLetters,
  });
});

/**
 * Clear dead letter queue (admin only)
 * DELETE /api/sse/dead-letter
 */
router.delete('/dead-letter', requireAuth, requireAdmin, (req: Request, res: Response) => {
  sseService.clearDeadLetterQueue();
  res.json({ success: true, message: 'Dead letter queue cleared' });
});

/**
 * Reset circuit breaker (admin only)
 * POST /api/sse/circuit-breaker/reset
 */
router.post('/circuit-breaker/reset', requireAuth, requireAdmin, (req: Request, res: Response) => {
  sseService.resetCircuitBreaker();
  res.json({ success: true, message: 'Circuit breaker reset' });
});

/**
 * Send acknowledgment from client
 * POST /api/sse/ack
 */
router.post('/ack', requireAuth, (req: Request, res: Response) => {
  const { clientId, messageId } = req.body;
  
  if (!clientId || !messageId) {
    return res.status(400).json({ error: 'Missing clientId or messageId' });
  }
  
  // This would be handled by the SSE service's acknowledgment system
  // For now, just acknowledge receipt
  res.json({ success: true, message: 'Acknowledgment received' });
});

export { router as sseRouter };
