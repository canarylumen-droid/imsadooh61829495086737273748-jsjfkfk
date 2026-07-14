import { google } from 'googleapis';
import type { gmailpostmastertools_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { getOAuthRedirectUrl } from '@shared/config/config/oauth-redirects.js';

interface PostmasterMetrics {
  domain: string;
  spamRate: number;
  deliveryErrorRate: number;
  reputation: number;
  encryptedTrafficRate: number;
  ipsReputation: Map<string, number>;
  lastUpdated: Date;
}

export class PostmasterService {
  private oauth2Client: OAuth2Client | null = null;
  private client: gmailpostmastertools_v1.Gmailpostmastertools | null = null;
  private _isEnabled = false;

  constructor() {
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
    const redirectUri = getOAuthRedirectUrl('postmaster');

    if (!clientId || !clientSecret) {
      console.warn('[PostmasterService] Google OAuth credentials not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
      return;
    }

    this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    this._isEnabled = true;
  }

  private ensureClient(accessToken: string): gmailpostmastertools_v1.Gmailpostmastertools | null {
    if (!this._isEnabled || !this.oauth2Client) return null;

    this.oauth2Client.setCredentials({ access_token: accessToken });
    return new google.gmailpostmastertools_v1.Gmailpostmastertools({
      auth: this.oauth2Client,
    });
  }

  async fetchDomainMetrics(domain: string, accessToken: string): Promise<PostmasterMetrics | null> {
    const client = this.ensureClient(accessToken);
    if (!client) return null;

    try {
      const parent = `domains/${domain}`;

      const [trafficResponse] = await Promise.all([
        client.domains.trafficStats.list({ parent, pageSize: 1 }),
      ]);

      const statsList = trafficResponse.data.trafficStats;
      if (!statsList || statsList.length === 0) {
        console.warn(`[PostmasterService] No traffic stats available for ${domain}`);
        return null;
      }

      const latestStats = statsList[0];
      const deliveryErrors = latestStats.deliveryErrors || [];
      const totalDeliveryErrorRatio = deliveryErrors.reduce((sum, e) => sum + (e.errorRatio || 0), 0);

      const metrics: PostmasterMetrics = {
        domain,
        spamRate: latestStats.userReportedSpamRatio || 0,
        deliveryErrorRate: totalDeliveryErrorRatio,
        reputation: this.mapReputation(latestStats.domainReputation || 'NOT_AVAILABLE'),
        encryptedTrafficRate: latestStats.inboundEncryptionRatio || 0,
        ipsReputation: new Map(),
        lastUpdated: new Date(),
      };

      const ipReputations = latestStats.ipReputations || [];
      for (const ipRep of ipReputations) {
        const sampleIps = ipRep.sampleIps || [];
        for (const ip of sampleIps) {
          metrics.ipsReputation.set(ip, this.mapReputation(ipRep.reputation || 'NOT_AVAILABLE'));
        }
      }

      return metrics;
    } catch (error: any) {
      if (error.code === 403 || error.code === 401) {
        console.warn(`[PostmasterService] Auth failed for ${domain}: ${error.message}`);
      } else if (error.code === 404) {
        console.warn(`[PostmasterService] Domain ${domain} not found in Postmaster Tools`);
      } else {
        console.error(`[PostmasterService] Error fetching metrics for ${domain}:`, error.message);
      }
      return null;
    }
  }

  private mapReputation(reputation: string): number {
    const map: Record<string, number> = {
      'HIGH': 90,
      'MEDIUM': 60,
      'LOW': 30,
      'BAD': 10,
      'NOT_AVAILABLE': 50,
    };
    return map[reputation] || 50;
  }

  async fetchAllDomains(accessToken: string): Promise<string[]> {
    const client = this.ensureClient(accessToken);
    if (!client) return [];

    try {
      const response = await client.domains.list({});
      return response.data.domains?.map((d: any) => d.name?.replace('domains/', '') || '') || [];
    } catch (error: any) {
      console.error('[PostmasterService] Error listing domains:', error.message);
      return [];
    }
  }

  get isEnabled(): boolean {
    return this._isEnabled;
  }
}

export const postmasterService = new PostmasterService();
