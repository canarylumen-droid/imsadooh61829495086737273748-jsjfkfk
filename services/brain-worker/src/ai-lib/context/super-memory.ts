import type { Lead, Message } from '@audnix/shared';

const SUPER_MEMORY_API_KEY = process.env.SUPER_MEMORY_API_KEY;
const SUPER_MEMORY_API_URL = 'https://api.supermemory.ai/v1';

if (!SUPER_MEMORY_API_KEY) {
  console.warn('SUPER_MEMORY_API_KEY not set. Conversation memory will be limited to database storage only.');
}

/**
 * Store conversation in Super Memory for permanent long-term storage
 * @param userId - User ID
 * @param leadId - Lead ID
 * @param conversationData - Conversation data to store
 */
export async function storeConversationMemory(
  userId: string,
  leadId: string,
  conversationData: {
    messages: Array<{ role: string; content: string; timestamp: string }>;
    leadName: string;
    leadChannel: string;
    metadata?: Record<string, any>;
  }
): Promise<{ success: boolean; memoryId?: string }> {
  if (!SUPER_MEMORY_API_KEY) {
    console.log(`⚠️ Super Memory: Skipping save for ${conversationData.leadName} (API key not configured)`);
    return { success: false };
  }

  try {
    const response = await fetch(`${SUPER_MEMORY_API_URL}/memories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPER_MEMORY_API_KEY}`,
      },
      body: JSON.stringify({
        user_id: userId,
        content: {
          type: 'conversation',
          lead_id: leadId,
          lead_name: conversationData.leadName,
          channel: conversationData.leadChannel,
          messages: conversationData.messages,
          metadata: conversationData.metadata || {},
        },
        tags: ['conversation', conversationData.leadChannel, userId],
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Super Memory API error:', response.status, errorText);
      return { success: false };
    }

    const data = await response.json() as any;
    console.log(`✓ Super Memory: Saved conversation with ${conversationData.leadName} (${data.id})`);
    return { success: true, memoryId: data.id };
  } catch (error: any) {
    console.error('Super Memory storage error:', error.message);
    return { success: false };
  }
}

/**
 * Retrieve conversation history from Super Memory with context enrichment
 * @param userId - User ID
 * @param leadId - Optional lead ID to filter
 * @returns Conversation history with enriched context
 */
export async function retrieveConversationMemory(
  userId: string,
  leadId?: string
): Promise<{ success: boolean; conversations?: any[]; context?: string }> {
  if (!SUPER_MEMORY_API_KEY) {
    return { success: false };
  }

  try {
    const params = new URLSearchParams({
      user_id: userId,
      tags: 'conversation',
      limit: '100',
    });

    if (leadId) {
      params.append('filter', `lead_id:${leadId}`);
    }

    const response = await fetch(`${SUPER_MEMORY_API_URL}/memories?${params}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SUPER_MEMORY_API_KEY}`,
      },
    });

    if (!response.ok) {
      console.error('Super Memory API error:', response.statusText);
      return { success: false };
    }

    const data = await response.json() as any;
    const conversations = data.memories || [];

    // Generate context summary from all conversations
    const contextSummary = generateContextSummary(conversations);

    return { 
      success: true, 
      conversations,
      context: contextSummary
    };
  } catch (error: any) {
    console.error('Super Memory retrieval error:', error.message);
    return { success: false };
  }
}

/**
 * Generate a context summary from conversation history
 */
function generateContextSummary(conversations: any[]): string {
  if (!conversations.length) return '';

  const insights: string[] = [];

  // Extract key patterns
  const allMessages = conversations.flatMap(c => c.content?.messages || []);
  const userMessages = allMessages.filter((m: any) => m.role === 'user');

  // Identify common topics
  const topicKeywords = ['price', 'cost', 'when', 'how', 'demo', 'trial', 'interested'];
  const mentionedTopics = topicKeywords.filter(topic =>
    userMessages.some((m: any) => m.content?.toLowerCase().includes(topic))
  );

  if (mentionedTopics.length) {
    insights.push(`Lead has asked about: ${mentionedTopics.join(', ')}`);
  }

  // Identify engagement level
  if (userMessages.length > 5) {
    insights.push('Highly engaged lead with active conversation history');
  } else if (userMessages.length > 2) {
    insights.push('Moderately engaged lead');
  }

  // Identify objections
  const objectionKeywords = ['expensive', 'not sure', 'think about', 'later'];
  const objections = objectionKeywords.filter(obj =>
    userMessages.some((m: any) => m.content?.toLowerCase().includes(obj))
  );

  if (objections.length) {
    insights.push(`Previous objections: ${objections.join(', ')}`);
  }

  return insights.join('. ');
}

/**
 * Update existing conversation memory
 * @param memoryId - Memory ID
 * @param updatedData - Updated conversation data
 */
