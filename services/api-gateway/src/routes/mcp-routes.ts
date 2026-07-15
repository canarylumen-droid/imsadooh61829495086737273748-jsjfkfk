import { Router, Request, Response } from 'express';
import { requireAuth, getCurrentUserId } from '../middleware/auth.js';
import { db } from '@shared/lib/db/db.js';
import { sql } from 'drizzle-orm';
import crypto from 'crypto';

const router = Router();

const MCP_TOOLS: Record<string, { description: string; neededScope?: string; blocked?: boolean }> = {
  get_campaigns: { description: 'List campaigns and performance' },
  get_leads: { description: 'Query leads by status, date, category' },
  get_analytics: { description: 'Dashboard analytics data' },
  get_inbox: { description: 'Read inbox messages' },
  send_message: { description: 'Send outreach messages', neededScope: 'send_message' },
  manage_webhooks: { description: 'Create & manage webhooks', neededScope: 'manage_webhooks' },
  delete_lead: { description: 'Delete a lead permanently', neededScope: 'dangerous' },
  delete_account: { description: 'Delete user account', blocked: true },
};

function getMaskedKey(keyHash: string): string {
  return `audnix_${keyHash.substring(0, 6)}...${keyHash.substring(keyHash.length - 4)}`;
}

async function validateApiKey(rawKey: string): Promise<{ valid: boolean; userId?: string; apiKeyId?: string; scopes?: string[]; permissionLevel?: string; error?: string }> {
  if (!rawKey.startsWith('audnix_')) {
    return { valid: false, error: 'Invalid API key format. Key must start with audnix_' };
  }
  const hashedKey = crypto.createHash('sha256').update(rawKey).digest('hex');
  const result = await db.execute(sql`
    SELECT id, user_id, permission_level, scopes, is_active, scope FROM api_keys WHERE key = ${hashedKey}
  `);
  if (result.rows.length === 0) {
    return { valid: false, error: 'API key not found' };
  }
  const row = result.rows[0] as any;
  if (!row.is_active) {
    return { valid: false, error: 'API key is deactivated' };
  }
  let toolScopes: string[] = [];
  if (row.scopes) {
    try {
      toolScopes = typeof row.scopes === 'string' ? JSON.parse(row.scopes) : row.scopes;
    } catch { toolScopes = []; }
  }
  const permissionLevel = row.permission_level || row.scope || 'read_write';
  await db.execute(sql`UPDATE api_keys SET last_used_at = NOW() WHERE id = ${row.id}`);
  return { valid: true, userId: row.user_id, apiKeyId: row.id, scopes: toolScopes, permissionLevel };
}

