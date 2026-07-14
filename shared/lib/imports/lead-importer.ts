import { db } from '@shared/lib/db/db.js';
import { storage } from '@shared/lib/storage/storage.js';
import { decrypt } from '@shared/lib/crypto/encryption.js';
import type { Lead, Message } from "@audnix/shared";
import { EmailVerifier } from "../scraping/email-verifier.js";
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { getUserLeadsLimit } from '@shared/plan-utils.js';

const verifier = new EmailVerifier();

/**
 * Neural CSV Mapper - Maps dynamic column names to internal lead keys
 * Enhanced to extract website, city, country, niche, review, google_maps_url,
 * business_name, phone country code, and more.
 */
export function mapCsvToLeadMetadata(row: Record<string, any>): Record<string, any> {
  const metadata: Record<string, any> = { ...row };
  const mappings: Record<string, string[]> = {
    industry: ['industry', 'sector', 'business type', 'niche'],
    companySize: ['company size', 'size', 'employees', 'team size', 'headcount'],
    painPoint: ['pain point', 'challenge', 'problem', 'needs', 'pain'],
    role: ['role', 'title', 'job title', 'position'],
    company: ['company', 'organization', 'business name', 'company name'],
    website: ['website', 'site', 'url', 'web', 'domain', 'business website'],
    city: ['city', 'town', 'location city', 'locality'],
    country: ['country', 'nation', 'region country'],
    review: ['review', 'rating', 'testimonial', 'feedback', 'review text'],
    googleMapsUrl: ['google maps', 'maps url', 'gmap', 'google maps url', 'maps link'],
    businessName: ['business name', 'business', 'store name', 'brand name', 'shop name'],
    countryCode: ['country code', 'phone code', 'dial code', 'country dial'],
    niche: ['niche', 'specialty', 'specialization', 'vertical'],
    bio: ['bio', 'about', 'description', 'summary', 'biography'],
    revenue: ['revenue', 'annual revenue', 'sales volume', 'turnover', 'income'],
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

  // Auto-detect phone country code from phone if not explicitly provided
  if (row.phone && !metadata.countryCode) {
    const phone = String(row.phone).replace(/[\s\-\(\)]/g, '');
    if (phone.startsWith('+1')) metadata.countryCode = '+1';
    else if (phone.startsWith('+44')) metadata.countryCode = '+44';
    else if (phone.startsWith('+234')) metadata.countryCode = '+234';
    else if (phone.startsWith('+91')) metadata.countryCode = '+91';
    else if (phone.startsWith('+61')) metadata.countryCode = '+61';
    else if (phone.startsWith('+86')) metadata.countryCode = '+86';
    else if (phone.startsWith('+49')) metadata.countryCode = '+49';
    else if (phone.startsWith('+33')) metadata.countryCode = '+33';
    else if (phone.startsWith('+81')) metadata.countryCode = '+81';
    else if (phone.startsWith('+55')) metadata.countryCode = '+55';
    else if (phone.startsWith('+7')) metadata.countryCode = '+7';
    else if (phone.startsWith('+52')) metadata.countryCode = '+52';
    else if (phone.startsWith('+971')) metadata.countryCode = '+971';
    else if (phone.startsWith('+966')) metadata.countryCode = '+966';
    else if (phone.startsWith('+82')) metadata.countryCode = '+82';
    else if (phone.startsWith('+39')) metadata.countryCode = '+39';
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
    const currentLeadCount = await storage.getLeadsCount(userId);
    const limit = user?.email === 'team.replyflow@gmail.com' ? 500000 : getUserLeadsLimit(user);

    if (currentLeadCount >= limit) {
      results.errors.push(`Lead limit reached (${limit} leads).`);
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

    const { InstagramOAuth } = await import('@services/api-gateway/src/oauth/instagram.js');
    const oauth = new InstagramOAuth();
    const conversations = await oauth.getConversations(accessToken);

    const existingLeads = await storage.getLeads({ userId, limit: 100000 });

    for (const conversation of conversations) {
      try {
        let lead = existingLeads.find((l: any) => l.externalId === conversation.id);
        if (!lead) {
          lead = await storage.createLead({
            userId,
            externalId: conversation.id,
            name: conversation.participants?.[0]?.username || 'Instagram User',
            channel: 'instagram',
            status: 'new',
            lastMessageAt: conversation.updated_time ? new Date(conversation.updated_time) : null,
            metadata: { username: conversation.participants?.[0]?.username }
          }, { suppressNotification: true });
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
    const user = await storage.getUserById(userId);
    const existingLeadsCount = await storage.getLeadsCount(userId);
    const limit = user?.email === 'team.replyflow@gmail.com' ? 500000 : getUserLeadsLimit(user);

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

    // Pre-extract emails for duplicate check
    const mcEmails = subscribers.map((s: any) => s.email).filter((e: any): e is string => !!e);
    const existingEmails = await storage.getExistingEmails(userId, mcEmails);
    const existingEmailSet = new Set(existingEmails);

    for (const sub of subscribers) {
      try {
        if (results.leadsImported + existingLeadsCount >= limit) break;

        // Duplicate check
        if (sub.email && existingEmailSet.has(sub.email)) continue;

        // Bouncer check
        let verified = false;
        let isBouncy = false;
        let isCatchAll = false;
        let isFreeProvider = false;
        
        if (sub.email) {
          const vResult = await verifier.verify(sub.email);
          verified = vResult.valid;
          isBouncy = !vResult.valid && vResult.reason.includes('rejected');
          isCatchAll = (vResult as any).isCatchAll || false;
          isFreeProvider = (vResult as any).isFreeProvider || false;
        }

        await storage.createLead({
          userId,
          externalId: sub.id,

          name: sub.name || sub.first_name || 'Manychat User',
          email: sub.email || null,
          phone: sub.phone || null,
          channel: 'instagram',
          status: isBouncy ? 'bouncy' : (isCatchAll ? 'risky' : 'new'),
          verified,
          metadata: { 
            manychat_id: sub.id, 
            imported_from_manychat: true, 
            industry: sub.industry || 'unknown', 
            companySize: sub.company_size || 'unknown',
            bouncer_verification: verified ? 'pass' : 'fail',
            isCatchAll,
            isFreeProvider
          }
        }, { suppressNotification: true });
        results.leadsImported++;
      } catch (e) { console.warn('[LeadImporter] Failed to create lead from ManyChat:', (e as Error)?.message); }
    }
    wsSync.notifyActivityUpdated(userId, { type: 'import_completed', count: results.leadsImported });
    wsSync.broadcastToUser(userId, { type: 'stats_updated', payload: { source: 'manychat_importer' } });
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
    const user = await storage.getUserById(userId);
    const existingLeadsCount = await storage.getLeadsCount(userId);
    const limit = user?.email === 'team.replyflow@gmail.com' ? 500000 : getUserLeadsLimit(user);

    const { GmailOAuth } = await import('@services/api-gateway/src/oauth/gmail.js');
    const gmailOAuth = new GmailOAuth();

    // Get recent messages
    const messages = await gmailOAuth.listMessages(userId, 50);

    for (const msgSummary of messages) {
      try {
        if (results.leadsImported + existingLeadsCount >= limit) break;

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

        // Duplicate check
        let lead = await storage.getLeadByEmail(email, userId);
        if (!lead) {
          // Bouncer check
          const vResult = await verifier.verify(email);
          const isBouncy = !vResult.valid && vResult.reason.includes('rejected');
          const isCatchAll = (vResult as any).isCatchAll || false;
          const isFreeProvider = (vResult as any).isFreeProvider || false;

          lead = await storage.createLead({
            userId,
            name,
            email,
            channel: 'email',
            status: isBouncy ? 'bouncy' : (isCatchAll ? 'risky' : 'new'),
            verified: vResult.valid,
            lastMessageAt: date ? new Date(date) : null,
            metadata: { 
              imported_from_gmail: true,
              bouncer_verification: vResult.valid ? 'pass' : 'fail',
              isCatchAll,
              isFreeProvider
            }
          }, { suppressNotification: true });
          results.leadsImported++;
        }

        const existingMessages = await storage.getMessages(lead.id);
        const exists = existingMessages.some(m => (m.metadata as any)?.gmail_message_id === fullMsg.id);

        if (!exists) {
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






