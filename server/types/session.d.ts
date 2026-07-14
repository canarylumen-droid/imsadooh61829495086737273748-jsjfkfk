import 'express-session';

declare module 'express-session' {
    interface SessionData {
        userId?: string;
        oauthState?: string;
        user?: { id: string; email: string; role: string };
    }
}

export { };
