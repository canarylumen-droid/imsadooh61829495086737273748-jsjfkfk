import client from 'prom-client';

// Create a Registry which registers the metrics
const register = new client.Registry();

// Add a default label which is added to all metrics
register.setDefaultLabels({
  app: 'audnix-email-worker'
});

// Enable the collection of default metrics
client.collectDefaultMetrics({ register });

// Define custom metrics
export const imapConnectionsActive = new client.Gauge({
  name: 'imap_connections_active',
  help: 'Number of active IMAP connections currently maintained by this worker',
  labelNames: ['provider']
});

export const imapReconnectTotal = new client.Counter({
  name: 'imap_reconnect_total',
  help: 'Total number of IMAP reconnections attempted',
  labelNames: ['reason']
});

export const imapErrorsTotal = new client.Counter({
  name: 'imap_errors_total',
  help: 'Total number of IMAP errors encountered',
  labelNames: ['type', 'provider']
});

export const imapMailEventsTotal = new client.Counter({
  name: 'imap_mail_events_total',
  help: 'Total number of new mail events received via IDLE',
  labelNames: ['provider']
});

export const imapCircuitTrippedTotal = new client.Counter({
  name: 'imap_circuit_tripped_total',
  help: 'Total number of times a host circuit has been tripped',
  labelNames: ['host']
});

export const imapCircuitStatus = new client.Gauge({
  name: 'imap_circuit_status',
  help: 'Current status of the circuit for a host (1 for OPEN, 0 for CLOSED)',
  labelNames: ['host']
});

// Register custom metrics
register.registerMetric(imapConnectionsActive);
register.registerMetric(imapReconnectTotal);
register.registerMetric(imapErrorsTotal);
register.registerMetric(imapMailEventsTotal);
register.registerMetric(imapCircuitTrippedTotal);
register.registerMetric(imapCircuitStatus);

export const metricsService = {
  getMetrics: async () => {
    return await register.metrics();
  },
  getContentType: () => {
    return register.contentType;
  }
};