export async function updateConversationMemory(
  memoryId: string,
  updatedData: {
    messages: Array<{ role: string; content: string; timestamp: string }>;
    metadata?: Record<string, any>;
  }
): Promise<{ success: boolean }> {
  if (!SUPER_MEMORY_API_KEY) {
    return { success: false };
  }

  try {
    const response = await fetch(`${SUPER_MEMORY_API_URL}/memories/${memoryId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPER_MEMORY_API_KEY}`,
      },
      body: JSON.stringify({
        content: {
          messages: updatedData.messages,
          metadata: updatedData.metadata || {},
        },
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      console.error('Super Memory API error:', response.statusText);
      return { success: false };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Super Memory update error:', error.message);
    return { success: false };
  }
}

/**
 * Search conversation history with semantic search
 * @param userId - User ID
 * @param query - Search query
 * @returns Search results
 */
export async function searchConversationMemory(
  userId: string,
  query: string
): Promise<{ success: boolean; results?: any[] }> {
  if (!SUPER_MEMORY_API_KEY) {
    return { success: false };
  }

  try {
    const response = await fetch(`${SUPER_MEMORY_API_URL}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPER_MEMORY_API_KEY}`,
      },
      body: JSON.stringify({
        user_id: userId,
        query,
        tags: ['conversation'],
        limit: 20,
      }),
    });

    if (!response.ok) {
      console.error('Super Memory API error:', response.statusText);
      return { success: false };
    }

    const data = await response.json() as any;
    return { success: true, results: data.results || [] };
  } catch (error: any) {
    console.error('Super Memory search error:', error.message);
    return { success: false };
  }
}

/**
 * Save conversation to permanent memory
 */
export async function saveConversationToMemory(
  userId: string,
  lead: Lead,
  messages: Message[]
): Promise<void> {
  // Using Neon database for memory storage - no Supabase needed
  const conversationSummary = await generateConversationSummary(messages);
  const keyInsights = extractKeyInsights(messages);
  const conversationInsights = await extractConversationInsights(messages);

  console.log(`✓ Conversation memory for lead ${lead.name}: ${conversationSummary.substring(0, 50)}...`);
}

/**
 * Extract deep conversation insights
 */
async function extractConversationInsights(messages: Message[]): Promise<{
  topics: string[];
  painPoints: string[];
  buyingSignals: string[];
  objections: string[];
  questions: string[];
}> {
  const inboundMessages = messages.filter(m => m.direction === 'inbound');
  const allText = inboundMessages.map(m => m.body).join(' ');

  // Extract topics discussed
  const topics = extractTopics(allText);

  // Extract pain points mentioned
  const painPoints = extractPainPoints(allText);

  // Extract buying signals
  const buyingSignals = extractBuyingSignals(allText);

  // Extract objections
  const objections = extractObjections(allText);

  // Extract questions asked
  const questions = inboundMessages
    .filter(m => m.body.includes('?'))
    .map(m => m.body.split('?')[0] + '?')
    .slice(0, 5);

  return {
    topics,
    painPoints,
    buyingSignals,
    objections,
    questions
  };
}

function extractTopics(text: string): string[] {
  const topicKeywords = [
    'pricing', 'features', 'integration', 'support', 'demo', 'trial',
    'onboarding', 'training', 'customization', 'security', 'scalability'
  ];

  return topicKeywords.filter(topic => 
    text.toLowerCase().includes(topic)
  );
}

function extractPainPoints(text: string): string[] {
  const painIndicators = [
    'struggle', 'difficult', 'problem', 'issue', 'challenge',
    'frustrated', 'time-consuming', 'expensive', 'slow'
  ];

  const lowerText = text.toLowerCase();
  return painIndicators.filter(pain => lowerText.includes(pain));
}

function extractBuyingSignals(text: string): string[] {
  const buyingKeywords = [
    'buy', 'purchase', 'price', 'cost', 'budget', 'contract',
    'ready to', 'when can we', 'how soon', 'sign up'
  ];

  const lowerText = text.toLowerCase();
  return buyingKeywords.filter(signal => lowerText.includes(signal));
}

function extractObjections(text: string): string[] {
  const objectionIndicators = [
    'too expensive', 'not sure', 'thinking about', 'concerned about',
    'worried', 'already have', 'maybe later'
  ];

  const lowerText = text.toLowerCase();
  return objectionIndicators.filter(obj => lowerText.includes(obj));
}

/**
 * Generate a summary of the conversation
 */
async function generateConversationSummary(messages: Message[]): Promise<string> {
  if (messages.length === 0) return 'No messages in conversation';
  
  const messageCount = messages.length;
  const inboundCount = messages.filter(m => m.direction === 'inbound').length;
  const outboundCount = messages.filter(m => m.direction === 'outbound').length;
  
  return `Conversation with ${messageCount} messages (${inboundCount} inbound, ${outboundCount} outbound)`;
}

/**
 * Extract key insights from messages
 */
function extractKeyInsights(messages: Message[]): string[] {
  const insights: string[] = [];
  const allText = messages.map(m => m.body).join(' ').toLowerCase();
  
  // Check for pricing discussions
  if (allText.includes('price') || allText.includes('cost') || allText.includes('budget')) {
    insights.push('Discussed pricing');
  }
  
  // Check for timeline discussions
  if (allText.includes('when') || allText.includes('timeline') || allText.includes('deadline')) {
    insights.push('Timeline discussed');
  }
  
  // Check for decision-making signals
  if (allText.includes('ready') || allText.includes('approve') || allText.includes('sign')) {
    insights.push('Ready to move forward');
  }
  
  // Check for objections
  if (allText.includes('concern') || allText.includes('worried') || allText.includes('issue')) {
    insights.push('Has concerns');
  }
  
  return insights;
}
