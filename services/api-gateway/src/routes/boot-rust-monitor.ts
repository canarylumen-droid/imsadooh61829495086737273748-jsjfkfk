/**
 * Boot-time helper that pushes all active custom_email integrations
 * to the Rust mailbox monitor so it can open persistent IDLE connections.
 */

export async function pushActiveMailboxesToRust() {
  try {
    const { storage } = await import('@shared/lib/storage/storage.js');
    const { pushMailboxToRustMonitor, buildMailboxConfig } = await import('@shared/lib/realtime/mailbox-monitor-bridge.js');

    const integrations = await storage.getActiveImapIntegrations();
    let pushed = 0;

    for (const integration of integrations) {
      const config = await buildMailboxConfig(integration);
      if (config) {
        await pushMailboxToRustMonitor(config);
        pushed++;
      }
    }

    console.log(`[BootRustMonitor] ✅ Pushed ${pushed}/${integrations.length} mailboxes to Rust IMAP monitor`);
  } catch (e: any) {
    console.warn('[BootRustMonitor] Failed:', e.message);
  }
}
