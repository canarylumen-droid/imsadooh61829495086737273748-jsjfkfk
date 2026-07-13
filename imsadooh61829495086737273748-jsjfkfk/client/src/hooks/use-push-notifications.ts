
import { useState, useEffect } from 'react';
import { apiRequest } from '@/lib/queryClient';

function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

export function usePushNotifications() {
    const [permission, setPermission] = useState<NotificationPermission>('default');
    const [isSubscribed, setIsSubscribed] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if ('Notification' in window) {
            setPermission(Notification.permission);
            checkSubscription();
        }
    }, []);

    async function checkSubscription() {
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.ready;
                const subscription = await registration.pushManager.getSubscription();
                setIsSubscribed(!!subscription);
            } catch (e) {
                console.error('Error checking subscription', e);
            }
        }
    }

    async function subscribe() {
        if (!('serviceWorker' in navigator)) return;
        setLoading(true);
        try {
            const registration = await navigator.serviceWorker.ready;

            // Get key
            const res = await apiRequest('GET', '/api/notifications/vapid-public-key');
            const { key } = await res.json();

            if (!key) throw new Error('VAPID key missing');

            const convertedKey = urlBase64ToUint8Array(key);
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: convertedKey
            });

            await apiRequest('POST', '/api/notifications/subscribe', subscription);
            setIsSubscribed(true);
            setPermission(Notification.permission);
        } catch (err) {
            console.error(err);
            // Don't show alert if it's just user denying
        } finally {
            setLoading(false);
        }
    }

    return { permission, isSubscribed, subscribe, loading };
}
