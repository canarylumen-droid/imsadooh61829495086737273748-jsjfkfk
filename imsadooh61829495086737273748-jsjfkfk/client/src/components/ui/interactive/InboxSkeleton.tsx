import React from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton'; // Assuming shadcn skeleton exists, if not I'll use standard div

export function MessageItemSkeleton() {
    return (
        <div className="flex items-center gap-4 p-4 border-b border-border/40">
            {/* Avatar Skeleton */}
            <div className="h-10 w-10 rounded-full bg-muted/50 animate-pulse shrink-0" />

            {/* Text Skeleton */}
            <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                    <div className="h-4 w-24 bg-muted/50 rounded animate-pulse" />
                    <div className="h-3 w-12 bg-muted/30 rounded animate-pulse" />
                </div>
                <div className="h-3 w-3/4 bg-muted/30 rounded animate-pulse" />
            </div>
        </div>
    );
}

export function ChatAreaSkeleton() {
    return (
        <div className="flex flex-col h-full bg-background/50">
            {/* Header */}
            <div className="h-16 border-b border-border/40 flex items-center px-6 gap-4">
                <div className="h-10 w-10 rounded-full bg-muted/50 animate-pulse" />
                <div className="space-y-2">
                    <div className="h-4 w-32 bg-muted/50 rounded animate-pulse" />
                    <div className="h-3 w-20 bg-muted/30 rounded animate-pulse" />
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 p-6 space-y-6 overflow-hidden">
                {/* Received Message */}
                <div className="flex gap-4 max-w-[80%]">
                    <div className="h-8 w-8 rounded-full bg-muted/50 shrink-0 mt-1" />
                    <div className="space-y-2 w-full">
                        <div className="h-10 w-full bg-muted/40 rounded-2xl rounded-tl-none animate-pulse" />
                        <div className="h-4 w-12 bg-muted/20 rounded ml-1" />
                    </div>
                </div>

                {/* Sent Message */}
                <div className="flex gap-4 max-w-[80%] ml-auto flex-row-reverse">
                    <div className="h-8 w-8 rounded-full bg-primary/20 shrink-0 mt-1" />
                    <div className="space-y-2 w-full">
                        <div className="h-16 w-full bg-primary/10 rounded-2xl rounded-tr-none animate-pulse" />
                        <div className="h-4 w-12 bg-muted/20 rounded ml-auto mr-1" />
                    </div>
                </div>

                {/* Received Message 2 */}
                <div className="flex gap-4 max-w-[60%]">
                    <div className="h-8 w-8 rounded-full bg-muted/50 shrink-0 mt-1" />
                    <div className="space-y-2 w-full">
                        <div className="h-8 w-full bg-muted/40 rounded-2xl rounded-tl-none animate-pulse" />
                    </div>
                </div>
            </div>

            {/* Input Area */}
            <div className="h-20 border-t border-border/40 p-4">
                <div className="h-12 w-full bg-muted/20 rounded-xl animate-pulse" />
            </div>
        </div>
    );
}

export function InboxSkeleton() {
    return (
        <div className="flex h-[calc(100vh-64px)] overflow-hidden">
            {/* Sidebar List */}
            <div className="w-80 border-r border-border/40 bg-card/30 hidden md:block">
                <div className="h-16 border-b border-border/40 px-4 flex items-center">
                    <div className="h-8 w-full bg-muted/30 rounded-lg animate-pulse" />
                </div>
                <div className="flex flex-col">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <MessageItemSkeleton key={i} />
                    ))}
                </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1">
                <ChatAreaSkeleton />
            </div>
        </div>
    );
}
