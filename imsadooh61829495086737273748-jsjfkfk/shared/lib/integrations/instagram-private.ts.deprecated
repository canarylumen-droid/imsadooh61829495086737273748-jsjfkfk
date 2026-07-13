
import { IgApiClient } from 'instagram-private-api';
import { storage } from '../../storage';
import { encrypt, decrypt } from '../crypto/encryption';

interface InstagramSession {
  userId: string;
  client: IgApiClient;
  username: string;
  isAuthenticated: boolean;
  lastActivity: Date;
  messagesThisHour: number;
  hourResetTime: Date;
}

interface EncryptedCredentials {
  username: string;
  sessionToken: string; // Only store encrypted session token, NEVER passwords
}

interface MessageQueueItem {
  recipientUsername: string;
  message: string;
  priority: 'hot' | 'warm' | 'cold';
  timestamp: Date;
}

class InstagramPrivateService {
  private sessions: Map<string, InstagramSession> = new Map();
  private messageQueues: Map<string, MessageQueueItem[]> = new Map();
  private readonly MAX_DMS_PER_HOUR = 40; // 40 DMs per hour (safest limit to avoid bans)
  private readonly MIN_DELAY_MS = 4000; // 4 seconds between actions (more human-like)
  private readonly MAX_DELAY_MS = 12000; // 12 seconds between actions (avoid detection)

  async initializeClient(userId: string, username: string, password: string): Promise<void> {
    const ig = new IgApiClient();
    ig.state.generateDevice(username);

    try {
      // Login with password (password NEVER leaves this function)
      await ig.account.login(username, password);

      // Get session state and encrypt it (NOT the password)
      const sessionState = await ig.state.serialize();
      const encryptedSession = encrypt(sessionState);

      const session: InstagramSession = {
        userId,
        client: ig,
        username,
        isAuthenticated: true,
        lastActivity: new Date(),
        messagesThisHour: 0,
        hourResetTime: new Date(Date.now() + 60 * 60 * 1000),
      };

      this.sessions.set(userId, session);

      // Store ONLY encrypted session token (NOT password)
      await storage.updateUser(userId, {
        metadata: {
          instagram_private_connected: true,
          instagram_username: username,
          instagram_session_token: encryptedSession, // Encrypted session state
          connected_at: new Date().toISOString(),
        },
      });

      console.log(`✅ Instagram authenticated for ${username}`);
      console.log(`🔒 Session persists securely - password NEVER stored`);
    } catch (error) {
      console.error('Instagram authentication error:', error);
      throw new Error('Failed to authenticate with Instagram');
    }
  }

  /**
   * Restore session from encrypted token (called on server restart)
   */
  async restoreSession(userId: string): Promise<void> {
    const user = await storage.getUser(userId);
    if (!user?.metadata?.instagram_session_token) {
      throw new Error('No saved session found');
    }

    const ig = new IgApiClient();
    const sessionState = decrypt(user.metadata.instagram_session_token);
    await ig.state.deserialize(sessionState);

    const session: InstagramSession = {
      userId,
      client: ig,
      username: user.metadata.instagram_username,
      isAuthenticated: true,
      lastActivity: new Date(),
      messagesThisHour: 0,
      hourResetTime: new Date(Date.now() + 60 * 60 * 1000),
    };

    this.sessions.set(userId, session);
    console.log(`✅ Instagram session restored for ${user.metadata.instagram_username}`);
  }

  async sendMessage(
    userId: string, 
    recipientUsername: string, 
    message: string,
    priority: 'hot' | 'warm' | 'cold' = 'cold'
  ): Promise<void> {
    const session = this.sessions.get(userId);

    if (!session || !session.isAuthenticated) {
      throw new Error('Instagram not connected. Please authenticate first.');
    }

    // Reset hourly counter if needed
    if (new Date() > session.hourResetTime) {
      session.messagesThisHour = 0;
      session.hourResetTime = new Date(Date.now() + 60 * 60 * 1000);
    }

    // Check rate limit
    if (session.messagesThisHour >= this.MAX_DMS_PER_HOUR) {
      throw new Error(`Hourly DM limit reached (${this.MAX_DMS_PER_HOUR}/hour). Please wait before sending more messages.`);
    }

    // Human-like delay (priority messages get shorter delays)
    const delayMultiplier = priority === 'hot' ? 0.5 : priority === 'warm' ? 0.75 : 1;
    await this.randomDelay(delayMultiplier);

    try {
      const igUserId = await session.client.user.getIdByUsername(recipientUsername);
      const thread = session.client.entity.directThread([igUserId.toString()]);
      await thread.broadcastText(message);

      session.messagesThisHour++;
      session.lastActivity = new Date();

      const priorityEmoji = priority === 'hot' ? '🔥' : priority === 'warm' ? '🌡️' : '❄️';
      console.log(`✅ ${priorityEmoji} Instagram DM sent to ${recipientUsername} (${session.messagesThisHour}/${this.MAX_DMS_PER_HOUR} this hour)`);
    } catch (error) {
      console.error('Error sending Instagram DM:', error);
      throw new Error('Failed to send Instagram message');
    }
  }

