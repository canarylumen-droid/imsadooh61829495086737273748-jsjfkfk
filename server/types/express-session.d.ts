import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    email?: string;
    userEmail?: string;
    supabaseId?: string;
    isAdmin?: boolean;
    lastRegeneration?: number;
    user?: {
      id: string;
      email: string;
      name: string;
    };
  }
}