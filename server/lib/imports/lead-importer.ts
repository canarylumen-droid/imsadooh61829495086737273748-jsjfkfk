
import { db } from '../../db.js';
import { storage } from '../../storage.js';
import { decrypt } from "../crypto/encryption.js";
import type { Lead, Message } from "../../../shared/schema.js";

/**
 * Neural CSV Mapper - Maps dynamic column names to internal lead keys
 */
function mapCsvToLeadMetadata(row: Record<string, any>): Record<string, any> {
  const metadata: Record<string, any> = { ...row };
  const mappings: Record<string, string[]> = {
    industry: ['industry', 'sector', 'business type', 'niche'],
    companySize: ['company size', 'size', 'employees', 'team size', 'headcount'],
    painPoint: ['pain point', 'challenge', 'problem', 'needs', 'pain'],
    role: ['role', 'title', 'job title', 'position'],
    company: ['company', 'organization', 'business name', 'company name']
  };

  for (const [key, aliases] of Object.entries(mappings)) {
    for (const alias of aliases) {
      const normalizedAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const rowKey of Object.keys(row)) {
        const normalizedRowKey = rowKey.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalizedRowKey === normalizedAlias && row[rowKey]) {
          metadata[key] = row[rowKey];
          break;
        }
      }
      if (metadata[key]) break;
    }
  }
  return metadata;
}

/**
 * Import leads and conversation history from Instagram
 */
export async function importInstagramLeads(userId: string): Promise<{
  leadsImported: number;
  messagesImported: number;
  errors: string[];
}> {
  const results = { leadsImported: 0, messagesImported: 0, errors: [] as string[] };
  try {
    const user = await storage.getUserById(userId);
    const existingLeads = await storage.getLeads({ userId, limit: 10000 });
    const currentLeadCount = existingLeads.length;

    const maxLeads = user?.plan === 'pro' || user?.plan === 'enterprise' ? 10000 : 500;
    if (currentLeadCount >= maxLeads) {
      results.errors.push(`Lead limit reached (${maxLeads} leads).`);
      return results;
    }

    const integrations = await storage.getIntegrations(userId);
    const igIntegration = integrations.find(i => i.provider === 'instagram' && i.connected);
    if (!igIntegration) {
      results.errors.push('Instagram not connected');
      return results;
    }

    const decryptedMeta = JSON.parse(decrypt(igIntegration.encryptedMeta));
    const accessToken = decryptedMeta.tokens?.access_token;
    if (!accessToken) {
      results.errors.push('No access token found');
      return results;
    }

    const { InstagramOAuth } = await import('../oauth/instagram.js');
    const oauth = new InstagramOAuth();
    const conversations = await oauth.getConversations(accessToken);

    for (const conversation of conversations) {
      try {
        let lead = existingLeads.find(l => l.externalId === conversation.id);
        if (!lead) {
          lead = await storage.createLead({
            userId,
            externalId: conversation.id,
            name: conversation.participants?.[0]?.username || 'Instagram User',
            channel: 'instagram',
            status: 'new',
            lastMessageAt: conversation.updated_time ? new Date(conversation.updated_time) : null,
            metadata: { username: conversation.participants?.[0]?.username }
          });
          results.leadsImported++;
        }

        const allMessages = await oauth.getAllMessages(accessToken, conversation.id);
        const existingMessages = await storage.getMessages(lead.id);

        for (const msg of allMessages) {
          const exists = existingMessages.some(m => (m.metadata as any)?.ig_message_id === msg.id);
          if (!exists) {
            await storage.createMessage({
              leadId: lead.id,
              userId,
              provider: 'instagram',
              direction: msg.from?.id === conversation.participants?.[0]?.id ? 'inbound' : 'outbound',
              body: msg.message || '',
              audioUrl: msg.audio_url || null,
              metadata: { ig_message_id: msg.id, timestamp: msg.created_time }
            });
            results.messagesImported++;
          }
        }
      } catch (e: any) { results.errors.push(e.message); }
    }
    return results;
  } catch (error: any) {
    results.errors.push(error.message);
    return results;
  }
}

