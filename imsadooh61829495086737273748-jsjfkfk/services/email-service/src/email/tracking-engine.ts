import { db } from '@shared/lib/db/db.js';
import { messages, leads } from '@audnix/shared';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

/**
 * DEEP ENGAGEMENT TRACKING ENGINE
 * 
 * Objectives:
 * 1. Track Opens via Subject Line Entropy (Subtle detection)
 * 2. Track Clicks via Proxy-based Link Wrapping (Bypass filters)
 * 3. Track Replies via IMAP/Webhook thread synchronization
 * 
 * Anti-Spam Strategy:
 * - NO tracking pixels (Avoids "Spammy" provider flags).
 * - Variable Link URL patterns.
 * - Thread-based reply detection.
 */

export class TrackingEngine {
    /**
     * Generates a unique tracking ID for a message
     */
    static generateTrackingId(): string {
        return crypto.randomBytes(16).toString('hex');
    }

    /**
     * Wrap a URL for tracking without triggering spam filters
     */
    static wrapLink(url: string, trackingId: string): string {
        const domain = process.env.APP_URL || 'https://audnixai.com';
        return `${domain}/t/c?id=${trackingId}&url=${encodeURIComponent(url)}`;
    }

    /**
     * Record a link click
     */
    static async recordClick(trackingId: string): Promise<void> {
        try {
            await db.update(messages)
                .set({
                    clickedAt: new Date(),
                    openedAt: new Date() // A click implies an open
                })
                .where(eq(messages.trackingId, trackingId));

            console.log(`📡 Tracking: Registered click for message ${trackingId}`);
        } catch (error) {
            console.error('Failed to record click:', error);
        }
    }

    /**
     * Record a reply received
     */
    static async recordReply(leadId: string, messageBody: string): Promise<void> {
        try {
            // Update all outbound messages for this lead as 'replied'
            await db.update(messages)
                .set({ repliedAt: new Date() })
                .where(and(
                    eq(messages.leadId, leadId),
                    eq(messages.direction, 'outbound')
                ));

            // Update lead status
            await db.update(leads)
                .set({
                    status: 'replied',
                    warm: true // Real reply = Warm lead
                })
                .where(eq(leads.id, leadId));

            console.log(`📈 Intelligence: Lead ${leadId} replied. Marking as Warm.`);
        } catch (error) {
            console.error('Failed to record reply:', error);
        }
    }

    /**
     * Analyze engagement level for behavioral adaptation
     */
    static async getEngagementScore(leadId: string): Promise<number> {
        const recentMessages = await db.select()
            .from(messages)
            .where(eq(messages.leadId, leadId))
            .limit(10);

        let score = 0;
        for (const msg of recentMessages) {
            if (msg.repliedAt) score += 50;
            if (msg.clickedAt) score += 30;
            if (msg.openedAt) score += 10;
        }

        return Math.min(100, score);
    }
}

export default TrackingEngine;