function mcpError(code: number, message: string): any {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

async function runTool(toolName: string, args: any, userId: string, permissionLevel: string, toolScopes: string[]): Promise<any> {
  const tool = MCP_TOOLS[toolName];
  if (!tool) return mcpError(404, `Unknown tool: ${toolName}`);
  if (tool.blocked) return mcpError(403, `Tool "${toolName}" is blocked for API key access. Use the dashboard instead.`);
  if (tool.neededScope === 'dangerous' && !toolScopes.includes('dangerous')) {
    return mcpError(403, `Tool "${toolName}" requires the 'dangerous' scope. Update your API key permissions in settings.`);
  }
  if (tool.neededScope && permissionLevel !== 'read_write' && !toolScopes.includes(tool.neededScope)) {
    return mcpError(403, `Tool "${toolName}" requires read_write permission or the '${tool.neededScope}' scope.`);
  }
  switch (toolName) {
    case 'get_campaigns': {
      const result = await db.execute(sql`SELECT id, name, status, created_at FROM outreach_campaigns WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 50`);
      return { content: [{ type: 'text', text: JSON.stringify(result.rows) }] };
    }
    case 'get_leads': {
      const result = await db.execute(sql`SELECT id, email, name, status, created_at FROM leads WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 100`);
      return { content: [{ type: 'text', text: JSON.stringify(result.rows) }] };
    }
    case 'get_analytics': {
      const campaigns = await db.execute(sql`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active FROM outreach_campaigns WHERE user_id = ${userId}`);
      const leads = await db.execute(sql`SELECT COUNT(*) as total FROM leads WHERE user_id = ${userId}`);
      return { content: [{ type: 'text', text: JSON.stringify({ campaigns: campaigns.rows[0], leads: leads.rows[0] }) }] };
    }
    case 'get_inbox': {
      const result = await db.execute(sql`SELECT id, from_addr, subject, snippet, date FROM messages WHERE user_id = ${userId} ORDER BY date DESC LIMIT 50`);
      return { content: [{ type: 'text', text: JSON.stringify(result.rows) }] };
    }
    case 'send_message': {
      if (!args.to || !args.subject || !args.body) {
        return mcpError(400, 'send_message requires: to, subject, body');
      }
      const { sendEmail } = await import('@shared/lib/channels/email.js');
      await sendEmail(userId, args.to, args.body, args.subject);
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: 'Message sent' }) }] };
    }
    case 'manage_webhooks': {
      if (args.action === 'list') {
        const result = await db.execute(sql`SELECT id, url, events, is_active FROM webhooks WHERE user_id = ${userId}`);
        return { content: [{ type: 'text', text: JSON.stringify(result.rows) }] };
      }
      if (args.action === 'create') {
        if (!args.url || !args.events) return mcpError(400, 'manage_webhooks create requires: url, events');
        await db.execute(sql`INSERT INTO webhooks (user_id, url, events, is_active) VALUES (${userId}, ${args.url}, ${JSON.stringify(args.events)}, true)`);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      }
      return mcpError(400, 'manage_webhooks action must be "list" or "create"');
    }
    case 'delete_lead': {
      if (!args.leadId) return mcpError(400, 'delete_lead requires: leadId');
      if (!toolScopes.includes('dangerous')) return mcpError(403, 'delete_lead requires the dangerous scope');
      await db.execute(sql`DELETE FROM leads WHERE id = ${args.leadId} AND user_id = ${userId}`);
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: 'Lead deleted' }) }] };
    }
    default:
      return mcpError(404, `Unknown tool: ${toolName}`);
  }
}

async function logMcpCall(userId: string, apiKeyId: string | null, toolName: string, input: any, success: boolean, error: string | null) {
  try {
    await db.execute(sql`
      INSERT INTO mcp_logs (user_id, api_key_id, tool_name, input, success, error)
      VALUES (${userId}, ${apiKeyId}, ${toolName}, ${JSON.stringify(input || {})}, ${success}, ${error})
    `);
  } catch (e) {
    console.error('[MCP] Failed to log MCP call:', e);
  }
}

// POST /mcp — Main MCP endpoint
router.post('/mcp', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header. Use: Bearer audnix_<your_key>' });
      return;
    }
    const rawKey = authHeader.slice(7).trim();
    const validation = await validateApiKey(rawKey);
    if (!validation.valid) {
      res.status(401).json({ error: validation.error });
      return;
    }

    const { tool, args } = req.body;
    if (!tool) {
      res.status(400).json({ error: 'Missing "tool" in request body' });
      return;
    }

    const result = await runTool(tool, args || {}, validation.userId!, validation.permissionLevel!, validation.scopes || []);
    const success = !result.isError;
    await logMcpCall(validation.userId!, validation.apiKeyId!, tool, args || {}, success, result.isError ? result.content[0]?.text : null);

    res.json({
      jsonrpc: '2.0',
      id: req.body.id || 1,
      result,
    });
  } catch (error: any) {
    console.error('[MCP] Error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// GET /api/mcp/tools — List all available MCP tools
router.get('/api/mcp/tools', async (_req: Request, res: Response): Promise<void> => {
  const tools = Object.entries(MCP_TOOLS).map(([name, config]) => ({
    name,
    description: config.description,
    blocked: config.blocked || false,
    needsScope: config.neededScope || null,
  }));
  res.json({ tools });
});

// POST /api/mcp/key/create — Create a new API key
router.post('/api/mcp/key/create', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const { name, permission_level } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Key name is required' });
      return;
    }

    const level = permission_level === 'read' ? 'read_only' : 'read_write';
    const rawKey = `audnix_${crypto.randomBytes(32).toString('hex')}`;
    const hashedKey = crypto.createHash('sha256').update(rawKey).digest('hex');

    await db.execute(sql`
      INSERT INTO api_keys (user_id, name, key, permission_level, scope, scopes, is_active)
      VALUES (${userId}, ${name.trim()}, ${hashedKey}, ${level}, ${level}, '[]'::jsonb, true)
    `);

    const result = await db.execute(sql`
      SELECT id, created_at FROM api_keys WHERE key = ${hashedKey}
    `);
    const created = result.rows[0] as any;

    res.status(201).json({
      id: created.id,
      name: name.trim(),
      permissionLevel: level,
      key: rawKey,
      createdAt: created.created_at?.toISOString() || null,
      message: 'Make sure to copy your API key now. You won\'t be able to see it again.',
    });
  } catch (error) {
    console.error('[MCP] Error creating key:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// POST /api/mcp/key/regenerate — Rotate an API key
router.post('/api/mcp/key/regenerate', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const { id } = req.body;
    if (!id) { res.status(400).json({ error: 'Key ID is required' }); return; }

    const rawKey = `audnix_${crypto.randomBytes(32).toString('hex')}`;
    const hashedKey = crypto.createHash('sha256').update(rawKey).digest('hex');

    await db.execute(sql`
      UPDATE api_keys SET key = ${hashedKey}, last_used_at = NULL WHERE id = ${id} AND user_id = ${userId}
    `);

    res.json({ key: rawKey, message: 'Key rotated. Update any services using the old key.' });
  } catch (error) {
    console.error('[MCP] Error regenerating key:', error);
    res.status(500).json({ error: 'Failed to regenerate key' });
  }
});

// POST /api/mcp/scopes — Update tool permissions for a key
router.post('/api/mcp/scopes', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const { id, scopes, permission_level } = req.body;
    if (!id) { res.status(400).json({ error: 'Key ID is required' }); return; }

    const level = permission_level === 'read' ? 'read_only' : 'read_write';

    await db.execute(sql`
      UPDATE api_keys
      SET scopes = ${JSON.stringify(scopes || [])}::jsonb, permission_level = ${level}, scope = ${level}
      WHERE id = ${id} AND user_id = ${userId}
    `);

    res.json({ success: true, message: 'Permissions updated.' });
  } catch (error) {
    console.error('[MCP] Error updating scopes:', error);
    res.status(500).json({ error: 'Failed to update permissions' });
  }
});

