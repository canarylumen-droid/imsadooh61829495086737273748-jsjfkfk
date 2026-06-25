
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
  customPrice?: boolean;
}

export const PRICING_TIERS: PricingTier[] = [
  {
    id: 'trial',
    name: 'Accelerator Trial',
    price: 0,
    period: '3 days',
    description: 'Experience the power of autonomous engagement. No commitment required.',
    leadsLimit: 250,
    mailboxLimit: 3,
    voiceMinutes: 100,
    order: -1,
    features: [
      '250 lead synchronization',
      '3 Connected Mailboxes',
      '100 AI Voice Minutes',
      'Basic Cadence',
      'Standard Support',
    ],
  },
  {
    id: 'starter',
    name: 'Growth',
    price: 49.99,
    period: 'month',
    description: 'Empower your small team with elite-level automation and intelligence.',
    leadsLimit: 2500,
    mailboxLimit: 10,
    voiceMinutes: 250,
    order: 1,
    features: [
      '2,500 leads / month',
      '10 Connected Mailboxes',
      '250 AI Voice Minutes',
      'Autonomous Follow-ups',
      'Smart CRM Integration',
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
    leadsLimit: 7000,
    mailboxLimit: 30,
    voiceMinutes: 1000,
    popular: true,
    order: 2,
    features: [
      '7,000 leads / month',
      '30 Connected Mailboxes',
      '1,000 AI Voice Minutes',
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
    price: -1,
    period: 'month',
    description: 'Custom-built automation architecture for organizations lead by data.',
    leadsLimit: -1, // Unlimited
    mailboxLimit: -1, // Unlimited
    voiceMinutes: -1, // Unlimited
    order: 3,
    customPrice: true,
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