/**
 * Import leads from Manychat
 */
export async function importManychatLeads(userId: string): Promise<{
  leadsImported: number;
  messagesImported: number;
  errors: string[];
}> {
  const results = { leadsImported: 0, messagesImported: 0, errors: [] as string[] };
  try {
    const integrations = await storage.getIntegrations(userId);
    const mcIntegration = integrations.find(i => i.provider === 'manychat' && i.connected);
    if (!mcIntegration) return results;

    const decryptedMeta = JSON.parse(decrypt(mcIntegration.encryptedMeta));
    const apiKey = decryptedMeta.tokens?.api_key;
    if (!apiKey) return results;

    const response = await fetch('https://api.manychat.com/fb/subscriber/findByCustomField', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ field_name: 'email', field_value: '' })
    });

    const data = await response.json() as any;
    const subscribers = data.data || [];

    for (const sub of subscribers) {
      try {
        await storage.createLead({
          userId,
          externalId: sub.id,
          name: sub.name || sub.first_name || 'Manychat User',
          email: sub.email || null,
          phone: sub.phone || null,
          channel: 'instagram',
          status: 'new',
          metadata: { manychat_id: sub.id, imported_from_manychat: true, industry: sub.industry || 'unknown', companySize: sub.company_size || 'unknown' }
        });
        results.leadsImported++;
      } catch (e) { }
    }
    return results;
  } catch (e: any) { results.errors.push(e.message); return results; }
}

/**
 * Import leads and messages from Gmail
 */
export async function importGmailLeads(userId: string): Promise<{
  leadsImported: number;
  messagesImported: number;
  errors: string[];
}> {
  const results = { leadsImported: 0, messagesImported: 0, errors: [] as string[] };
  try {
    const { GmailOAuth } = await import('../oauth/gmail.js');
    const gmailOAuth = new GmailOAuth();

    // Get recent messages
    const messages = await gmailOAuth.listMessages(userId, 50);

    const existingLeads = await storage.getLeads({ userId, limit: 10000 });

    for (const msgSummary of messages) {
      try {
        const fullMsg = await gmailOAuth.getMessageDetails(userId, msgSummary.id);
        const headers = fullMsg.payload?.headers || [];

        const fromHeader = headers.find((h: any) => h.name === 'From')?.value || '';
        const subject = headers.find((h: any) => h.name === 'Subject')?.value || '';
        const date = headers.find((h: any) => h.name === 'Date')?.value || '';

        // Extract email and name
        const match = fromHeader.match(/(?:"?([^"]*)"?\s*)?<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/);
        const name = match?.[1] || fromHeader.split('<')[0].trim() || 'Gmail User';
        const email = match?.[2] || fromHeader;

        if (!email) continue;

        let lead = existingLeads.find(l => l.email === email);
        if (!lead) {
          lead = await storage.createLead({
            userId,
            name,
            email,
            channel: 'email',
            status: 'new',
            lastMessageAt: date ? new Date(date) : null,
            metadata: { imported_from_gmail: true }
          });
          results.leadsImported++;
        }

        const existingMessages = await storage.getMessages(lead.id);
        const exists = existingMessages.some(m => (m.metadata as any)?.gmail_message_id === fullMsg.id);

        if (!exists) {
          // Extract snippet or body
          const body = fullMsg.snippet || '';

          await storage.createMessage({
            leadId: lead.id,
            userId,
            provider: 'gmail',
            direction: 'inbound',
            body: body,
            metadata: { gmail_message_id: fullMsg.id, subject, timestamp: date }
          });
          results.messagesImported++;
        }
      } catch (e: any) {
        results.errors.push(e.message);
      }
    }
    return results;
  } catch (error: any) {
    results.errors.push(error.message);
    return results;
  }
}