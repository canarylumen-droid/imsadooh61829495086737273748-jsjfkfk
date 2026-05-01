interface ModerationResult {
  isAppropriate: boolean;
  confidence: number;
  flags: string[];
  category?: 'spam' | 'offensive' | 'sexual' | 'violence' | 'safe';
  shouldBlock: boolean;
}

interface OpenAIModerationCategories {
  sexual: boolean;
  hate: boolean;
  harassment: boolean;
  'self-harm': boolean;
  'sexual/minors': boolean;
  'hate/threatening': boolean;
  'violence/graphic': boolean;
  violence: boolean;
  'harassment/threatening': boolean;
}

interface OpenAIModerationCategoryScores {
  sexual: number;
  hate: number;
  harassment: number;
  'self-harm': number;
  'sexual/minors': number;
  'hate/threatening': number;
  'violence/graphic': number;
  violence: number;
  'harassment/threatening': number;
}

interface OpenAIModerationResult {
  flagged: boolean;
  categories: OpenAIModerationCategories;
  category_scores: OpenAIModerationCategoryScores;
}

interface OpenAIModerationResponse {
  id: string;
  model: string;
  results: OpenAIModerationResult[];
}

/**
 * Content moderation system
 * Detects inappropriate, spam, or offensive content
 */
export class ContentModerationService {

  private readonly offensiveKeywords: readonly string[] = [
    'fuck', 'shit', 'bitch', 'asshole', 'damn', 'hell',
    'idiot', 'stupid', 'dumb', 'scam', 'fraud'
  ] as const;

  private readonly spamPatterns: readonly RegExp[] = [
    /click here/i,
    /free money/i,
    /win \$\d+/i,
    /act now/i,
    /limited time/i,
    /guaranteed/i,
    /earn \$\d+ per day/i,
    /work from home/i
  ] as const;

  private readonly sexualKeywords: readonly string[] = [
    'sex', 'sexy', 'nude', 'porn', 'xxx', 'adult',
    'explicit', 'nsfw', 'hookup'
  ] as const;

  private readonly violentKeywords: readonly string[] = [
    'kill', 'murder', 'die', 'death', 'hurt', 'attack',
    'weapon', 'bomb', 'threat'
  ] as const;

  /**
   * Moderate message content
   */
  public async moderateContent(content: string): Promise<ModerationResult> {
    const lower = content.toLowerCase();
    const flags: string[] = [];
    let category: ModerationResult['category'] = 'safe';
    let shouldBlock = false;

    const offensiveCount = this.offensiveKeywords.filter(word =>
      lower.includes(word)
    ).length;
    if (offensiveCount > 0) {
      flags.push('offensive_language');
      category = 'offensive';
      if (offensiveCount >= 3) shouldBlock = true;
    }

    const spamMatches = this.spamPatterns.filter(pattern =>
      pattern.test(content)
    ).length;
    if (spamMatches > 0) {
      flags.push('spam_pattern');
      category = 'spam';
      if (spamMatches >= 2) shouldBlock = true;
    }

    const sexualCount = this.sexualKeywords.filter(word =>
      lower.includes(word)
    ).length;
    if (sexualCount > 0) {
      flags.push('sexual_content');
      category = 'sexual';
      if (sexualCount >= 2) shouldBlock = true;
    }

    const violentCount = this.violentKeywords.filter(word =>
      lower.includes(word)
    ).length;
    if (violentCount > 0) {
      flags.push('violent_content');
      category = 'violence';
      if (violentCount >= 2) shouldBlock = true;
    }

    const capsMatch = content.match(/[A-Z]/g);
    const capsRatio = capsMatch ? capsMatch.length / content.length : 0;
    if (capsRatio > 0.7 && content.length > 10) {
      flags.push('excessive_caps');
      if (category === 'safe') category = 'offensive';
    }

    if (/(.)\1{4,}/.test(content)) {
      flags.push('repeated_characters');
      if (category === 'safe') category = 'spam';
    }

    const confidence = Math.min(
      0.5 + (flags.length * 0.15),
      0.95
    );

    const isAppropriate = flags.length === 0;

    return {
      isAppropriate,
      confidence,
      flags,
      category,
      shouldBlock
    };
  }

  /**
   * Enhanced moderation using OpenAI (if available)
   */
  public async moderateWithAI(content: string): Promise<ModerationResult> {
    if (!process.env.OPENAI_API_KEY) {
      return this.moderateContent(content);
    }

    try {
      const response = await fetch('https://api.openai.com/v1/moderations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({ input: content })
      });

      if (!response.ok) {
        throw new Error('OpenAI moderation failed');
      }

      const data = await response.json() as OpenAIModerationResponse;

      const result = data.results?.[0];
      if (!result) {
        throw new Error('No moderation result returned');
      }

      const flags: string[] = [];
      let category: ModerationResult['category'] = 'safe';

      if (result.categories.sexual) {
        flags.push('sexual_content');
        category = 'sexual';
      }
      if (result.categories.hate) {
        flags.push('offensive_language');
        category = 'offensive';
      }
      if (result.categories.violence) {
        flags.push('violent_content');
        category = 'violence';
      }
      if (result.categories['self-harm']) {
        flags.push('self_harm');
        category = 'violence';
      }

      const scores = result.category_scores;
      const scoreValues: number[] = [
        scores.sexual,
        scores.hate,
        scores.harassment,
        scores['self-harm'],
        scores['sexual/minors'],
        scores['hate/threatening'],
        scores['violence/graphic'],
        scores.violence,
        scores['harassment/threatening']
      ];
      const maxScore = Math.max(...scoreValues);

      return {
        isAppropriate: !result.flagged,
        confidence: maxScore,
        flags,
        category,
        shouldBlock: result.flagged
      };
    } catch (error) {
      console.error('AI moderation error, falling back to keyword-based:', error);
      return this.moderateContent(content);
    }
  }

  /**
   * Log moderation event for review
   */
  public async logModerationEvent(
    userId: string,
    leadId: string,
    content: string,
    result: ModerationResult
  ): Promise<void> {
    if (result.shouldBlock) {
      console.warn('⚠️ Content blocked:', {
        userId,
        leadId,
        flags: result.flags,
        category: result.category,
        preview: content.substring(0, 50)
      });
    }
  }
}

export const contentModerationService = new ContentModerationService();

export type { ModerationResult };
