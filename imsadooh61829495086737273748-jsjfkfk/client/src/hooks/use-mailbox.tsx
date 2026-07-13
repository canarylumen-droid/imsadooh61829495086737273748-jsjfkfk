import React, { createContext, useContext, useState, useEffect } from 'react';
import { useQuery } from "@tanstack/react-query";

interface MailboxContextType {
    selectedMailboxId: string | undefined;
    setSelectedMailboxId: (id: string | undefined) => void;
    isLoading: boolean;
}

const MailboxContext = createContext<MailboxContextType | undefined>(undefined);

export function MailboxProvider({ children }: { children: React.ReactNode }) {
    const [selectedMailboxId, setSelectedMailboxIdState] = useState<string | undefined>(() => {
        return localStorage.getItem('selected_mailbox_id') || undefined;
    });

    // Phase 12: Self-healing validation for stale mailbox IDs.
    // Only runs when query has fully settled with a real non-empty list.
    const { data: status, isLoading, isError } = useQuery<{
        integrations: Array<{ id: string; connected: boolean }>;
    }>({
        queryKey: ["/api/custom-email/status"],
        refetchOnWindowFocus: false,
        staleTime: 60000, // 1 minute
        retry: 2,
    });

    useEffect(() => {
        // Guard: never reset on loading, error, or empty response (could be a transient blip).
        if (isLoading || isError) return;
        if (!status?.integrations || status.integrations.length === 0) return;
        if (!selectedMailboxId) return;

        const exists = status.integrations.some((i: any) => i.id === selectedMailboxId);
        if (!exists) {
            console.log(`[MailboxProvider] 🔄 Resetting stale mailbox ID: ${selectedMailboxId} (confirmed absent from ${status.integrations.length} integrations)`);
            setSelectedMailboxId(undefined);
        }
    }, [status, isLoading, isError, selectedMailboxId]);

    const setSelectedMailboxId = (id: string | undefined) => {
        setSelectedMailboxIdState(id);
        if (id) {
            localStorage.setItem('selected_mailbox_id', id);
        } else {
            localStorage.removeItem('selected_mailbox_id');
        }
    };

    return (
        <MailboxContext.Provider value={{ selectedMailboxId, setSelectedMailboxId, isLoading }}>
            {children}
        </MailboxContext.Provider>
    );
}

export function useMailbox() {
    const context = useContext(MailboxContext);
    if (context === undefined) {
        throw new Error('useMailbox must be used within a MailboxProvider');
    }
    return context;
}
