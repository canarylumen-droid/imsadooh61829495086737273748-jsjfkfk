import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { AlertCircle, CheckCircle, Unlink } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface CalendarStatus {
  calendly: { connected: boolean; accountType: string | null };
  google?: { connected: boolean; accountType: string | null }; // legacy - not displayed
  primary: string | null;
  message: string;
}

type ConnectionMethod = 'oauth' | 'manual' | null;

export function CalendlyConnectUI() {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectionMethod, setConnectionMethod] = useState<ConnectionMethod>(null);

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/calendar/status', {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (error) {
      console.error('Failed to fetch calendar status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConnectCalendlyOAuth = async () => {
    setConnecting(true);
    try {
      const res = await fetch('/api/oauth/connect/calendly', {
        credentials: 'include'
      });

      if (res.ok) {
        const data = await res.json();
        // Redirect to Calendly OAuth page
        window.location.href = data.authUrl;
      } else {
        toast({ title: 'Error', description: 'Failed to start OAuth flow', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to connect Calendly', variant: 'destructive' });
    } finally {
      setConnecting(false);
    }
  };

  const handleConnectCalendlyManual = async () => {
    if (!token.trim()) {
      toast({ title: 'Error', description: 'Please paste your Calendly API token', variant: 'destructive' });
      return;
    }

    setConnecting(true);
    try {
      const res = await fetch('/api/calendar/connect-calendly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token })
      });

      if (res.ok) {
        const data = await res.json();
        toast({ title: 'Success', description: data.message });
        setToken('');
        setConnectionMethod(null);
        await fetchStatus();
      } else {
        const error = await res.json();
        toast({ title: 'Error', description: error.error, variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to connect Calendly', variant: 'destructive' });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnectCalendly = async () => {
    try {
      const res = await fetch('/api/calendar/disconnect-calendly', {
        method: 'POST',
        credentials: 'include'
      });

      if (res.ok) {
        toast({ title: 'Success', description: 'Calendly disconnected' });
        await fetchStatus();
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to disconnect Calendly', variant: 'destructive' });
    }
  };

  if (loading) {
    return <div className="text-center py-4">Loading calendar status...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Calendly Status */}
      <Card className="border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span>📅 Calendly</span>
            {status?.calendly.connected ? (
              <CheckCircle className="w-5 h-5 text-green-500" />
            ) : (
              <AlertCircle className="w-5 h-5 text-amber-500" />
            )}
          </CardTitle>
          <CardDescription>
            {status?.calendly.connected ? 'Your Calendly is connected' : 'Connect Calendly for AI auto-booking'}
          </CardDescription>
        </CardHeader>
        {!status?.calendly.connected && (
          <div className="px-6 pb-2">
            <div className="p-3 rounded-lg bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 text-sm text-gray-300">
              <p className="font-semibold text-cyan-400 mb-1">Why connect Calendly?</p>
              <p className="text-gray-400 text-xs">
                Audnix automatically books meetings when it detects buying intent. The AI reads the chat, handles objections, and drives leads to book a call — automatically. You can also attach a payment link for direct-to-payment flows.
              </p>
            </div>
          </div>
        )}
        <CardContent className="space-y-3">
          {status?.calendly.connected ? (
            <div className="bg-green-500/10 border border-green-500/30 rounded p-3">
              <p className="text-sm text-green-700 dark:text-green-400">
                ✅ Connected: {status.calendly.accountType}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                Your meetings will be booked in your Calendly account
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 text-red-600 hover:text-red-700"
                onClick={handleDisconnectCalendly}
              >
                <Unlink className="w-4 h-4 mr-2" />
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {!connectionMethod ? (
                <div className="space-y-2">
                  <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">
                    How do you want to connect?
                  </p>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => setConnectionMethod('oauth')}
                      className="flex-1 bg-cyan-600 hover:bg-cyan-700"
                    >
                      ✨ Instant OAuth (Recommended)
                    </Button>
                    <Button
                      onClick={() => setConnectionMethod('manual')}
                      variant="outline"
                      className="flex-1"
                    >
                      🔑 Manual API Key
                    </Button>
                  </div>
                </div>
              ) : connectionMethod === 'oauth' ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Click below to log in to Calendly:
                  </p>
                  <Button
                    onClick={handleConnectCalendlyOAuth}
                    disabled={connecting}
                    className="w-full bg-cyan-600 hover:bg-cyan-700"
                  >
                    {connecting ? 'Redirecting...' : 'Login with Calendly'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setConnectionMethod(null);
                      setToken('');
                    }}
                    className="w-full"
                  >
                    Back
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Get your API token in 2 minutes:
                  </p>
                  <ol className="text-sm space-y-2 ml-4 list-decimal text-gray-700 dark:text-gray-300">
                    <li>Sign up free: <a href="https://calendly.com" target="_blank" rel="noopener noreferrer" className="text-cyan-500 hover:underline">calendly.com</a></li>
                    <li>Settings → Integrations → API & Webhooks</li>
                    <li>Create personal API token</li>
                    <li>Copy and paste below</li>
                  </ol>
                  <Input
                    placeholder="calendly_xxxxxxxxxxxxxxxxxxxxxxxx"
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="font-mono text-sm"
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={handleConnectCalendlyManual}
                      disabled={connecting}
                      className="flex-1 bg-green-600 hover:bg-green-700"
                    >
                      {connecting ? 'Validating...' : 'Verify & Connect'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setConnectionMethod(null);
                        setToken('');
                      }}
                      className="flex-1"
                    >
                      Back
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info */}
      <div className="bg-blue-500/5 border border-blue-500/30 rounded p-3 text-sm text-blue-700 dark:text-blue-400">
        <p>💡 <strong>Pro tip:</strong> Set up your availability in Calendly once, and Audnix will automatically book meetings when leads show buying intent!</p>
      </div>
    </div>
  );
}
