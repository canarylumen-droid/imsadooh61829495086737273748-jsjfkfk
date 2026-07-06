/**
 * Memory Watchdog
 * Monitors heap usage and logs telemetry. On ECS Fargate, we NEVER hard-exit —
 * let Target Tracking auto-scaling add tasks and ECS handle unresponsive containers.
 * The hard process.exit() is only enabled in local dev / Railway for safety.
 */
export function startMemoryWatchdog(heapLimitMb?: number) {
  const limit = heapLimitMb || parseInt(process.env.HEAP_LIMIT_MB || '0', 10) || 1024;
  const isEcs = !!process.env.ECS_CONTAINER_METADATA_URI_V4;
  const checkInterval = 30_000; // 30 seconds

  console.log(`[Watchdog] 🛡️ Memory monitoring started (Limit: ${limit}MB, ECS=${isEcs})`);

  const interval = setInterval(() => {
    const usage = process.memoryUsage();
    const heapUsedMb = Math.round(usage.heapUsed / 1024 / 1024);

    if (heapUsedMb > limit) {
      if (isEcs) {
        // ECS mode: log + let auto-scaling + liveness probe handle it
        console.warn(`[Watchdog] MEMORY HIGH: ${heapUsedMb}MB > ${limit}MB — ECS will scale or restart via liveness probe`);
        import('./system-health-service.js').then(({ SystemHealthService }) => {
          SystemHealthService.logCritical('system', 'MEMORY_HIGH', `Heap ${heapUsedMb}MB > ${limit}MB on ECS task ${process.env.ECS_TASK_ID || 'unknown'}`).catch(err => console.warn('[Watchdog] SystemHealthService.logCritical failed:', err.message));
        }).catch(err => console.warn('[Watchdog] Dynamic import of system-health-service failed:', err.message));
        // DO NOT exit — ECS liveness probe + Target Tracking scaling handles this
        return;
      }

      // Non-ECS mode (local / Railway): hard exit for safety
      console.error(`🚨 MEMORY CRITICAL: Heap usage ${heapUsedMb}MB exceeds limit ${limit}MB. Triggering graceful restart.`);
      import('./system-health-service.js').then(({ SystemHealthService }) => {
        SystemHealthService.logCritical('system', 'OOM_PREVENTION', `Service exceeded memory limit (${heapUsedMb}MB > ${limit}MB). Exiting.`)
          .finally(() => { process.exit(1); });
      }).catch(() => { process.exit(1); });
      clearInterval(interval);
    }
  }, checkInterval);

  interval.unref();
}
