import React, { useState } from 'react';
import { VideoAutomationGrid } from '@/components/ui/interactive/VideoAutomationGrid';
import { IntegrationStateButton } from '@/components/ui/interactive/IntegrationStateButton';
import { PremiumPagination } from '@/components/ui/interactive/PremiumPagination';
import { InboxSkeleton } from '@/components/ui/interactive/InboxSkeleton';
import { useContextMenu, CustomContextMenu } from '@/components/ui/interactive/CustomContextMenu';
import { Plus, LayoutGrid, MessageSquare, Settings2 } from 'lucide-react';

export function ComponentShowcase() {
    // Demo State
    const [loadingVideos, setLoadingVideos] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const { contextConfig, handleContextMenu, closeMenu } = useContextMenu();

    // Simulate video loading
    React.useEffect(() => {
        const timer = setTimeout(() => setLoadingVideos(false), 3000);
        return () => clearTimeout(timer);
    }, []);

    return (
        <div
            className="p-8 space-y-12 min-h-screen bg-background/50"
            onContextMenu={(e) => handleContextMenu(e, 'dashboard')}
        >

            {/* Header */}
            <div className="flex flex-col gap-2 mb-8">
                <h1 className="text-3xl font-bold tracking-tight">UI Component Library</h1>
                <p className="text-muted-foreground">
                    Premium, lightweight components for the enterprise dashboard.
                    <span className="text-xs ml-2 bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20">
                        Right-click anywhere to see Context Menu
                    </span>
                </p>
            </div>

            {/* 1. Integration Buttons */}
            <section className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                    <Settings2 className="w-5 h-5 text-primary" />
                    <h2 className="text-xl font-semibold">1. Integration Success Flows</h2>
                </div>
                <div className="p-6 border border-border/50 rounded-xl bg-card/30 backdrop-blur-sm grid gap-8 md:grid-cols-2">
                    <div className="space-y-4">
                        <h3 className="text-sm font-medium text-muted-foreground">Email Integration</h3>
                        <div className="flex items-center justify-between p-4 border border-border/50 rounded-lg bg-background/50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-500">
                                    @
                                </div>
                                <div>
                                    <div className="font-medium">Gmail Account</div>
                                    <div className="text-xs text-muted-foreground">Connect your inbox</div>
                                </div>
                            </div>
                            <IntegrationStateButton
                                label="Connect Gmail"
                                successLabel="Linked"
                                className="w-32"
                            />
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-sm font-medium text-muted-foreground">Instagram Integration</h3>
                        <div className="flex items-center justify-between p-4 border border-border/50 rounded-lg bg-background/50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-pink-500/20 flex items-center justify-center text-pink-500">
                                    IG
                                </div>
                                <div>
                                    <div className="font-medium">Instagram Business</div>
                                    <div className="text-xs text-muted-foreground">Link for auto-DMs</div>
                                </div>
                            </div>
                            <IntegrationStateButton
                                label="Connect IG"
                                successLabel="Active"
                                className="w-32"
                            />
                        </div>
                    </div>
                </div>
            </section>

            {/* 2. Video Automation Grid */}
            <section className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-border/50">
                    <div className="flex items-center gap-2">
                        <LayoutGrid className="w-5 h-5 text-primary" />
                        <h2 className="text-xl font-semibold">2. Video Automation Grid</h2>
                    </div>
                    <button
                        onClick={() => setLoadingVideos(!loadingVideos)}
                        className="text-xs text-primary hover:underline"
                    >
                        Toggle Skeleton Loading
                    </button>
                </div>
                <div className="p-6 border border-border/50 rounded-xl bg-card/30 backdrop-blur-sm">
                    <VideoAutomationGrid
                        loading={loadingVideos}
                        onSelect={(v) => console.log('Selected video:', v.title)}
                        onContextMenu={(e, video) => handleContextMenu(e, 'video', video)}
                    />
                </div>
            </section>

            {/* 3. Inbox Loading State */}
            <section
                className="space-y-4"
                onContextMenu={(e) => handleContextMenu(e, 'inbox')}
            >
                <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                    <MessageSquare className="w-5 h-5 text-primary" />
                    <h2 className="text-xl font-semibold">3. Inbox Skeleton Loader</h2>
                </div>
                <div className="h-[500px] border border-border/50 rounded-xl overflow-hidden relative">
                    <InboxSkeleton />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/10 backdrop-blur-[1px] pointer-events-none">
                        <span className="bg-background/80 px-4 py-2 rounded-full border border-border text-xs font-mono">
                            Loading State Preview
                        </span>
                    </div>
                </div>
            </section>

            {/* 4. Pagination */}
            <section className="space-y-4 pb-20">
                <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                    <Plus className="w-5 h-5 text-primary" />
                    <h2 className="text-xl font-semibold">4. Premium Pagination</h2>
                </div>
                <div className="flex items-center justify-center p-12 border border-border/50 rounded-xl bg-card/30 backdrop-blur-sm">
                    <PremiumPagination
                        currentPage={currentPage}
                        totalPages={10}
                        onPageChange={setCurrentPage}
                    />
                </div>
            </section>

            {/* Global Context Menu */}
            <CustomContextMenu
                config={contextConfig}
                onClose={closeMenu}
                onAction={(id) => console.log('Context Action:', id)}
            />

        </div>
    );
}
