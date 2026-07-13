import React from 'react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { CheckCircle, AlertCircle, Zap, Shield } from 'lucide-react';

interface EmailFilterIntelligenceProps {
  onAcknowledge: () => void;
  isLoading?: boolean;
}

export function EmailFilterIntelligence({ onAcknowledge, isLoading }: EmailFilterIntelligenceProps) {
  const filters = [
    {
      icon: '🔐',
      title: 'OTP & Verification Codes',
      items: ['2FA codes (123456)', 'Verify your account', 'Click here to confirm', 'Authentication codes']
    },
    {
      icon: '📋',
      title: 'Transactional Emails',
      items: ['Receipts & invoices', 'Password resets', 'Order confirmations', 'Billing alerts']
    },
    {
      icon: '📢',
      title: 'Marketing & Newsletters',
      items: ['Promotional offers', 'Unsubscribe links', 'Newsletter subscriptions', 'Marketing campaigns']
    },
    {
      icon: '🤖',
      title: 'System Notifications',
      items: ['noreply@ accounts', 'notification@', 'alert@', 'automated alerts']
    }
  ];

  const benefits = [
    { icon: CheckCircle, text: 'Only real business leads', color: 'text-green-500' },
    { icon: Zap, text: 'Fast, accurate filtering', color: 'text-yellow-500' },
    { icon: Shield, text: 'Duplicates auto-removed', color: 'text-blue-500' },
    { icon: AlertCircle, text: 'Invalid emails skipped', color: 'text-orange-500' }
  ];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <Card className="w-full max-w-2xl bg-card border-border shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-muted/30 border-b border-border p-6 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-primary/5 to-primary/10 pointer-events-none" />
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <span className="text-2xl">✨</span> Intelligent Email Filtering
          </h2>
          <p className="text-muted-foreground mt-2">
            Our AI automatically filters out non-business emails so you only get real leads
          </p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Filter Categories */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filters.map((category, idx) => (
              <div
                key={idx}
                className="bg-muted/50 border border-border/50 rounded-lg p-4 hover:border-primary/50 transition-colors cursor-default hover:bg-muted/70"
              >
                <div className="text-2xl mb-2">{category.icon}</div>
                <h3 className="font-semibold text-foreground mb-2">{category.title}</h3>
                <ul className="space-y-1">
                  {category.items.map((item, i) => (
                    <li key={i} className="text-sm text-muted-foreground flex items-start">
                      <span className="text-primary mr-2">✓</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Benefits */}
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
            <h3 className="font-semibold text-foreground mb-3">What You Get:</h3>
            <div className="grid grid-cols-2 gap-3">
              {benefits.map((benefit, idx) => {
                const Icon = benefit.icon;
                return (
                  <div key={idx} className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${benefit.color}`} />
                    <span className="text-sm text-muted-foreground">{benefit.text}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Smart Detection */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-blue-500">🧠 How it works:</span> Each email is analyzed using AI to detect patterns in subject lines, sender addresses, and content. Transactional emails are identified and automatically skipped, leaving you with high-quality business contacts ready for outreach.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-muted/30 border-t border-border p-4 flex gap-3">
          <Button
            onClick={onAcknowledge}
            disabled={isLoading}
            className="flex-1 bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-700 hover:to-purple-700 text-white font-semibold shadow-lg"
          >
            {isLoading ? (
              <>⏳ Importing...</>
            ) : (
              <>✓ I Understand • Start Importing</>
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}