// GET /api/mcp/key/current — Get current user's active key info
router.get('/api/mcp/key/current', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const result = await db.execute(sql`
      SELECT id, name, permission_level, scopes, is_active, created_at, last_used_at
      FROM api_keys
      WHERE user_id = ${userId} AND is_active = true
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      res.json({ key: null });
      return;
    }

    const row = result.rows[0] as any;
    let parsedScopes: string[] = [];
    if (row.scopes) {
      try { parsedScopes = typeof row.scopes === 'string' ? JSON.parse(row.scopes) : row.scopes; } catch { parsedScopes = []; }
    }

    res.json({
      key: {
        id: row.id,
        name: row.name,
        permissionLevel: row.permission_level || 'read_write',
        scopes: parsedScopes,
        isActive: row.is_active,
        createdAt: row.created_at?.toISOString() || null,
        lastUsedAt: row.last_used_at?.toISOString() || null,
      }
    });
  } catch (error) {
    console.error('[MCP] Error fetching current key:', error);
    res.status(500).json({ error: 'Failed to fetch key info' });
  }
});

// POST /api/mcp/test — Test an MCP tool call and return live result
router.post('/api/mcp/test', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const result = await db.execute(sql`
      SELECT id, permission_level, scopes FROM api_keys WHERE user_id = ${userId} AND is_active = true ORDER BY created_at DESC LIMIT 1
    `);
    if (result.rows.length === 0) {
      res.status(400).json({ error: 'No active API key found. Create one first.' });
      return;
    }
    const row = result.rows[0] as any;
    let parsedScopes: string[] = [];
    if (row.scopes) {
      try { parsedScopes = typeof row.scopes === 'string' ? JSON.parse(row.scopes) : row.scopes; } catch { parsedScopes = []; }
    }

    const { tool, args } = req.body;
    if (!tool) { res.status(400).json({ error: 'Missing tool name' }); return; }

    const toolResult = await runTool(tool, args || {}, userId, row.permission_level || 'read_write', parsedScopes);
    const success = !toolResult.isError;
    await logMcpCall(userId, row.id, tool, args || {}, success, toolResult.isError ? toolResult.content[0]?.text : null);

    res.json({
      success,
      tool,
      result: toolResult.content?.[0]?.text ? JSON.parse(toolResult.content[0].text) : toolResult,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[MCP] Test error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
