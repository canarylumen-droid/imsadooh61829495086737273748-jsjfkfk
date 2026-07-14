import { Router, Request, Response } from 'express';
import { requireAuth, getCurrentUserId } from '../middleware/auth.js';
import { db } from '@shared/lib/db/db.js';
import { sql } from 'drizzle-orm';

const router = Router();

interface Objection {
  id: string;
  name: string;
  content: string;
  category: string;
  intentTags: string[];
  objectionTags: string[];
  channelRestriction: string;
  usageCount: number;
  successRate: number | null;
}

router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { channel, category, search } = req.query;

    let query = sql`
      SELECT 
        id, 
        name, 
        content, 
        metadata->>'category' as category,
        intent_tags as intent_tags,
        objection_tags as objection_tags,
        channel_restriction,
        usage_count,
        success_rate
      FROM content_library
      WHERE type = 'objection'
        AND is_active = true
        AND (user_id = ${userId} OR user_id IS NULL)
    `;

    if (channel && channel !== 'all') {
      query = sql`${query} AND (channel_restriction = ${channel as string} OR channel_restriction = 'all')`;
    }

    if (category) {
      query = sql`${query} AND metadata->>'category' = ${category as string}`;
    }

    if (search) {
      const searchPattern = `%${search}%`;
      query = sql`${query} AND (name ILIKE ${searchPattern} OR content ILIKE ${searchPattern})`;
    }

    query = sql`${query} ORDER BY usage_count DESC, name ASC LIMIT 200`;

    const result = await db.execute(query);

    const objections: Objection[] = result.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      content: row.content,
      category: row.category || 'general',
      intentTags: row.intent_tags || [],
      objectionTags: row.objection_tags || [],
      channelRestriction: row.channel_restriction || 'all',
      usageCount: row.usage_count || 0,
      successRate: row.success_rate,
    }));

    const categories = [
      { id: 'timing', name: 'Timing', count: 0 },
      { id: 'price', name: 'Price', count: 0 },
      { id: 'trust', name: 'Trust', count: 0 },
      { id: 'authority', name: 'Authority', count: 0 },
      { id: 'fit', name: 'Fit', count: 0 },
      { id: 'competitor', name: 'Competitor', count: 0 },
      { id: 'decision', name: 'Decision', count: 0 },
    ];

    objections.forEach(obj => {
      const cat = categories.find(c => c.id === obj.category);
      if (cat) cat.count++;
    });

    res.json({
      objections,
      categories: categories.filter(c => c.count > 0),
      total: objections.length,
    });
  } catch (error) {
    console.error('Error fetching objections:', error);
    res.status(500).json({ error: 'Failed to fetch objections' });
  }
});

router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;

    const result = await db.execute(sql`
      SELECT 
        id, name, content, 
        metadata->>'category' as category,
        intent_tags, objection_tags, channel_restriction,
        usage_count, success_rate
      FROM content_library
      WHERE id = ${id as string}
        AND type = 'objection'
        AND (user_id = ${userId} OR user_id IS NULL)
    `);

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Objection not found' });
      return;
    }

    const row = result.rows[0] as any;
    res.json({
      id: row.id,
      name: row.name,
      content: row.content,
      category: row.category || 'general',
      intentTags: row.intent_tags || [],
      objectionTags: row.objection_tags || [],
      channelRestriction: row.channel_restriction || 'all',
      usageCount: row.usage_count || 0,
      successRate: row.success_rate,
    });
  } catch (error) {
    console.error('Error fetching objection:', error);
    res.status(500).json({ error: 'Failed to fetch objection' });
  }
});

router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { name, content, category, intentTags, objectionTags, channelRestriction } = req.body;

    if (!name || !content) {
      res.status(400).json({ error: 'Name and content are required' });
      return;
    }

    const result = await db.execute(sql`
      INSERT INTO content_library (
        user_id, type, name, content, 
        intent_tags, objection_tags, channel_restriction, metadata
      )
      VALUES (
        ${userId}, 'objection', ${name}, ${content},
        ${JSON.stringify(intentTags || [])}::jsonb,
        ${JSON.stringify(objectionTags || [])}::jsonb,
        ${channelRestriction || 'all'},
        ${JSON.stringify({ category: category || 'general' })}::jsonb
      )
      RETURNING id
    `);

    res.json({
      success: true,
      id: (result.rows[0] as any).id,
      message: 'Objection created successfully',
    });
  } catch (error) {
    console.error('Error creating objection:', error);
    res.status(500).json({ error: 'Failed to create objection' });
  }
});

router.post('/:id/copy', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;

    await db.execute(sql`
      UPDATE content_library
      SET usage_count = usage_count + 1, updated_at = NOW()
      WHERE id = ${id as string}
    `);

    res.json({ success: true, message: 'Copy tracked' });
  } catch (error) {
    console.error('Error tracking copy:', error);
    res.status(500).json({ error: 'Failed to track copy' });
  }
});

router.get('/analyze/:text', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const objectionText = decodeURIComponent(req.params.text);

    const keywords: Record<string, string[]> = {
      timing: ['busy', 'later', 'not now', 'wait', 'time', 'month', 'week', 'quarter', 'holiday'],
      price: ['expensive', 'cost', 'budget', 'afford', 'cheap', 'money', 'price', 'discount'],
      trust: ['proof', 'reviews', 'legit', 'safe', 'trust', 'scam', 'heard', 'experience'],
      authority: ['partner', 'boss', 'team', 'board', 'approval', 'spouse', 'decide'],
      fit: ['industry', 'size', 'small', 'big', 'different', 'model', 'niche'],
      competitor: ['using', 'have', 'already', 'tried', 'similar', 'other', 'switched'],
      decision: ['think', 'sure', 'almost', 'maybe', 'scared', 'ready', 'convinced'],
    };

    const lowerText = objectionText.toLowerCase();
    let bestCategory = 'general';
    let bestScore = 0;

    for (const [category, words] of Object.entries(keywords)) {
      const score = words.filter(w => lowerText.includes(w)).length;
      if (score > bestScore) {
        bestScore = score;
        bestCategory = category;
      }
    }

    const result = await db.execute(sql`
      SELECT id, name, content, metadata->>'category' as category
      FROM content_library
      WHERE type = 'objection'
        AND is_active = true
        AND metadata->>'category' = ${bestCategory}
        AND (user_id = ${userId} OR user_id IS NULL)
      ORDER BY usage_count DESC
      LIMIT 5
    `);

    res.json({
      detectedCategory: bestCategory,
      confidence: Math.min(bestScore * 25, 100),
      suggestions: result.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        content: row.content,
        category: row.category,
      })),
    });
  } catch (error) {
    console.error('Error analyzing objection:', error);
    res.status(500).json({ error: 'Failed to analyze objection' });
  }
});

export default router;
