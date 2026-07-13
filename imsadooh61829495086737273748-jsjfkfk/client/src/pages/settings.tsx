import React from 'react';
import { DashboardLayout } from '../components/dashboard/DashboardLayout';
import { EmailSetupUI } from '../components/email-setup-ui';
import { CalendlyConnectUI } from '../components/calendly-connect-ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';

export function SettingsPage() {
  return (
    <DashboardLayout>
      <div className="space-y-8 animate-in fade-in duration-500 p-4 md:p-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/40 pb-8">
          <div className="space-y-1">
            <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent tracking-tight">
              Settings
            </h1>
            <p className="text-muted-foreground text-lg">Manage your business integrations and outreach core.</p>
          </div>
        </div>

        <Tabs defaultValue="email" className="w-full">
          <TabsList className="bg-muted/30 p-1.5 rounded-2xl border border-border/40 inline-flex mb-8">
            <TabsTrigger value="email" className="px-8 py-3 rounded-xl data-[state=active]:bg-background data-[state=active]:shadow-lg transition-all font-semibold">📧 Email Core</TabsTrigger>
            <TabsTrigger value="calendar" className="px-8 py-3 rounded-xl data-[state=active]:bg-background data-[state=active]:shadow-lg transition-all font-semibold">📅 Scheduling</TabsTrigger>
          </TabsList>

          <TabsContent value="email" className="animate-in slide-in-from-bottom-2 duration-300">
            <Card className="bg-card/40 border-border/40 overflow-hidden rounded-3xl backdrop-blur-xl">
              <CardHeader className="border-b border-border/40 bg-muted/20 p-8">
                <CardTitle className="text-2xl font-bold">Global Outreach SMTP</CardTitle>
                <CardDescription className="text-base">
                  Configure your high-delivery mail server for automated prospecting.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="p-8">
                  <EmailSetupUI />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="calendar" className="animate-in slide-in-from-bottom-2 duration-300">
            <Card className="bg-card/40 border-border/40 overflow-hidden rounded-3xl backdrop-blur-xl">
              <CardHeader className="border-b border-border/40 bg-muted/20 p-8">
                <CardTitle className="text-2xl font-bold">Calendly Connection</CardTitle>
                <CardDescription className="text-base">
                  Connect your scheduling links to automatically book calls when leads are ready.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="p-8">
                  <CalendlyConnectUI />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
