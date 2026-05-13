/**
 * LINK INTENT DETECTOR
 * 
 * Detects when leads want:
 * - To book a meeting/call → Auto-send meeting link
 * - To pay/purchase → Auto-send payment link
 * - To try the product → Auto-send app/signup link
 */

import { getBrandContext, type BrandContext } from '../context/brand-context.js';
import { isValidURL } from '@shared/lib/utils/validation.js';

export interface LinkIntentResult {
  detected: boolean;
  intentType: 'meeting' | 'payment' | 'app' | 'none';
  confidence: number;
  link: string | null;
  suggestedResponse: string | null;
}

const MEETING_KEYWORDS = [
  'book', 'call', 'schedule', 'meeting', 'demo', 'chat', 'talk',
  'calendly', 'zoom', 'discuss', 'appointment', 'slot', 'time',
  'when can we', 'lets hop on', 'quick call', 'free to chat',
  'available for', 'consultation', 'discovery', 'strategy call',
  '15 min', '30 min', 'let\'s connect', 'reach out', 'speak',
  'sync up', 'book sync', 'get on a call', 'calendar', 'google meet'
];

const PAYMENT_KEYWORDS = [
  'pay', 'purchase', 'buy', 'subscribe', 'checkout', 'invoice',
  'payment', 'credit card', 'card details', 'billing', 'price',
  'pricing', 'cost', 'how much', 'get started', 'sign up now',
  'ready to', 'let\'s do it', 'proceed', 'confirm', 'bank',
  'transfer', 'wire', 'paypal', 'stripe', 'send invoice'
];

const APP_KEYWORDS = [
  'try', 'trial', 'demo', 'test', 'signup', 'sign up', 'register',
  'account', 'access', 'login', 'download', 'app', 'platform',
  'start using', 'get access', 'free trial', 'how do I start',
  'where do I', 'link to', 'show me', 'can I see'
];

/**
 * Detect if lead message indicates intent for a link
 */
export function detectLinkIntent(
  message: string,
  brand: BrandContext
): LinkIntentResult {
  const lowerMessage = message.toLowerCase();
  
  // Count keyword matches for each type
  const meetingScore = MEETING_KEYWORDS.filter(kw => lowerMessage.includes(kw)).length;
  const paymentScore = PAYMENT_KEYWORDS.filter(kw => lowerMessage.includes(kw)).length;
  const appScore = APP_KEYWORDS.filter(kw => lowerMessage.includes(kw)).length;
  
  // Determine dominant intent
  const maxScore = Math.max(meetingScore, paymentScore, appScore);
  
  if (maxScore === 0) {
    return {
      detected: false,
      intentType: 'none',
      confidence: 0,
      link: null,
      suggestedResponse: null
    };
  }
  
  const confidence = Math.min(maxScore * 0.25, 1); // Cap at 1.0
  
  // Meeting intent - validate link before using
  if (meetingScore >= paymentScore && meetingScore >= appScore) {
    const link = brand.meetingLink?.trim();
    if (isValidURL(link)) {
      return {
        detected: true,
        intentType: 'meeting',
        confidence,
        link: link || null,
        suggestedResponse: generateMeetingResponse(brand)
      };
    }
  }
  
  // Payment intent - validate link before using
  if (paymentScore > meetingScore && paymentScore >= appScore) {
    const link = brand.paymentLink?.trim();
    if (isValidURL(link)) {
      return {
        detected: true,
        intentType: 'payment',
        confidence,
        link: link || null,
        suggestedResponse: generatePaymentResponse(brand)
      };
    }
  }
  
  // App/trial intent - validate link before using
  if (appScore > meetingScore && appScore > paymentScore) {
    const link = brand.appLink?.trim();
    if (isValidURL(link)) {
      return {
        detected: true,
        intentType: 'app',
        confidence,
        link: link || null,
        suggestedResponse: generateAppResponse(brand)
      };
    }
  }
  
  return {
    detected: false,
    intentType: 'none',
    confidence: 0,
    link: null,
    suggestedResponse: null
  };
}

/**
 * Generate meeting booking response
 */
function generateMeetingResponse(brand: BrandContext): string {
  const responses = [
    `Execellent. I've actually got some time to sync up soon. You can book our sync now here: ${brand.meetingLink}`,
    `Great, let's jump on a call. Pick a time that suits you best and let's book a sync now: ${brand.meetingLink}`,
    `I'd love to chat. Here's my calendar for you to book a sync now: ${brand.meetingLink}`,
    `Perfect. Let's lock in a time to speak. You can book a sync now right here: ${brand.meetingLink}`,
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

/**
 * Generate payment response
 */
function generatePaymentResponse(brand: BrandContext): string {
  const responses = [
    `Let's get you started! Here's where you can complete payment: ${brand.paymentLink}`,
    `Awesome! Here's the payment link: ${brand.paymentLink}`,
    `Ready to roll! Complete your order here: ${brand.paymentLink}`,
    `Here you go - complete your purchase here: ${brand.paymentLink}`,
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

/**
 * Generate app/signup response
 */
function generateAppResponse(brand: BrandContext): string {
  const responses = [
    `Here's access to ${brand.companyName}: ${brand.appLink}`,
    `Get started here: ${brand.appLink}`,
    `Here's the link to try it out: ${brand.appLink}`,
    `Jump in here and see for yourself: ${brand.appLink}`,
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

/**
 * Async function to detect intent with brand context
 */
export async function detectAndGenerateLinkResponse(
  userId: string,
  message: string
): Promise<LinkIntentResult> {
  const brand = await getBrandContext(userId);
  return detectLinkIntent(message, brand);
}

/**
 * Validate if a link is valid and usable
 */
function isValidLink(link: string | null | undefined): boolean {
  return isValidURL(link);
}

/**
 * Check if message needs a specific link and append it
 * Returns plain text URLs (no HTML) suitable for chat/DM messages
 */
export async function appendLinkIfNeeded(
  userId: string,
  leadMessage: string,
  aiResponse: string
): Promise<string> {
  const linkIntent = await detectAndGenerateLinkResponse(userId, leadMessage);
  
  // Validate link is present and valid
  if (!linkIntent.detected || !isValidLink(linkIntent.link)) {
    return aiResponse;
  }
  
  // Check if the AI response already contains a link
  const hasUrl = /https?:\/\/[^\s]+/.test(aiResponse);
  if (hasUrl) {
    return aiResponse;
  }
  
  // Ensure confidence threshold is met
  if (linkIntent.confidence < 0.25) {
    return aiResponse;
  }
  
  // Append the appropriate link as plain text (works in DMs, emails, chat)
  const linkAppendages: Record<string, string> = {
    meeting: `\n\nBook your spot here: ${linkIntent.link}`,
    payment: `\n\nComplete payment here: ${linkIntent.link}`,
    app: `\n\nGet started here: ${linkIntent.link}`,
  };
  
  const appendage = linkAppendages[linkIntent.intentType];
  if (appendage) {
    console.log(`🔗 Auto-appending ${linkIntent.intentType} link to response`);
    return aiResponse + appendage;
  }
  
  return aiResponse;
}

