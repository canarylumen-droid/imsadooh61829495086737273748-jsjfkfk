process.env.NODE_ENV ||= 'production';
process.env.APP_ROLE = 'api';
process.env.API_DISABLE_SOCKET = 'true';
process.env.DISABLE_STATIC_SERVE = 'true';

await import('./index.js');

export {};
