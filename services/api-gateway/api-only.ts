process.env.NODE_ENV ||= 'production';
process.env.APP_ROLE = 'api';
process.env.API_DISABLE_SOCKET = 'true';

await import('./index.js');

export {};
