import React, { createContext, useContext, useState, useEffect } from 'react';
import { useQuery } from "@tanstack/react-query";

export interface MailboxInfo {
    id: string;
    connected: boolean;
    name?: string;
    email?: string;
    provider?: string;
    healthStatus?: string;
    workerStatus?: string;
    lastSyncAt?: string;
    tier?: string;
}

interface MailboxContextType {
    selectedMailboxId: string | undefined;
    setSelectedMailboxId: (id: string | undefined) => void;
    isLoading: boolean;
    mailboxes: MailboxInfo[];
    selectedMailbox: MailboxInfo | undefined;
    isMailboxHealthy: boolean;
}

const MailboxContext = createContext<MailboxContextType | undefined>(undefined);

export function MailboxProvider({ children }: { children: React.ReactNode }) {
    const [selectedMailboxId, setSelectedMailboxIdState] = useState<string | undefined>(() => {
        return localStorage.getItem('selected_mailbox_id') || undefined;
    });

    // Phase 12: Self-healing validation for stale mailbox IDs.
    const { data: status, isLoading, isError } = useQuery<{
        integrations: MailboxInfo[];
    }>({
        queryKey: ["/api/custom-email/status"],
        refetchOnWindowFocus: false,
        staleTime: 30000, // 30 seconds for fresher mailbox health data
        retry: 2,
    });

    const mailboxes = status?.integrations || [];
    const selectedMailbox = mailboxes.find((m) => m.id === selectedMailboxId);
    const isMailboxHealthy = selectedMailbox?.healthStatus !== 'critical' && selectedMailbox?.healthStatus !== 'failed';

    useEffect(() => {
        if (isLoading || isError) return;
        if (!status?.integrations || status.integrations.length === 0) return;
        if (!selectedMailboxId) return;

        const exists = status.integrations.some((i) => i.id === selectedMailboxId);
        if (!exists) {
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
        <MailboxContext.Provider value={{ selectedMailboxId, setSelectedMailboxId, isLoading, mailboxes, selectedMailbox, isMailboxHealthy }}>
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
