# AI API Key Setup Guide

To use the AI-driven outreach and personalization features in Audnix, you need to configure an OpenAI API key.

## Steps to Obtain an OpenAI API Key

1.  **Create an account**: Go to [OpenAI](https://platform.openai.com/) and sign up.
2.  **Generate API Key**: Navigate to the **API Keys** section in your dashboard.
3.  **Create New Secret Key**: Click "Create new secret key", give it a name, and copy the key immediately (you won't be able to see it again).
4.  **Add Credits**: Ensure your account has a positive balance (minimum $5 recommended) to avoid `insufficient_quota` errors.

## Configuration in Audnix

### Local Development
1.  Open your `.env` file in the project root.
2.  Add or update the following line:
    ```
    OPENAI_API_KEY=your_actual_key_here
    ```
3.  Restart your development server.

### Vercel Deployment
1.  Go to your project dashboard on Vercel.
2.  Navigate to **Settings** -> **Environment Variables**.
3.  Add `OPENAI_API_KEY` with your secret key as the value.
4.  Redeploy your application for the changes to take effect.

## Troubleshooting

- **Error 401 (Unauthorized)**: Your API key is incorrect or has been revoked.
- **Error 429 (Rate Limit)**: You are making too many requests, or your account trial has expired. Check your [OpenAI usage](https://platform.openai.com/usage).
- **Insuficient Quota**: You need to add credits to your OpenAI account.
