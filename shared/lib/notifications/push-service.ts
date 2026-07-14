
import webpush from 'web-push';
import { db } from '@shared/lib/db/db.js';
import { pushSubscriptions } from "@audnix/shared";
import { eq } from "drizzle-orm";

// Initialize web-push with VAPID keys
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:auth@audnixai.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

export interface PushNotification {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
}

export async function sendPushNotification(
  subscription: PushSubscription,
  notification: PushNotification
): Promise<void> {
  if (!process.env.VAPID_PUBLIC_KEY) {
    console.warn('⚠️  Push notifications disabled (VAPID keys not set)');
    return;
  }

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    icon: notification.icon || '/logo.png',
    badge: notification.badge || '/logo.png',
    data: { url: notification.url }
  });

  try {
    await webpush.sendNotification(subscription as any, payload);
  } catch (error: any) {
    throw error;
  }
}

export async function notifyUser(
  userId: string,
  notification: PushNotification
): Promise<void> {
  if (!process.env.VAPID_PUBLIC_KEY) return;

  try {
    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));

    await Promise.allSettled(
      subs.map((sub: any) => {
        // Construct the subscription object for web-push
        const subscription = {
          endpoint: sub.endpoint,
          keys: sub.keys as { p256dh: string; auth: string }
        };

        return sendPushNotification(subscription as any, notification)
          .catch(async (err) => {
            if (err.statusCode === 410 || err.statusCode === 404) {
              console.log(`Removing expired subscription: ${sub.endpoint}`);
              await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
            }
          });
      })
    );
  } catch (error) {
    console.error('Error in notifyUser push:', error);
  }
}



