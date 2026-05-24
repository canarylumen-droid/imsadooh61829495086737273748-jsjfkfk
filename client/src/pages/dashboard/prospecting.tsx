import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Search, Download, CheckCircle, XCircle, Loader2, Zap, Globe, Mail, Phone, MapPin, Terminal, Activity, AlertTriangle, ShieldCheck, Target } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUser } from '@/hooks/use-user';
import { useRealtime } from '@/hooks/use-realtime';
import { useMailbox } from '@/hooks/use-mailbox';
import { ScraperConsole } from '@/components/dashboard/ScraperConsole';
import { cn } from '@/lib/utils';
import { PageWrapper } from "@/components/ui/page-wrapper";
import { ResponsiveGrid } from "@/components/ui/responsive-grid";

interface Prospect {
    id: string;
    entity: string;
    email: string;
    phone?: string;
    location?: string;
    website: string;
    platforms: string[];
    socialProfiles?: Record<string, string>;
    wealthSignal: string;
    leadScore: number;
    verified: boolean;
    status: string;
    estimatedRevenue?: string;
    role?: string;
    metadata?: any;
}

interface LogMessage {
    id: string;
    text: string;
    type: 'info' | 'success' | 'warning' | 'error' | 'raw';
    timestamp: Date;
}

export default function ProspectingPage() {
    const { data: user } = useUser();
    const [query, setQuery] = useState('');
    const [logs, setLogs] = useState<LogMessage[]>([]);
    const [showConsole, setShowConsole] = useState(false);
    const { socket } = useRealtime();
    const { selectedMailboxId } = useMailbox();

    // Fetch leads
    const { data: leads = [], refetch, isLoading: leadsLoading } = useQuery<Prospect[]>({
        queryKey: ['prospects', { integrationId: selectedMailboxId }],
        queryFn: async () => {
            const res = await fetch(`/api/prospecting/leads?integrationId=${selectedMailboxId || ''}`, {
                credentials: 'include'
            });
            if (!res.ok) throw new Error('Failed to fetch leads');
            return res.json();
        }
    });

    // Start scan mutation
    const scanMutation = useMutation({
        mutationFn: async (query: string) => {
            setLogs([]); // Reset logs
            const res = await fetch('/api/prospecting/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ query, integrationId: selectedMailboxId })
            });
            if (!res.ok) throw new Error('Failed to start scan');
            return res.json();
        },
        onSuccess: () => {
            setShowConsole(true);
            setLogs([{ id: 'init', text: '[System] Search system initialized. Establishing secure connections...', type: 'info', timestamp: new Date() }]);
        }
    });

    // WebSocket connection
    useEffect(() => {
        if (!socket) return;

        const handleLog = (payload: any) => {
            setLogs(prev => [...prev, {
                id: payload.id || crypto.randomUUID(),
                text: payload.text,
                type: payload.type,
                timestamp: new Date(payload.timestamp || Date.now())
            }]);
        };

        const handleFound = () => refetch();
        const handleUpdated = () => refetch();

        socket.on('PROSPECTING_LOG', handleLog);
        socket.on('PROSPECT_FOUND', handleFound);
        socket.on('PROSPECT_UPDATED', handleUpdated);

        return () => {
            socket.off('PROSPECTING_LOG', handleLog);
            socket.off('PROSPECT_FOUND', handleFound);
            socket.off('PROSPECT_UPDATED', handleUpdated);
        };
    }, [socket, refetch]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;
        scanMutation.mutate(query);
    };

    const downloadCSV = () => {
        const headers = ['Entity', 'Email', 'Phone', 'Location', 'Website', 'Intensity', 'Score', 'Signal', 'Revenue', 'Role', 'Instagram', 'LinkedIn', 'YouTube', 'X (Twitter)', 'Facebook', 'TikTok'];
        const rows = leads.map(lead => [
            lead.entity,
            lead.email,
            lead.phone || '',
            lead.location || '',
            lead.website,
            lead.metadata?.temperature || '',
            lead.leadScore,
            lead.wealthSignal,
            lead.estimatedRevenue || '',
            lead.role || '',
            lead.socialProfiles?.instagram || '',
            lead.socialProfiles?.linkedin || '',
            lead.socialProfiles?.youtube || '',
            lead.socialProfiles?.twitter || lead.socialProfiles?.x || '',
            lead.socialProfiles?.facebook || '',
            lead.socialProfiles?.tiktok || ''
        ]);

        const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `prospects_${Date.now()}.csv`;
        a.click();
    };

    const [filterStatus, setFilterStatus] = useState<string>('all');

    const filteredLeads = leads.filter(lead => {
        if (filterStatus === 'all') return true;
        if (filterStatus === 'hardened') return lead.status === 'hardened' || lead.verified;
        if (filterStatus === 'recovered') return lead.status === 'recovered';
        if (filterStatus === 'bouncy') return lead.status === 'bouncy';
        return true;
    });

    return (
        <PageWrapper className="pb-20">
            <div className="max-w-7xl mx-auto space-y-8">
                {/* Header */}
                <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-8">
                    <div className="space-y-1 text-center md:text-left">
                        <div className="flex flex-col md:flex-row items-center gap-3">
                            <h2 className="text-2xl font-bold tracking-tight text-white">Prospecting Intelligence</h2>
                            <div className="px-2.5 py-0.5 rounded-full bg-primary/15 border border-primary/20 flex items-center gap-1.5 shadow-[0_0_15px_rgba(0,180,255,0.1)]">
                                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                                <span className="text-[10px] font-semibold text-primary uppercase tracking-wider leading-none">Import Active</span>
                            </div>
                        </div>
                        <p className="text-muted-foreground text-sm max-w-lg font-medium tracking-tight">Enterprise Infrastructure • Worldwide Coverage • Real-Time Data Verification</p>
                    </div>
                    <div className="flex items-center justify-center md:justify-end gap-3">
                        <Button
                            onClick={downloadCSV}
                            disabled={leads.length === 0}
                            variant="outline"
                            className="rounded-xl border-white/10 bg-white/5 hover:bg-white/10 transition-all font-semibold text-xs h-11 flex-1 md:flex-none"
                        >
                            <Download className="w-4 h-4 mr-2 text-primary" />
                            Export ({leads.length})
                        </Button>
                        <Button
                            onClick={() => setShowConsole(true)}
                            className="rounded-xl bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-all font-semibold text-xs h-11 flex-1 md:flex-none"
                        >
                            <Terminal className="w-4 h-4 mr-2" />
                            Console
                        </Button>
                    </div>
                </div>

                {/* Gemini-Style AI Input */}
                <div className="relative max-w-4xl mx-auto mt-12 mb-16 group">
                    {/* Atmospheric Glow */}
                    <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-500 rounded-3xl opacity-20 group-hover:opacity-40 blur-xl transition-all duration-500" />

                    <Card className="relative bg-[#0a0a0a]/90 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-xl">
                        <CardContent className="p-2">
                            <form onSubmit={handleSearch} className="relative flex items-center">
                                <div className="pl-6 pr-4">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20 animate-pulse-slow">
                                        <Zap className="w-5 h-5 text-white fill-white" />
                                    </div>
                                </div>

                                <Input
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    disabled={scanMutation.isPending}
                                    placeholder="Search verified business database (e.g., 'Miami Real Estate')..."
                                    className="h-20 bg-transparent border-none text-xl md:text-2xl text-white placeholder:text-white/20 focus-visible:ring-0 focus-visible:ring-offset-0 font-medium px-2"
                                />

                                <div className="pr-4 flex items-center gap-3">
                                    {scanMutation.isPending ? (
                                        <div className="flex items-center gap-3 px-4 py-2 bg-white/5 rounded-full border border-white/5">
                                            <Loader2 className="w-5 h-5 text-primary animate-spin" />
                                            <span className="text-xs font-bold text-primary uppercase tracking-wider animate-pulse">Scanning</span>
                                        </div>
                                    ) : (
                                        <Button
                                            type="submit"
                                            disabled={!query.trim()}
                                            className="w-12 h-12 rounded-xl bg-white text-black hover:bg-blue-50 hover:scale-105 transition-all shadow-[0_0_20px_rgba(255,255,255,0.3)] disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center p-0"
                                        >
                                            <Search className="w-6 h-6" />
                                        </Button>
                                    )}
                                </div>
                            </form>


                        </CardContent>

                        {/* Progress Bar (Bottom) */}
                        {scanMutation.isPending && (
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/5">
                                <div className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500 animate-shimmer w-full" />
                            </div>
                        )}
                    </Card>

                    {/* Helper Text */}
                    <div className="absolute -bottom-10 left-0 right-0 text-center">
                        <p className="text-xs text-white/30 font-medium">
                            <span className="text-primary">Tip:</span> Be specific about location and niche for higher verification rates.
                        </p>
                    </div>
                </div>

                {/* Stats Summary Row */}
                <ResponsiveGrid className="md:grid-cols-4 gap-4">
                    {[
                        { label: 'Network Size', value: leads.length, color: 'text-white', id: 'all' },
                        { label: 'Hardened', value: leads.filter(l => l.status === 'hardened' || l.verified).length, color: 'text-emerald-400', id: 'hardened' },
                        { label: 'Recoveries', value: leads.filter(l => l.status === 'recovered').length, color: 'text-cyan-400', id: 'recovered' },
                        { label: 'Bouncy', value: leads.filter(l => l.status === 'bouncy').length, color: 'text-red-400', id: 'bouncy' }
                    ].map((stat, i) => (
                        <button
                            key={i}
                            onClick={() => setFilterStatus(stat.id)}
                            className={cn(
                                "p-4 rounded-xl bg-white/[0.03] border backdrop-blur-sm group hover:border-primary/30 transition-all text-left w-full",
                                filterStatus === stat.id ? "border-primary/50 bg-primary/5" : "border-white/5"
                            )}
                        >
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1 group-hover:text-primary transition-colors">{stat.label}</p>
                            <p className={`text-2xl font-bold tracking-tight ${stat.color}`}>{stat.value}</p>
                        </button>
                    ))}
                </ResponsiveGrid>
            </div>

            {/* Results Table */}
            {leadsLoading ? (
                <div className="space-y-4">
                    {[1, 2, 3].map(i => (
                        <Card key={i} className="bg-muted/10 border-white/5 rounded-2xl p-6 animate-pulse">
                            <div className="flex items-start justify-between">
                                <div className="space-y-3 flex-1">
                                    <div className="h-6 w-48 rounded bg-muted/20" />
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="h-4 w-full rounded bg-muted/20" />
                                        <div className="h-4 w-full rounded bg-muted/20" />
                                    </div>
                                    <div className="h-4 w-32 rounded bg-muted/20" />
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            ) : leads.length > 0 ? (
                <Card className="bg-[#030303]/80 backdrop-blur-3xl border-white/5 rounded-2xl overflow-hidden relative intelligence-panel">
                    {/* HUD Decorations */}
                    <div className="hud-corner hud-corner-tl opacity-60" />
                    <div className="hud-corner hud-corner-tr opacity-30" />
                    <div className="hud-corner hud-corner-bl opacity-60" />
                    <div className="hud-corner hud-corner-br opacity-30" />

                    <CardHeader className="px-10 py-8 border-b border-white/5">
                        <CardTitle className="text-white text-lg font-bold tracking-tight flex items-center gap-3">
                            <Activity className="w-5 h-5 text-primary" />
                            Verified Leads List ({leads.length})
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {filteredLeads.map((lead) => (
                                <motion.div
                                    key={lead.id}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="p-6 bg-muted/10 border border-border/20 rounded-2xl hover:bg-muted/20 transition-all"
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="space-y-3 flex-1">
                                            <div className="flex items-center gap-3">
                                                <h3 className="text-lg font-bold text-foreground">{lead.entity}</h3>
                                                {lead.metadata?.temperature && (
                                                    <Badge className={`${lead.metadata.temperature.includes('HOT') ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' : 'bg-blue-500/20 text-blue-400 border-blue-500/30'}`}>
                                                        {lead.metadata.temperature}
                                                    </Badge>
                                                )}
                                                {lead.verified && (
                                                    <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                                                        <CheckCircle className="w-3 h-3 mr-1" />
                                                        Verified
                                                    </Badge>
                                                )}
                                                <Badge className="bg-primary/20 text-primary border-primary/30">
                                                    Score: {lead.leadScore}%
                                                </Badge>

                                                {/* Never Bounce / Deliverability Status */}
                                                {lead.status === 'bouncy' ? (
                                                    <Badge className="bg-red-500/20 text-red-400 border-red-500/30 font-semibold tracking-wider text-[9px] uppercase">
                                                        <XCircle className="w-3 h-3 mr-1" />
                                                        Bouncy / Invalid
                                                    </Badge>
                                                ) : lead.status === 'recovered' ? (
                                                    <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 font-semibold tracking-wider text-[9px] uppercase animate-pulse">
                                                        <Zap className="w-3 h-3 mr-1" />
                                                        Deliverability Fix
                                                    </Badge>
                                                ) : lead.verified ? (
                                                    <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-semibold tracking-wider text-[9px] uppercase">
                                                        <ShieldCheck className="w-3 h-3 mr-1" />
                                                        Verified & Safe
                                                    </Badge>
                                                ) : null}

                                                {!lead.website && (
                                                    <Badge className="bg-red-500/20 text-red-400 border-red-500/30 font-semibold tracking-wide shadow-[0_0_10px_rgba(239,68,68,0.1)]">
                                                        GHOST (No Website)
                                                    </Badge>
                                                )}
                                                {lead.metadata?.painPoint && (
                                                    <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">
                                                        {lead.metadata.painPoint}
                                                    </Badge>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-2 gap-4 text-sm">
                                                <div className="flex items-center gap-2 text-muted-foreground font-medium">
                                                    <Mail className="w-4 h-4" />
                                                    {lead.email}
                                                </div>
                                                {lead.phone && (
                                                    <div className="flex items-center gap-2 text-muted-foreground font-medium">
                                                        <Phone className="w-4 h-4" />
                                                        {lead.phone}
                                                    </div>
                                                )}
                                                {lead.location && (
                                                    <div className="flex items-center gap-2 text-muted-foreground font-medium">
                                                        <MapPin className="w-4 h-4" />
                                                        {lead.location}
                                                    </div>
                                                )}
                                                {lead.website && (
                                                    <div className="flex items-center gap-2 text-muted-foreground font-medium">
                                                        <Globe className="w-4 h-4" />
                                                        <a href={lead.website} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                                                            {lead.website.length > 40 ? `${lead.website.substring(0, 40)}...` : lead.website}
                                                        </a>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Dynamic Metadata Intelligence */}
                                            {lead.metadata && (
                                                <div className="flex flex-wrap gap-2 pt-2">
                                                    {Object.entries(lead.metadata).map(([key, val]: [string, any]) => {
                                                        if (key.endsWith('_type')) return null;
                                                        const type = lead.metadata[`${key}_type`];
                                                        if (!type && !val?.toString().includes('http')) return null;
                                                        
                                                        const label = key.replace(/_/g, ' ');
                                                        return (
                                                            <a
                                                                key={key}
                                                                href={val}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="px-3 py-1.5 bg-primary/5 hover:bg-primary/10 border border-primary/20 rounded-xl text-[10px] font-semibold uppercase tracking-wider text-primary transition-all flex items-center gap-2"
                                                            >
                                                                {type === 'google_maps' ? <MapPin className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
                                                                {label}
                                                            </a>
                                                        );
                                                    })}
                                                </div>
                                            )}

                                            {lead.socialProfiles && Object.keys(lead.socialProfiles).length > 0 && (
                                                <div className="flex gap-2">
                                                    {Object.entries(lead.socialProfiles).map(([platform, url]) => (
                                                        <a
                                                            key={platform}
                                                            href={url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="px-3 py-1 bg-muted/50 hover:bg-muted border border-border/40 rounded-lg text-xs text-muted-foreground hover:text-primary transition-colors font-medium"
                                                        >
                                                            {platform}
                                                        </a>
                                                    ))}
                                                </div>
                                            )}

                                            <div className="flex gap-2">
                                                {lead.role && (
                                                    <Badge variant="outline" className="text-xs">{lead.role}</Badge>
                                                )}
                                                {lead.estimatedRevenue && (
                                                    <Badge variant="outline" className="text-xs">{lead.estimatedRevenue}</Badge>
                                                )}
                                                <Badge variant="outline" className="text-xs">{lead.wealthSignal}</Badge>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <Card className="bg-card/50 backdrop-blur-sm border-border/40 rounded-2xl">
                    <CardContent className="p-12 text-center">
                        <div className="text-muted-foreground/40 text-sm font-medium">No leads yet. Start a new search to discover prospects.</div>
                    </CardContent>
                </Card>
            )}

            {/* Intelligence Scraper Console Overlay */}
            <ScraperConsole
                isVisible={showConsole}
                onClose={() => setShowConsole(false)}
                logs={logs}
            />
        </PageWrapper>
    );
}
