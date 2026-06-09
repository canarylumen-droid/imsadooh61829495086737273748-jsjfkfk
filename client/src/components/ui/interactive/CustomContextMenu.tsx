import React, { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { queryClient } from '@/lib/queryClient';
import { Scissors, Copy, ClipboardPaste, Link2, Download, Trash2, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ContextMenuConfig {
    x: number;
    y: number;
    visible: boolean;
    type?: 'default' | 'video' | 'inbox' | 'dashboard';
    data?: any;
}

interface CustomContextMenuProps {
    targetId?: string; // Optional: ID of container to attach to. If null, global.
    onClose: () => void;
    config: ContextMenuConfig;
    onAction?: (action: string, data?: any) => void;
}

export function CustomContextMenu({
    config,
    onClose,
    onAction
}: CustomContextMenuProps) {

    // Close on click outside
    useEffect(() => {
        const handleClick = () => onClose();
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, [onClose]);

    if (!config.visible) return null;

    interface MenuItem {
        icon?: any;
        label?: string;
        shortcut?: string;
        id?: string;
        type?: 'divider';
        variant?: 'destructive';
    }

    // Default items
    let menuItems: MenuItem[] = [
        { icon: Scissors, label: 'Cut', shortcut: '⌘X', id: 'cut' },
        { icon: Copy, label: 'Copy', shortcut: '⌘C', id: 'copy' },
        { icon: ClipboardPaste, label: 'Paste', shortcut: '⌘V', id: 'paste' },
    ];

    // Context-specific items
    if (config.type === 'video') {
        const videoItems: MenuItem[] = [
            { type: 'divider' },
            { icon: Link2, label: 'Copy Video URL', id: 'copy_link' },
            { icon: Download, label: 'Automate Processing', id: 'automate_video' }, // Specific to video
            { icon: Download, label: 'Download Thumbnail', id: 'save_thumbnail' },
        ];
        menuItems = [...menuItems, ...videoItems];
    } else if (config.type === 'inbox') {
        const isArchived = config.data?.archived;
        const inboxItems: MenuItem[] = [
            { type: 'divider' },
            { icon: Link2, label: 'Mark as Unread', id: 'mark_unread' },
            { icon: ClipboardPaste, label: 'Mark as Booked', id: 'mark_booked' },
            { icon: Copy, label: 'Copy Details', id: 'copy_details' },
            { 
              icon: isArchived ? RefreshCw : Trash2, 
              label: isArchived ? 'Unarchive Thread' : 'Archive Thread', 
              id: isArchived ? 'unarchive' : 'archive' 
            },
            { icon: Trash2, label: 'Delete Thread', id: 'delete', variant: 'destructive' },
        ];
        menuItems = [...menuItems, ...inboxItems];
    } else {
        // Default / Dashboard
        const defaultExtras: MenuItem[] = [
            { type: 'divider' },
            { icon: Link2, label: 'Copy Page Link', id: 'copy_link' },
            { icon: Download, label: 'Export Leads (CSV)', id: 'export_data' },
            { icon: Scissors, label: 'Refresh Feed', id: 'refresh' },
        ];
        menuItems = [...menuItems, ...defaultExtras];
    }

    const menuX = Math.min(config.x, window.innerWidth - 270);
    const menuY = Math.min(config.y, window.innerHeight - 400);

    return (
        <AnimatePresence>
            {config.visible && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -10 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    style={{
                        top: menuY,
                        left: menuX
                    }}
                    className="fixed z-[999999] w-64 min-w-[200px] bg-background/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] p-2 overflow-hidden"
                    onContextMenu={(e) => e.preventDefault()}
                    onClick={(e) => e.stopPropagation()} // Prevent closing when clicking menu itself
                >
                    <div className="flex flex-col space-y-0.5">
                        {menuItems.map((item, index) => {
                            if (item.type === 'divider') {
                                return <div key={`div-${index}`} className="h-px bg-white/5 my-1.5 mx-2" />;
                            }

                            const Icon = item.icon as React.ElementType;

                            return (
                                <button
                                    key={item.id}
                                    onClick={() => {
                                        if (item.id === 'export_data') {
                                            window.location.href = '/api/bulk/export';
                                        }
                                        if (item.id === 'copy_link') {
                                            const linkToCopy = config.data?.url || window.location.href;
                                            navigator.clipboard.writeText(linkToCopy);
                                        }
                                        if (item.id === 'refresh') {
                                            // Real-time invalidation instead of reload
                                            queryClient.invalidateQueries();
                                        }
                                        onAction?.(item.id!, config.data);
                                        onClose();
                                    }}
                                    className={cn(
                                        "group flex items-center justify-between w-full px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-100 cursor-pointer outline-none select-none",
                                        item.variant === 'destructive'
                                            ? "text-red-400 hover:bg-red-500/10"
                                            : "text-white/70 hover:bg-white/5 hover:text-white"
                                    )}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={cn(
                                            "w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 group-hover:bg-primary/20 transition-colors",
                                            item.variant === 'destructive' && "group-hover:bg-red-500/20"
                                        )}>
                                            <Icon className={cn(
                                                "w-4 h-4 transition-transform group-hover:scale-110",
                                                item.variant === 'destructive' ? "text-red-400" : "text-white/40 group-hover:text-primary"
                                            )} />
                                        </div>
                                        <span>{item.label}</span>
                                    </div>
                                    {item.shortcut && (
                                        <span className="text-[10px] font-black uppercase tracking-widest text-white/20 group-hover:text-primary/50">
                                            {item.shortcut}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

// Hook to use the context menu easily
export function useContextMenu() {
    const [contextConfig, setContextConfig] = React.useState<ContextMenuConfig>({
        x: 0,
        y: 0,
        visible: false
    });

    const handleContextMenu = (
        e: React.MouseEvent,
        type: 'default' | 'video' | 'inbox' | 'dashboard' = 'default',
        data?: any
    ) => {
        e.preventDefault();
        e.stopPropagation(); // Prevent bubbling to parent menus
        setContextConfig({
            x: e.clientX,
            y: e.clientY,
            visible: true,
            type,
            data
        });
    };

    const closeMenu = () => {
        setContextConfig(prev => ({ ...prev, visible: false }));
    };

    return {
        contextConfig,
        handleContextMenu,
        closeMenu
    };
}
