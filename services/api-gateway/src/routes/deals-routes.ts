import { Router, Request, Response } from 'express';
import { requireAuth, getCurrentUserId } from '../middleware/auth.js';
import { storage } from '@shared/lib/storage/storage.js';
import { evaluateLeadDealValue } from '@services/brain-worker/src/ai-lib/engines/deal-evaluator.js';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const integrationId = req.query.integrationId as string;
    const deals = await storage.getDeals(userId, integrationId);
    // Mapper for UI (converts snake_case to camelCase)
    const formattedDeals = deals.map((d: any) => ({
      ...d,
      leadName: d.leadName || d.lead_name || "Unknown",
    }));
    
    // Return wrapped object like UI expects
    res.json({ deals: formattedDeals });
  } catch (error) {
    console.error('Error fetching deals:', error);
    res.status(500).json({ error: 'Failed to fetch deals' });
  }
});

router.get('/analytics', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const integrationId = req.query.integrationId as string;
    const revenue = await storage.calculateRevenue(userId, integrationId);
    const deals = revenue.deals || [];

    const openDeals = deals.filter((d: any) => d.status === 'open');
    const wonDeals = deals.filter((d: any) => d.status === 'closed_won' || d.status === 'converted');
    const lostDeals = deals.filter((d: any) => d.status === 'closed_lost');

    // Build timeline from wonDeals
    const timelineMap = new Map<string, number>();
    const now = new Date();
    // Fill last 7 days with zero
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      timelineMap.set(d.toISOString().split('T')[0], 0);
    }
    
    // Calculate previous week revenue
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    let previousWeekRevenue = 0;
    
    wonDeals.forEach((d: any) => {
      if (!d.converted_at && !d.convertedAt) return;
      const dateStr = new Date(d.converted_at || d.convertedAt).toISOString().split('T')[0];
      const val = Number(d.value) || 0;
      
      const dealDate = new Date(d.converted_at || d.convertedAt);
      if (dealDate >= fourteenDaysAgo && dealDate < sevenDaysAgo) {
         previousWeekRevenue += val;
      }
      
      if (timelineMap.has(dateStr)) {
        timelineMap.set(dateStr, timelineMap.get(dateStr)! + val);
      }
    });

    const timeline = Array.from(timelineMap.entries()).map(([date, rev]) => ({
      date: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      revenue: rev
    }));

    res.json({
      totalRevenue: revenue.total,
      thisMonthRevenue: revenue.thisMonth,
      previousWeekRevenue,
      timeline,
      dealCount: deals.length,
      openDeals: openDeals.length,
      wonDeals: wonDeals.length,
      lostDeals: lostDeals.length,
      winRate: deals.length > 0 ? Math.round((wonDeals.length / (wonDeals.length + lostDeals.length || 1)) * 100) : 0,
      pipelineValue: openDeals.reduce((sum: number, d: any) => sum + (Number(d.value) || 0), 0),
    });
  } catch (error) {
    console.error('Error fetching deal analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const deal = await storage.createDeal({
      userId,
      ...req.body
    });

    // Notify client via WebSocket
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifyDealsUpdated(userId);
    wsSync.notifyStatsUpdated(userId);

    res.status(201).json(deal);
  } catch (error) {
    console.error('Error creating deal:', error);
    res.status(500).json({ error: 'Failed to create deal' });
  }
});

router.patch('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const deal = await storage.updateDeal(req.params.id as string, userId, req.body);
    if (!deal) {
      res.status(404).json({ error: 'Deal not found' });
      return;
    }

    // Notify client via WebSocket
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifyDealsUpdated(userId);
    wsSync.notifyStatsUpdated(userId);

    res.json(deal);
  } catch (error) {
    console.error('Error updating deal:', error);
    res.status(500).json({ error: 'Failed to update deal' });
  }
});

router.post('/sync', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const leads = await storage.getLeads({ userId });
    let analyzedCount = 0;

    // Run in parallel with a concurrency limit if needed, for now just sequential for safety
    for (const lead of leads) {
      const messages = await storage.getMessagesByLeadId(lead.id);
      if (messages && messages.length > 0) {
        await evaluateLeadDealValue(userId, lead.id.toString());
        analyzedCount++;
      }
    }

    // Notify client via WebSocket
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifyDealsUpdated(userId);
    wsSync.notifyStatsUpdated(userId);

    res.json({ success: true, analyzedCount });
  } catch (error) {
    console.error('Error syncing deals:', error);
    res.status(500).json({ error: 'Failed to sync deals' });
  }
});

export default router;


