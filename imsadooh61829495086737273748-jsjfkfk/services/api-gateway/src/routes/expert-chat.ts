import { Router, Request, Response } from 'express';
import { generateReply } from '@services/brain-worker/src/ai-lib/core/ai-service.js';
import { MODELS } from "@services/brain-worker/src/ai-lib/utils/model-config.js";

const router = Router();

// Audnix Knowledge Base
const AUDNIX_KNOWLEDGE = `
You are the Audnix Support Assistant. You provide helpful, clear, and professional guidance for the Audnix sales platform.

IDENTITY & VOICE:
- Tone: Professional, helpful, and standard SaaS support style.
- Language: Plain English. Avoid overly technical jargon or "AI-driven" metaphors unless necessary.
- Style: Direct and insight-driven.

DEEP KNOWLEDGE:
1. Sales Engine: Automates email and Instagram outreach.
2. Warmup: Safely ramps up email accounts.
3. Leads: Supports CSV/PDF uploads with automated verification.
4. Voice: ElevenLabs integration for personalized messages.

Your goal is to ensure the user gets their questions answered clearly and efficiently.
`;

// Alias for v2 endpoint to prevent 404s
router.post(['/chat', '/chat-v2'], async (req: Request, res: Response) => {
    let isAuthenticated = false;
    try {
        if (!req.body) {
            return res.json({ content: "Protocol error: Empty communication packet. Please retry." });
        }

        const { message, history = [] } = req.body;
        isAuthenticated = req.body.isAuthenticated === true;

        if (!message) {
            return res.status(400).json({ error: 'Message payload required' });
        }

        // Logic for the first user message (after the initial system welcome)
        // If history is just the initial AI welcome message (length 1)
        const isFirstUserMessage = history.length <= 1;
        const greetingWords = ['hi', 'hello', 'hey', 'greetings', 'yo', 'hi there'];
        const isGreeting = greetingWords.some(word => message.toLowerCase().trim().startsWith(word));

        if (isFirstUserMessage && isGreeting) {
            return res.json({
                content: "Hello! I'm your Audnix Support Assistant. I can help you set up your outreach, manage leads, or troubleshoot your settings. How can I help you today?"
            });
        }

        const responseResult = await generateReply(
            AUDNIX_KNOWLEDGE,
            message,
            {
                model: MODELS.sales_reasoning,
                history: history.map((m: any) => ({
                    role: m.role === 'user' ? 'user' : 'assistant',
                    content: m.content
                })),
                temperature: 0.7
            }
        );
        
        const content = responseResult.text || "AI processing interrupted. Please re-send your inquiry.";

        res.json({ content });
    } catch (error: any) {
        console.error('Expert Chat Error:', error);

        // Specific error handling for more helpful fallbacks
        let errorContent = "I'm having a bit of trouble connecting right now. Please try again in a moment.";

        if (error?.message?.includes('429')) {
            errorContent = "I'm receiving too many requests at once. Please wait a few seconds and try again.";
        } else if (error?.message?.includes('Safety') || error?.message?.includes('HARM_CATEGORY')) {
            errorContent = "I can't answer that specific question due to safety filters. Is there something else I can help with?";
        }

        res.json({ content: errorContent });
    }
});

export default router;

