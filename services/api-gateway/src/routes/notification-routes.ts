import { Router } from "express";
import { db } from "@shared/lib/db/db.js";
import { pushSubscriptions } from "@audnix/shared";
import { eq } from "drizzle-orm";
import { storage } from "@shared/lib/storage/storage.js";
import { requireAuthOrApiKey } from "../middleware/auth.js";
import { wsSync } from "@shared/lib/realtime/websocket-sync.js";

const router = Router();

// Get list of notifications for the current user (with pagination + date filter)
router.get("/", requireAuthOrApiKey, async (req, res) => {
    try {
        const userId = req.session?.userId || (req.user as any)?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;
        const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined;
        const dateTo = req.query.dateTo ? new Date(req.query.dateTo as string) : undefined;
        const integrationId = req.query.integrationId as string | undefined;

        const notificationList = await storage.getNotifications(userId, { limit, offset, dateFrom, dateTo, integrationId });
        const unreadCount = await storage.getUnreadNotificationCount(userId);

        res.json({
            unreadCount,
            notifications: notificationList
        });
    } catch (error: any) {
        console.error("Fetch notifications error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Mark a specific notification as read
router.patch("/:id/read", requireAuthOrApiKey, async (req, res) => {
    try {
        const userId = req.session?.userId || (req.user as any)?.id;
        const notificationId = req.params.id;

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const updatedNotification = await storage.markNotificationAsRead(notificationId as string, userId);

        // Notify client to update UI immediately
        wsSync.notifyNotification(userId, { type: 'update', action: 'read', id: notificationId });

        res.json({ success: true, notification: updatedNotification });
    } catch (error: any) {
        console.error("Mark notification read error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Mark all notifications as read
router.post("/mark-all-read", requireAuthOrApiKey, async (req, res) => {
    try {
        const userId = req.session?.userId || (req.user as any)?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        await storage.markAllNotificationsAsRead(userId);

        // Notify client
        wsSync.notifyNotification(userId, { type: 'update', action: 'read_all' });

        res.json({ success: true });
    } catch (error: any) {
        console.error("Mark all notifications read error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Clear all notifications (permanently delete from DB)
router.post("/clear-all", requireAuthOrApiKey, async (req, res) => {
    try {
        const userId = req.session?.userId || (req.user as any)?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        await storage.clearAllNotifications(userId);
        
        // Notify client to clear UI
        wsSync.notifyNotification(userId, { type: 'update', action: 'clear_all' });
        
        res.json({ success: true });
    } catch (error: any) {
        console.error("Clear all notifications error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Delete a single notification
router.delete("/:id", requireAuthOrApiKey, async (req, res) => {
    try {
        const userId = req.session?.userId || (req.user as any)?.id;
        const notificationId = req.params.id;

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        await storage.deleteNotification(notificationId as string, userId);
        
        // Notify client
        wsSync.notifyNotification(userId, { type: 'update', action: 'delete', id: notificationId });
        
        res.json({ success: true });
    } catch (error: any) {
        console.error("Delete notification error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Get VAPID public key
router.get("/vapid-public-key", (req, res) => {
    if (!process.env.VAPID_PUBLIC_KEY) {
        return res.status(500).json({ error: "VAPID key not configured" });
    }
    res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

// Subscribe to push notifications
router.post("/subscribe", async (req, res) => {
    try {
        const userId = req.session?.userId || (req.user as any)?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const subscription = req.body;
        if (!subscription || !subscription.endpoint || !subscription.keys) {
            return res.status(400).json({ error: "Invalid subscription payload" });
        }

        // Check if duplicate
        const existing = await db
            .select()
            .from(pushSubscriptions)
            .where(eq(pushSubscriptions.endpoint, subscription.endpoint))
            .limit(1);

        if (existing.length > 0) {
            // Update keys if changed, or just update userId if needed
            if (existing[0].userId !== userId) {
                await db
                    .update(pushSubscriptions)
                    .set({ userId, keys: subscription.keys })
                    .where(eq(pushSubscriptions.endpoint, subscription.endpoint));
            }
            return res.status(200).json({ status: "updated" });
        }

        // Insert new
        await db.insert(pushSubscriptions).values({
            userId,
            endpoint: subscription.endpoint,
            keys: subscription.keys,
        });

        res.status(201).json({ status: "subscribed" });
    } catch (error: any) {
        console.error("Push subscription error:", error);
        res.status(500).json({ error: error.message });
    }
});

export default router;