  /**
   * Queue a message with priority (hot/warm leads get sent first)
   */
  async queueMessage(
    userId: string,
    recipientUsername: string,
    message: string,
    priority: 'hot' | 'warm' | 'cold' = 'cold'
  ): Promise<void> {
    if (!this.messageQueues.has(userId)) {
      this.messageQueues.set(userId, []);
    }

    const queue = this.messageQueues.get(userId)!;
    queue.push({
      recipientUsername,
      message,
      priority,
      timestamp: new Date()
    });

    // Sort queue: hot > warm > cold
    queue.sort((a, b) => {
      const priorityOrder = { hot: 0, warm: 1, cold: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    console.log(`📬 Queued ${priority} priority message for ${recipientUsername}`);
  }

  /**
   * Process queued messages (called by a worker)
   * Smart continuation: Processes hot → warm → cold, pauses when rate limited,
   * resumes after 1 hour + random delay to avoid detection
   */
  async processMessageQueue(userId: string): Promise<void> {
    const queue = this.messageQueues.get(userId);
    if (!queue || queue.length === 0) return;

    const session = this.sessions.get(userId);
    if (!session || !session.isAuthenticated) return;

    // Check if we should resume (1 hour + 5-15 min random delay)
    const now = new Date();
    if (now < session.hourResetTime) {
      // Still in cooldown period
      console.log(`⏳ Rate limit cooldown - resuming at ${session.hourResetTime.toLocaleTimeString()}`);
      return;
    }

    // Reset counter with random delay (5-15 minutes past the hour)
    if (now >= session.hourResetTime) {
      const randomDelayMs = (5 + Math.random() * 10) * 60 * 1000; // 5-15 min
      session.messagesThisHour = 0;
      session.hourResetTime = new Date(now.getTime() + 60 * 60 * 1000 + randomDelayMs);
      console.log(`✅ Rate limit reset - next reset at ${session.hourResetTime.toLocaleTimeString()}`);
    }

    // Process messages in priority order until rate limit hit
    const processedUsernames = new Set<string>();
    
    while (queue.length > 0 && session.messagesThisHour < this.MAX_DMS_PER_HOUR) {
      const item = queue.shift()!;
      
      // Skip if already processed this lead
      if (processedUsernames.has(item.recipientUsername)) {
        console.log(`⏭️ Skipping ${item.recipientUsername} - already processed`);
        continue;
      }

      try {
        await this.sendMessage(userId, item.recipientUsername, item.message, item.priority);
        processedUsernames.add(item.recipientUsername);
      } catch (error) {
        console.error(`Failed to send queued message to ${item.recipientUsername}:`, error);
        
        // If rate limited, stop processing and wait for next cycle
        if ((error as Error).message.includes('rate limit')) {
          // Re-queue this message for next cycle
          queue.unshift(item);
          console.log(`🛑 Rate limit reached - pausing until ${session.hourResetTime.toLocaleTimeString()}`);
          break;
        }
        
        // For other errors, skip this lead and continue
        processedUsernames.add(item.recipientUsername);
      }
    }

    console.log(`📊 Queue status: ${queue.length} messages remaining, ${session.messagesThisHour}/${this.MAX_DMS_PER_HOUR} sent this hour`);
  }

  async getInbox(userId: string, limit: number = 20): Promise<any[]> {
    const session = this.sessions.get(userId);

    if (!session || !session.isAuthenticated) {
      throw new Error('Instagram not connected');
    }

    await this.randomDelay();

    try {
      const inbox = await session.client.feed.directInbox().items();
      return inbox.slice(0, limit);
    } catch (error) {
      console.error('Error fetching Instagram inbox:', error);
      return [];
    }
  }

  async disconnect(userId: string): Promise<void> {
    const session = this.sessions.get(userId);
    if (session) {
      try {
        await session.client.account.logout();
      } catch (error) {
        console.error('Error logging out:', error);
      }
      this.sessions.delete(userId);

      // CRITICAL: Delete session token from database
      await storage.updateUser(userId, {
        metadata: {
          instagram_private_connected: false,
          instagram_username: null,
          instagram_session_token: null, // Delete encrypted session
          disconnected_at: new Date().toISOString(),
        },
      });
    }
  }

  getStatus(userId: string): {
    connected: boolean;
    messagesThisHour: number;
    remainingThisHour: number;
    resetTime: Date | null;
  } {
    const session = this.sessions.get(userId);
    
    if (!session) {
      return {
        connected: false,
        messagesThisHour: 0,
        remainingThisHour: 0,
        resetTime: null,
      };
    }

    return {
      connected: session.isAuthenticated,
      messagesThisHour: session.messagesThisHour,
      remainingThisHour: this.MAX_DMS_PER_HOUR - session.messagesThisHour,
      resetTime: session.hourResetTime,
    };
  }

  private async randomDelay(multiplier: number = 1): Promise<void> {
    const baseDelay = Math.random() * (this.MAX_DELAY_MS - this.MIN_DELAY_MS) + this.MIN_DELAY_MS;
    const delay = baseDelay * multiplier;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

export const instagramPrivateService = new InstagramPrivateService();
