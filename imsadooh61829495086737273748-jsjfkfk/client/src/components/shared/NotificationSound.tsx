import { useEffect, useRef } from 'react';
import { useRealtime } from '@/hooks/use-realtime';

export function NotificationSound() {
    const { socket } = useRealtime();
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const lastSoundTime = useRef<number>(0);

    const playSound = (type: 'notification' | 'message' = 'notification') => {
        const now = Date.now();
        // Throttle all sounds to max once per second to prevent "machine gun" effect
        if (now - lastSoundTime.current < 1000) return;
        
        lastSoundTime.current = now;
        
        try {
            if (audioRef.current) {
                audioRef.current.currentTime = 0;
                audioRef.current.play().catch(err => {
                    console.warn(`[Sound] Play failed for ${type}:`, err);
                });
            }
        } catch (e) {
            console.warn('[Sound] Audio error:', e);
        }
    };

    useEffect(() => {
        // Create audio element with the correct unified sound file
        const audio = new Audio('/sounds/notification.mp3');
        audio.volume = 0.5;
        audioRef.current = audio;

        if (!socket) return;

        // 1. Generic Notifications (Aggregate imports, system alerts)
        const handleNotification = (data: any) => {
            // Only play sound if playSound flag is explicitly set by backend (e.g., aggregate notifications)
            if (data?.playSound) {
                playSound('notification');
            }
        };

        // 2. Real-time Lead Updates
        const handleLeadsUpdated = (payload: any) => {
            // Play sound for individual new leads (INSERT)
            // DON'T play for 'bulk_import' (handled by aggregate notification sound)
            if (payload.event === 'INSERT' && payload.type !== 'bulk_import') {
                playSound('notification');
            }
            
            // Play for conversions
            if (payload.event === 'UPDATE' && payload.lead?.status === 'converted') {
                playSound('notification');
            }
        };

        // 3. Messages & Activity
        const handleMessagesUpdated = (payload: any) => {
            if (payload.message?.direction === 'inbound') {
                playSound('message');
            }
        };

        const handleActivityUpdated = (payload: any) => {
            if (payload.type === 'email_received' || payload.type === 'message_received') {
                playSound('message');
            }
        };

        socket.on('notification', handleNotification);
        socket.on('leads_updated', handleLeadsUpdated);
        socket.on('messages_updated', handleMessagesUpdated);
        socket.on('activity_updated', handleActivityUpdated);
        
        // Legacy/Generic listener support
        socket.on('message_received', () => playSound('message'));

        return () => {
            socket.off('notification', handleNotification);
            socket.off('leads_updated', handleLeadsUpdated);
            socket.off('messages_updated', handleMessagesUpdated);
            socket.off('activity_updated', handleActivityUpdated);
            socket.off('message_received');
        };
    }, [socket]);

    return null;
}
