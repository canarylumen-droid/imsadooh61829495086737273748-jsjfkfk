import { storage } from '@shared/lib/storage/storage.js';
import { generateReply } from "../core/ai-service.js";

export interface StyleMarkers {
    tone: 'formal' | 'casual' | 'warm' | 'blunt';
    avgSentenceLength: 'short' | 'medium' | 'long';
    commonGreetings: string[];
    commonSignoffs: string[];
    vocabularyComplexity: 'simple' | 'professional' | 'sophisticated';
    useOfEmojis: boolean;
    useOfExclamation: boolean;
}

/**
 * Learn user's writing style from past sent messages
 */
export async function learnUserStyle(userId: string): Promise<StyleMarkers | null> {
    try {
        // Fetch last 15 outbound messages sent by the user
        const allMessages = await storage.getAllMessages(userId, { limit: 50 });
        const outboundMessages = allMessages
            .filter(m => m.direction === 'outbound')
            .slice(0, 15)
            .map(m => m.body);

        if (outboundMessages.length < 3) {
            console.log(`[StyleLearner] Insufficient data for user ${userId}`);
            return null;
        }

        const sampleText = outboundMessages.join('\n---\n');
        const systemPrompt = `Analyze the following email/message samples from a user and extract their writing style markers.
Respond ONLY with a JSON object in this format:
{
    "tone": "formal" | "casual" | "warm" | "blunt",
    "avgSentenceLength": "short" | "medium" | "long",
    "commonGreetings": ["string"],
    "commonSignoffs": ["string"],
    "vocabularyComplexity": "simple" | "professional" | "sophisticated",
    "useOfEmojis": boolean,
    "useOfExclamation": boolean
}`;

        const completion = await generateReply(systemPrompt, sampleText, { jsonMode: true, temperature: 0.1 });
        const markers = JSON.parse(completion.text) as StyleMarkers;

        // Store in DB for future use
        await storage.recordLearningPattern(userId, 'style_markers', true);
        const user = await storage.getUserById(userId);
        if (user) {
            await storage.updateUser(userId, {
                metadata: {
                    ...user.metadata,
                    styleMarkers: markers
                }
            });
        }

        return markers;
    } catch (error) {
        console.error(`[StyleLearner] Error learning style for ${userId}:`, error);
        return null;
    }
}

/**
 * Retrieve style markers for a user (with fallback)
 */
export async function getStyleMarkers(userId: string): Promise<StyleMarkers> {
    const user = await storage.getUserById(userId);
    if (user?.metadata?.styleMarkers) {
        return user.metadata.styleMarkers;
    }

    // Default markers if none learned yet
    return {
        tone: 'warm',
        avgSentenceLength: 'medium',
        commonGreetings: ['Hi', 'Hello'],
        commonSignoffs: ['Best', 'Regards'],
        vocabularyComplexity: 'professional',
        useOfEmojis: false,
        useOfExclamation: false
    };
}



