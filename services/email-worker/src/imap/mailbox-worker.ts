import { Worker, Job } from 'bullmq';
import { createFreshConnection } from '@shared/lib/queues/redis-config.js';
import { ImapConnectionManager } from './imap-connection-manager.js';

/**
 * BullMQ Worker that listens for IMAP-related tasks.
 * This allows the API Gateway or a centralized orchestrator to trigger
 * connections/disconnections across the worker cluster.
 */
export function createMailboxWorker(connectionManager: ImapConnectionManager) {
  const worker = new Worker(
    'imap-idle-tasks',
    async (job: Job) => {
      const { type, integrationId } = job.data;
      
      console.log(`[MailboxWorker] Received job: ${type} for ${integrationId}`);

      switch (type) {
        case 'CONNECT_MAILBOX':
          await connectionManager.connectMailbox(integrationId);
          break;
        
        case 'DISCONNECT_MAILBOX':
          await connectionManager.disconnectMailbox(integrationId);
          break;

        case 'RECYCLE_MAILBOX':
          // Disconnect and reconnect to refresh the session
          await connectionManager.disconnectMailbox(integrationId);
          await connectionManager.connectMailbox(integrationId);
          break;

        default:
          console.warn(`[MailboxWorker] Unknown job type: ${type}`);
      }
    },
    {
      connection: createFreshConnection() as any,
      concurrency: 50, // High concurrency for command processing
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[MailboxWorker] Job ${job?.id} failed:`, err);
  });

  console.log('✅ IMAP Idle Worker initialized and listening for commands');
  return worker;
}
