process.env.NODE_ENV ||= 'production';
process.env.APP_ROLE = 'infra-scaler';
process.env.QUEUE_AUTOSCALER_ENABLED = 'true';

await import('./autonomous-scaler.js');

export {};
