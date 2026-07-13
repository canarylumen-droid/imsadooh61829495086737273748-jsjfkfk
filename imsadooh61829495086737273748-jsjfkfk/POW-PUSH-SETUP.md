# 🚀 Real-Time Push Notification Setup Guide (ASAP SDR Arrival)

We have upgraded Audnix to a **Push-First** architecture. This guide will teach you how to set up your Google and Microsoft consoles to enable "Zero Refresh" real-time email arrivals.

---

## 🟢 1. Google Gmail Push (Pub/Sub)
Gmail uses Google Cloud Pub/Sub to "push" new emails to Audnix instantly.

### Step-by-Step:
1.  **Go to Google Cloud Console**: [console.cloud.google.com](https://console.cloud.google.com/)
2.  **Enable Pub/Sub API**: Search for "Cloud Pub/Sub API" and click **Enable**.
3.  **Create a Topic**:
    *   Navigate to **Pub/Sub > Topics**.
    *   Click **Create Topic**.
    *   Topic ID: `audnix-gmail-push`.
4.  **Add Permissions**:
    *   On the Topic details page, go to the **Permissions** tab.
    *   Add Principal: `gmail-api-push@system.gserviceaccount.com`.
    *   Role: **Pub/Sub Publisher**.
5.  **Create a Push Subscription**:
    *   Go to **Pub/Sub > Subscriptions**.
    *   Click **Create Subscription**.
    *   Subscription ID: `audnix-gmail-push-sub`.
    *   Select the topic you just created.
    *   Delivery Type: **Push**.
    *   Endpoint URL: `https://your-app.up.railway.app/api/webhook/google/push` (Replace with your actual domain).
6.  **Add Environment Variables**:
    *   `GOOGLE_PUBSUB_TOPIC`: `projects/[YOUR_PROJECT_ID]/topics/audnix-gmail-push`

---

## 🔵 2. Microsoft Outlook Push (Graph Webhooks)
Outlook uses Microsoft Graph Webhooks to notify Audnix when new messages are created.

### Step-by-Step:
1.  **Go to Azure Portal**: [portal.azure.com](https://portal.azure.com/)
2.  **App Registrations**: Select your Audnix app registration.
3.  **API Permissions**:
    *   Ensure `Mail.Read` and `offline_access` are granted.
4.  **Add Environment Variables**:
    *   `OUTLOOK_WEBHOOK_URL`: `https://your-app.up.railway.app/api/webhook/outlook/push`
    *   `APP_URL`: `https://your-app.up.railway.app`

---

## ⚡ 3. How to Verify
1.  Restart your server.
2.  Check the logs — you should see:
    *   `💻 [Native Push] worker: ✅ Online`
    *   `📡 Setting up watch for [email] on topic ...`
3.  Send a test email to a connected account.
4.  Watch your Dashboard — the message should appear **instantly** without refreshing.

---

### Why this is better:
- **Zero Delay**: Messages arrive the second they hit the provider's server.
- **Zero API Quota Waste**: We no longer "poll" every minute. We wait for them to call us.
- **Smooth UX**: The Socket.io bridge keeps the UI "Connected" and alive.
