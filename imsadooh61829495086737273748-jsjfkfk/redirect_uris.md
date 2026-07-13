# 🚀 Fully Redirect URL Reference Guide

Use these exact URLs in your Developer Consoles to ensure your OAuth connections work perfectly.

> [!IMPORTANT]
> If you are testing on **Localhost**, use the `http://localhost:5000` variant. 
> If you have a custom domain (e.g. `audnixai.com`), use the `https://` variant.

---

### 1. Google Cloud Console (Gmail & Google Workspace)
*Used for both personal `@gmail.com` and professional business emails.*

- **Redirect URI (Production)**: `https://audnixai.com/api/oauth/gmail/callback`
- **Redirect URI (Localhost)**: `http://localhost:5000/api/oauth/gmail/callback`

### 2. Google Cloud Console (Google Calendar)
*Note: You can use the same Google Project for both Gmail and Calendar.*

- **Redirect URI (Production)**: `https://audnixai.com/api/oauth/google-calendar/callback`
- **Redirect URI (Localhost)**: `http://localhost:5000/api/oauth/google-calendar/callback`

### 3. Calendly Developer Portal
- **Redirect URI (Production)**: `https://audnixai.com/api/oauth/calendly/callback`
- **Redirect URI (Localhost)**: `http://localhost:5000/api/oauth/calendly/callback`

### 4. Meta for Developers (Instagram)
- **Redirect URI (Production)**: `https://audnixai.com/api/oauth/instagram/callback`
- **Redirect URI (Localhost)**: `http://localhost:5000/api/oauth/instagram/callback`

---

## 🛠️ How to use these
1.  **Go to your Developer Console** (Google Cloud, Calendly, or Meta).
2.  Navigate to the **OAuth Credentials** or **App Settings** section.
3.  Add the appropriate URL above to the **"Authorized Redirect URIs"** or **"Callback URLs"** field.
4.  Save and test your connection in the app!
