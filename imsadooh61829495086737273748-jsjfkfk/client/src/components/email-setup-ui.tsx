import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { AlertCircle, CheckCircle, Unlink, Mail, ArrowRight, Shield, Info } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Progress } from './ui/progress';
import { EmailFilterIntelligence } from './email-filter-intelligence';

interface EmailStatus {
  connected: boolean;
  email: string | null;
  provider: string;
}

interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  email: string;
  password: string;
  fromName: string;
}

export function EmailSetupUI() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<EmailConfig>({
    smtpHost: '',
    smtpPort: 587,
    imapHost: '',
    imapPort: 993,
    email: '',
    password: '',
    fromName: ''
  });
  const [connecting, setConnecting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importStats, setImportStats] = useState({ imported: 0, skipped: 0, errors: 0 });
  const [showSetup, setShowSetup] = useState(false);
  const [showFilterInfo, setShowFilterInfo] = useState(false);
  const [passwordType, setPasswordType] = useState<'app_password' | 'mailbox_password'>('mailbox_password');
  const [appPasswordGuide, setAppPasswordGuide] = useState<any>(null);
  const [discovering, setDiscovering] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [lastDetectedDomain, setLastDetectedDomain] = useState('');
  const [connectionStep, setConnectionStep] = useState<string>('');
  const [dnsWarnings, setDnsWarnings] = useState<string[]>([]);
  const [testingConnection, setTestingConnection] = useState(false);
  const [verificationSteps, setVerificationSteps] = useState<string[]>([]);
  const [verificationResults, setVerificationResults] = useState<{step: string; status: 'pending' | 'success' | 'failed'; message?: string}[]>([]);

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/custom-email/status', {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        if (!data.connected) {
          setShowSetup(true);
        }
      }
    } catch (error) {
      console.error('Failed to fetch email status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDiscover = async (email: string, isInitial = false) => {
    if (!email || !email.includes('@')) return;
    const domain = email.split('@')[1]?.toLowerCase();
    if (!isInitial && domain === lastDetectedDomain) return;
    
    setLastDetectedDomain(domain || '');
    setDiscovering(true);
    try {
      const res = await fetch('/api/custom-email/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      if (res.ok) {
        const data = await res.json();
        setConfig(prev => ({
          ...prev,
          smtpHost: data.smtp?.host || prev.smtpHost,
          smtpPort: data.smtp?.port || prev.smtpPort,
          imapHost: data.imap?.host || prev.imapHost,
          imapPort: data.imap?.port || prev.imapPort,
          fromName: prev.fromName || data.suggestedName || ''
        }));
        
        if (data.provider === 'gmail') {
          setAppPasswordGuide({
            ...data.appPasswordGuide,
            steps: [
              ...data.appPasswordGuide.steps,
              'IMPORTANT: Enable IMAP in Gmail Settings > Forwarding and POP/IMAP > Enable IMAP.'
            ]
          });
        } else {
          setAppPasswordGuide(data.appPasswordGuide);
        }

        if (data.smtp?.host && !isInitial) {
          toast({ title: 'Settings Found', description: `Detected settings for ${email}` });
        }
      }
    } catch (error) {
      console.error('Discovery failed:', error);
    } finally {
      setDiscovering(false);
    }
  };

  const handleShowFilterInfo = async () => {
    if (!config.smtpHost || !config.imapHost || !config.email || !config.password) {
      toast({ title: 'Error', description: 'Please fill all required fields', variant: 'destructive' });
      return;
    }

    setTestingConnection(true);
    setConnectionStep('Verifying mailbox credentials...');
    setDnsWarnings([]);
    setVerificationResults([
      { step: 'SMTP Verification', status: 'pending' },
      { step: 'IMAP Verification', status: 'pending' },
      { step: 'DNS Health Check', status: 'pending' },
    ]);

    try {
      const steps = [...verificationResults];
      steps[0] = { step: 'SMTP Verification', status: 'pending' };
      steps[1] = { step: 'IMAP Verification', status: 'pending' };
      steps[2] = { step: 'DNS Health Check', status: 'pending' };
      setVerificationResults(steps);

      const res = await fetch('/api/custom-email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smtpHost: config.smtpHost,
          smtpPort: config.smtpPort,
          imapHost: config.imapHost,
          imapPort: config.imapPort,
          email: config.email,
          password: config.password,
        })
      });

      const data = await res.json();

      const updatedSteps = [...verificationResults];
      if (data.smtpVerified) {
        updatedSteps[0] = { step: 'SMTP Verification', status: 'success' };
      } else {
        updatedSteps[0] = { step: 'SMTP Verification', status: 'failed', message: data.smtpError || 'SMTP connection failed' };
      }
      if (data.imapVerified) {
        updatedSteps[1] = { step: 'IMAP Verification', status: 'success' };
      } else {
        updatedSteps[1] = { step: 'IMAP Verification', status: 'failed', message: data.imapError || 'IMAP connection failed' };
      }
      setVerificationResults(updatedSteps);

      if (!res.ok) {
        const description = data.tip ? `${data.error}\n\n💡 ${data.tip}` : data.error;
        toast({ title: 'Connection Test Failed', description, variant: 'destructive' });
        return;
      }

      if (data.port && data.port !== config.smtpPort) {
        setConfig(prev => ({ ...prev, smtpPort: data.port }));
      }

      const dnsSteps = [...updatedSteps];
      if (data.dnsHealth) {
        dnsSteps[2] = { step: 'DNS Health Check', status: 'success', message: `${data.dnsHealth.score || 'N/A'}%` };
      } else {
        dnsSteps[2] = { step: 'DNS Health Check', status: 'failed', message: 'Could not verify DNS records' };
      }
      setVerificationResults(dnsSteps);

      if (data.dnsHealth?.warnings?.length > 0) {
        setDnsWarnings(data.dnsHealth.warnings);
      }

      setShowFilterInfo(true);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to test connection. Please try again.', variant: 'destructive' });
    } finally {
      setTestingConnection(false);
      setConnectionStep('');
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    setImporting(true);
    setImportProgress(0);

    try {
      setConnectionStep('Initializing secure connection...');
      
      // Use an AbortController for a 45s fail-safe timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);

      const res = await fetch('/api/custom-email/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          smtpHost: config.smtpHost,
          smtpPort: config.smtpPort,
          imapHost: config.imapHost,
          imapPort: config.imapPort,
          email: config.email,
          password: config.password,
          passwordType,
          fromName: config.fromName
        })
      });

      clearTimeout(timeoutId);
      setConnectionStep('Checking SMTP & scanning ports...');

      if (res.ok) {
        const data = await res.json();
        
        // Simulate progress for better UX
        for (let i = 0; i < 100; i += 10) {
          setImportProgress(i);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        setImportProgress(100);

        setImportStats({
          imported: data.leadsImported || 0,
          skipped: data.leadsSkipped || 0,
          errors: data.errors || 0
        });

        toast({
          title: data.smtpVerified ? 'Connected & Verified!' : 'Connected (Unverified)',
          description: data.smtpVerified
            ? `SMTP credentials verified. Mailbox is ready.`
            : `SMTP check failed: ${data.smtpVerifyError || 'unknown error'}. Sending may not work.`,
          variant: data.smtpVerified ? 'default' : 'destructive',
        });

        // Force refresh of dashboard analytics to update "Connected" status
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/analytics/full"] });
        queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });

        setConfig({ smtpHost: '', smtpPort: 587, imapHost: '', imapPort: 993, email: '', password: '', fromName: '' });
        setShowFilterInfo(false);
        setShowSetup(false);
        await fetchStatus();
      } else {
        const error = await res.json();
        const description = error.tip ? `${error.error}\n\n💡 ${error.tip}` : error.error;
        toast({ title: 'Connection Failed', description, variant: 'destructive' });
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        toast({ 
            title: 'Request Timed Out', 
            description: 'The connection scan took too long. Check your server status or try again.', 
            variant: 'destructive' 
        });
      } else {
        toast({ title: 'Error', description: 'Failed to connect email. Check your password or IMAP settings.', variant: 'destructive' });
      }
    } finally {
      setConnecting(false);
      setImporting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      const res = await fetch('/api/custom-email/disconnect', {
        method: 'POST',
        credentials: 'include'
      });

      if (res.ok) {
        toast({ title: 'Success', description: 'Email disconnected' });
        await fetchStatus();
        setShowSetup(true);
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to disconnect email', variant: 'destructive' });
    }
  };

  if (loading) {
    return <div className="text-center py-4 text-gray-500">Loading email settings...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Connected Status */}
      {status?.connected && !showSetup && (
        <Card className="border-green-500/30 bg-gradient-to-br from-green-500/10 to-transparent">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Business Email Connected
              <CheckCircle className="w-5 h-5 text-green-500 ml-auto" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="bg-green-500/10 border border-green-500/30 rounded p-3">
              <p className="text-sm text-green-700 dark:text-green-400 font-medium">
                ✅ {status.email}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                Your campaigns will send from this email address
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                🔄 Auto-follow-ups active • 📊 Real-time tracking • ✉️ Multi-channel ready
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 hover:text-red-700"
              onClick={handleDisconnect}
            >
              <Unlink className="w-4 h-4 mr-2" />
              Disconnect Email
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Setup Form */}
      {showSetup && (
        <Card className="border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 to-transparent">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Connect Your Business Email
            </CardTitle>
            <CardDescription>
              Enter your SMTP settings. Contacts will be auto-imported and campaigns start immediately.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Smart Auto-Detection Info */}
            <div className="bg-green-500/5 border border-green-500/20 rounded p-3">
              <p className="text-xs font-medium text-green-700 dark:text-green-400 mb-2">
                🔄 Smart Auto-Detection
              </p>
              <div className="text-xs space-y-1 text-muted-foreground">
                <p>Enter your email address below — we'll <strong>auto-detect</strong> the correct SMTP/IMAP settings.</p>
                <p>If the auto-detected port doesn't work, we'll <strong>automatically try the alternative port</strong> (465 ↔ 587).</p>
                <p className="pt-1">✅ Gmail, Outlook, Yahoo, Zoho, iCloud, Hostinger, GoDaddy, and more are fully supported.</p>
              </div>
            </div>

            {/* Form Inputs */}
            <div className="space-y-3">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-400">
                <p className="font-bold mb-1">📢 Important: Authentication Failed?</p>
                <p>If your password is rejected, you likely need an <strong>App Password</strong>.</p>
                <ul className="list-disc list-inside mt-1 space-y-0.5 opacity-90">
                  <li><strong>Gmail:</strong> Enable 2FA → Go to Security → Search "App Passwords"</li>
                  <li><strong>Outlook/Office365:</strong> Security Info → Add Method → App Password</li>
                  <li><strong>Zoho:</strong> Account → Security → App Passwords</li>
                </ul>
                <p className="mt-1">Do not use your regular login password if 2FA is on.</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Email Address</label>
                <Input
                  type="email"
                  placeholder="your-email@company.com"
                  value={config.email}
                  onChange={(e) => {
                    const val = e.target.value;
                    setConfig({ ...config, email: val });
                    if (val.includes('@') && val.split('@')[1]?.length > 3) {
                      handleDiscover(val, true);
                    }
                  }}
                  onBlur={() => handleDiscover(config.email)}
                  className="font-mono text-sm"
                />
              </div>

              {discovering && (
                <div className="flex items-center gap-2 text-[10px] text-cyan-600 animate-pulse">
                   <div className="w-2 h-2 rounded-full bg-cyan-600"></div>
                   Checking for provider settings...
                </div>
              )}

              {appPasswordGuide && (
                <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg p-4 space-y-3 animate-in slide-in-from-top-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-indigo-500" />
                    <p className="text-xs font-bold text-indigo-700 dark:text-indigo-400">
                      {appPasswordGuide.provider} Guide
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {appPasswordGuide.instructions}
                  </p>
                  <ul className="text-[11px] space-y-1.5 list-disc list-inside text-muted-foreground ml-1">
                    {appPasswordGuide.steps.map((step: string, i: number) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ul>
                  <Button 
                    variant="ghost" 
                    className="p-0 h-auto text-xs text-indigo-600 font-bold hover:bg-transparent underline underline-offset-4"
                    onClick={() => window.open(appPasswordGuide.link, '_blank')}
                  >
                    Open Security Settings <ArrowRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">Display Name <span className="text-xs text-muted-foreground">(optional — shown as sender name)</span></label>
                <Input
                  placeholder="Your Name or Business Name"
                  value={config.fromName}
                  onChange={(e) => setConfig({ ...config, fromName: e.target.value })}
                  className="text-sm"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium">
                    {passwordType === 'app_password' ? 'App Password' : 'Mailbox Password'}
                  </label>
                  <button
                    type="button"
                    onClick={() => setPasswordType(passwordType === 'app_password' ? 'mailbox_password' : 'app_password')}
                    className="text-[10px] font-bold underline underline-offset-2 decoration-dotted hover:text-primary transition-colors"
                  >
                    <span className={passwordType === 'mailbox_password' ? 'text-primary' : 'text-muted-foreground hover:text-primary'}>
                      Switch to {passwordType === 'app_password' ? 'Mailbox Password' : 'App Password'}
                    </span>
                  </button>
                </div>
                <Input
                  type="password"
                  placeholder={passwordType === 'app_password' ? "Your app-specific password (16+ characters)" : "Your mailbox password"}
                  value={config.password}
                  onChange={(e) => setConfig({ ...config, password: e.target.value })}
                  className="font-mono text-sm"
                />
                {passwordType === 'mailbox_password' && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Using your regular mailbox password. If 2FA is enabled, you may need to switch to App Password.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between pb-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Connection Settings</p>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-auto p-0 text-[10px] text-cyan-600 hover:bg-transparent underline underline-offset-4 font-bold"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  {showAdvanced ? 'Hide Advanced' : 'Show Advanced Settings'}
                </Button>
              </div>

              {showAdvanced && (
                <div className="space-y-3 p-3 bg-black/5 rounded-lg border border-border/50 animate-in fade-in zoom-in-95 duration-200">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">SMTP Host (Sending)</label>
                      <Input
                        placeholder="smtp.office365.com"
                        value={config.smtpHost}
                        onChange={(e) => setConfig({ ...config, smtpHost: e.target.value })}
                        className="font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">SMTP Port</label>
                      <Input
                        type="number"
                        placeholder="587"
                        value={config.smtpPort}
                        onChange={(e) => setConfig({ ...config, smtpPort: parseInt(e.target.value) || 587 })}
                        className="font-mono text-sm"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">Common: 587 (TLS), 465 (SSL)</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">IMAP Host (Reading)</label>
                      <Input
                        placeholder="imap.office365.com"
                        value={config.imapHost}
                        onChange={(e) => setConfig({ ...config, imapHost: e.target.value })}
                        className="font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">IMAP Port</label>
                      <Input
                        type="number"
                        placeholder="993"
                        value={config.imapPort}
                        onChange={(e) => setConfig({ ...config, imapPort: parseInt(e.target.value) || 993 })}
                        className="font-mono text-sm"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">Standard IMAP: 993</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Verification Steps Progress */}
            {testingConnection && verificationResults.length > 0 && (
              <div className="bg-cyan-500/5 border border-cyan-500/20 rounded p-3 space-y-2">
                <p className="text-xs font-medium text-cyan-600 dark:text-cyan-400 mb-2">
                  ⚡ Verification Progress
                </p>
                {verificationResults.map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {step.status === 'pending' && (
                      <div className="w-4 h-4 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin" />
                    )}
                    {step.status === 'success' && (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    )}
                    {step.status === 'failed' && (
                      <AlertCircle className="w-4 h-4 text-red-500" />
                    )}
                    <span className={
                      step.status === 'success' ? 'text-green-600 dark:text-green-400' :
                      step.status === 'failed' ? 'text-red-600 dark:text-red-400' :
                      'text-cyan-600 dark:text-cyan-400'
                    }>
                      {step.step}
                    </span>
                    {step.message && (
                      <span className="text-muted-foreground ml-1">- {step.message}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* DNS Warnings */}
            {dnsWarnings.length > 0 && (
              <div className="bg-red-500/10 border border-red-500/30 rounded p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500" />
                  <p className="text-sm font-bold text-red-700 dark:text-red-400">DNS Configuration Warning</p>
                </div>
                <ul className="text-xs text-red-600 dark:text-red-300 list-disc list-inside ml-1">
                  {dnsWarnings.map((warning, i) => (
                    <li key={i}>{warning}</li>
                  ))}
                </ul>
                <p className="text-[11px] text-red-600/80 mt-1">Your emails are highly likely to be marked as spam. Please configure your domain's DNS records.</p>
              </div>
            )}

            {/* Import Progress */}
            {importing && (
              <div className="bg-amber-500/5 border border-amber-500/20 rounded p-3 space-y-2">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  ⏳ {connectionStep || 'Importing your contacts...'}
                </p>
                <Progress value={importProgress} className="h-2" />
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {importProgress}% complete • This usually takes 30-60 seconds
                </p>
              </div>
            )}

            {/* Results */}
            {importStats.imported > 0 && (
              <div className="bg-green-500/5 border border-green-500/20 rounded p-3">
                <p className="text-sm font-medium text-green-700 dark:text-green-400 mb-2">
                  ✅ Import Complete
                </p>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="font-bold text-lg text-green-600 dark:text-green-400">
                      {importStats.imported}
                    </p>
                    <p className="text-gray-600 dark:text-gray-400">Imported</p>
                  </div>
                  <div>
                    <p className="font-bold text-lg text-amber-600 dark:text-amber-400">
                      {importStats.skipped}
                    </p>
                    <p className="text-gray-600 dark:text-gray-400">Skipped</p>
                  </div>
                  <div>
                    <p className="font-bold text-lg text-red-600 dark:text-red-400">
                      {importStats.errors}
                    </p>
                    <p className="text-gray-600 dark:text-gray-400">Errors</p>
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleShowFilterInfo}
                disabled={connecting || importing || testingConnection}
                className="flex-1 bg-cyan-600 hover:bg-cyan-700"
              >
                {connecting || importing || testingConnection ? (
                  <>⏳ {testingConnection ? 'Testing...' : 'Connecting...'}</>
                ) : (
                  <>
                    <Mail className="w-4 h-4 mr-2" />
                    Connect & Import
                  </>
                )}
              </Button>
              {showSetup && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowSetup(false);
                    setConfig({ smtpHost: '', smtpPort: 587, imapHost: '', imapPort: 993, email: '', password: '', fromName: '' });
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info Banner */}
      <div className="bg-blue-500/5 border border-blue-500/30 rounded p-3 text-sm text-blue-700 dark:text-blue-400">
        <p>
          💡 <strong>Available to all users:</strong> Connect your business email (work@yourcompany.com) immediately after signup.
          No limits on email channel, no paid plan required. Your contacts will be auto-imported and campaigns start right away.
        </p>
      </div>

      {/* Filter Intelligence Modal */}
      {showFilterInfo && (
        <EmailFilterIntelligence
          onAcknowledge={handleConnect}
          isLoading={importing}
        />
      )}
    </div>
  );
}
