
export interface PricingTier {
  id: string;
  name: string;
  price: number;
  period: string;
  description: string;
  features: string[];
  leadsLimit: number;
  mailboxLimit: number;
  voiceMinutes: number;
  popular?: boolean;
  paymentLink?: string;
  order: number;
}

export const PRICING_TIERS: PricingTier[] = [
  {
    id: 'trial',
    name: 'Accelerator Trial',
    price: 0,
    period: '3 days',
    description: 'Experience the power of autonomous engagement. No commitment required.',
    leadsLimit: 10000,
    mailboxLimit: 1,
    voiceMinutes: 0,
    order: -1,
    features: [
      '10,000 lead synchronization',
      'Unified Email engagement',
      'Intelligence Flow (Real-time logs)',
      'Automated objection handling',
      'Direct calendar booking',
      'Predictive lead scoring',
      'Full dashboard access',
    ],
  },
  {
    id: 'starter',
    name: 'Growth',
    price: 49.99,
    period: 'month',
    description: 'Empower your small team with elite-level automation and intelligence.',
    leadsLimit: 25000,
    mailboxLimit: 5,
    voiceMinutes: 100,
    order: 1,
    features: [
      '25,000 leads / month',
      '5 Connected Mailboxes',
      '100 AI Voice Minutes',
      'Autonomous Follow-ups',
      'Instagram DM Synchronization',
      'Smart CRM',
      'Performance Analytics',
      'Conversion Tracking',
    ],
  },
  {
    id: 'pro',
    name: 'Performance',
    price: 99.99,
    period: 'month',
    description: 'The standard for high-performance sales teams scaling past their limits.',
    leadsLimit: 100000,
    mailboxLimit: 15,
    voiceMinutes: 400,
    popular: true,
    order: 2,
    features: [
      '100,000 leads / month',
      '15 Connected Mailboxes',
      '400 AI Voice Minutes',
      'Deep Lead Insights',
      'Intent Recognition',
      'Objection Mastery (110+ Scenarios)',
      'Strategic ROI Mapping',
      'Priority Support Access',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 199.99,
    period: 'month',
    description: 'Custom-built automation architecture for organizations lead by data.',
    leadsLimit: -1, // Unlimited
    mailboxLimit: -1, // Unlimited
    voiceMinutes: -1, // Unlimited
    order: 3,
    features: [
      'Unlimited leads / synchronization',
      'Unlimited Mailboxes & Capacity',
      'Unlimited AI Voice Generation',
      'Voice Cloning & Training',
      'Smart Auto-Tagging System',
      'Drop-off & Churn Detection',
      'Dedicated Success Manager',
      '24/7 Priority Tech Support',
    ],
  },
];
