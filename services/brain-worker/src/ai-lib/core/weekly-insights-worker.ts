import { storage } from '@shared/lib/storage/storage.js';
import { generateInsights } from "./ai-service.js";
import { quotaService } from "@shared/lib/monitoring/quota-service.js";
import type { User, Lead, Message } from "@audnix/shared";
import type { WeeklyInsight, LeadInsights } from '@shared/types.js';

interface DatabaseError extends Error {
  code?: string;
}

export class WeeklyInsightsWorker {
  private isRunning = false;
  private checkInterval: NodeJS.Timeout | null = null;

  start(): void {
    if (this.isRunning) {
      console.log("Weekly insights worker is already running");
      return;
    }

    this.isRunning = true;
    console.log("Starting weekly insights worker...");

    // Check every 6 hours for users who need weekly insights
    this.checkInterval = setInterval(
      () => {
        this.processWeeklyInsights().catch((error: unknown) => {
          console.error("Error in weekly insights worker:", error);
        });
      },
      6 * 60 * 60 * 1000 // 6 hours
    );

    // Run immediately on start
    this.processWeeklyInsights().catch((error: unknown) => {
      console.error("Error in initial weekly insights run:", error);
    });
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    console.log("Weekly insights worker stopped");
  }

  private async processWeeklyInsights(): Promise<void> {
    if (quotaService.isRestricted()) {
      console.log('[WeeklyInsights] Skipping run: Database quota restricted');
      return;
    }
    try {
      // Check if database is ready by attempting to get users
      // Only fetch users who are due for insights (7+ days or never)
      let users: User[] = [];
      try {
        users = await storage.getUsersNeedingWeeklyInsights();
      } catch (dbError: unknown) {
        const error = dbError as DatabaseError;
        // Database not ready (migrations not run, or connection issue)
        if (error.code === '42P01' || error.code === 'ECONNREFUSED') {
          console.log('Weekly insights worker: Database not ready, skipping this run');
          return;
        }
        throw dbError; // Re-throw other errors
      }

      const now = new Date();

      for (const user of users) {
        try {
          // Check if user needs weekly insights (7 days since last generation)
          const lastInsightDate: Date = user.lastInsightGeneratedAt || user.createdAt;
          const daysSinceLastInsight = Math.floor(
            (now.getTime() - new Date(lastInsightDate).getTime()) / (1000 * 60 * 60 * 24)
          );

          if (daysSinceLastInsight >= 7) {
            console.log(`Generating weekly insights for user ${user.id}...`);

            // Get user's leads from the past week
            const leads: Lead[] = await storage.getLeads({
              userId: user.id,
              limit: 1000,
            });

            // Get messages from the past week
            const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const recentMessages: Message[] = await storage.getAllMessages(user.id);
            const weekMessages = recentMessages.filter(
              (msg: Message) => new Date(msg.createdAt) >= weekAgo
            );

            // Prepare data for insights generation
            const insightsData = {
              userId: user.id,
              leadsCount: leads.length,
              messagesCount: weekMessages.length,
              convertedLeads: leads.filter((lead: Lead) => lead.status === 'converted').length,
              newLeads: leads.filter((lead: Lead) => lead.status === 'new').length,
              channelBreakdown: {
                email: leads.filter((lead: Lead) => lead.channel === 'email').length,
                instagram: leads.filter((lead: Lead) => lead.channel === 'instagram').length,
              },
            };

            // Generate insights using AI - Enhanced for low data & strategic value
            const insightsPrompt = `Generate a brief, punchy weekly performance summary for a sales professional.
            
            METRICS:
            - Leads Processed: ${insightsData.leadsCount}
            - Messages Sent: ${insightsData.messagesCount}
            - Converted: ${insightsData.convertedLeads}
            
            LOGIC:
            If data is low (0-5 leads), focus on "Momentum Building" and "Setup Optimization".
            If data is high, focus on "Conversion Optimization" and "Scaling".
            Always provide 3 bullet points: 1 Metric Insight, 1 Behavior Pattern, 1 Direct Action.
            Keep it under 150 words. Tone: Elite Sales Consultant.`;

            const insights: string = await generateInsights(insightsData, insightsPrompt);

            // Create notification for the user
            await storage.createNotification({
              userId: user.id,
              title: "🎯 Weekly Performance Audit",
              message: insightsData.leadsCount > 0
                ? `Audit complete: ${insightsData.leadsCount} leads analyzed. View your strategic insights.`
                : "Initial baseline established. View your setup recommendations.",
              type: "insight",
              isRead: false,
              metadata: {
                insightsData: insights,
                generatedAt: now.toISOString(),
                leadCount: leads.length,
                messageCount: weekMessages.length,
              },
            });

            // Update user's last insight generation date
            await storage.updateUser(user.id, {
              lastInsightGeneratedAt: now,
            });

            console.log(`Weekly insights generated and notification sent to user ${user.id}`);
          }
        } catch (userError: unknown) {
          console.error(`Error processing insights for user ${user.id}:`, userError);
          // Continue with next user
        }
      }
    } catch (error: unknown) {
      const dbError = error as DatabaseError;
      // Only log non-database initialization errors
      if (dbError.code !== '42P01' && dbError.code !== 'ECONNREFUSED') {
        console.error("Error in processWeeklyInsights:", error);
        quotaService.reportDbError(error);
      }
    }
  }
}

// Helper function to check if database is initialized
async function isDatabaseReady(): Promise<boolean> {
  try {
    await storage.getUserCount();
    return true;
  } catch (error: unknown) {
    const dbError = error as DatabaseError;
    if (dbError.code === '42P01' || dbError.code === 'ECONNREFUSED') {
      return false;
    }
    return true; // Other errors don't mean DB isn't ready
  }
}

export const weeklyInsightsWorker = new WeeklyInsightsWorker();



