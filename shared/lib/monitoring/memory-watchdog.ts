/**
 * Memory Watchdog
 * Monitors heap usage and triggers a graceful exit if limits are exceeded.
 */
export function startMemoryWatchdog(heapLimitMb = 1024) {
  const checkInterval = 30_000; // 30 seconds
  
  console.log(`[Watchdog] 🛡️ Memory monitoring started (Limit: ${heapLimitMb}MB)`);

  const interval = setInterval(() => {
    const usage = process.memoryUsage();
    const heapUsedMb = Math.round(usage.heapUsed / 1024 / 1024);
    
    if (heapUsedMb > heapLimitMb) {
      console.error(`🚨 MEMORY CRITICAL: Heap usage ${heapUsedMb}MB exceeds limit ${heapLimitMb}MB. Triggering graceful restart.`);
      
      // Attempt to log the event before exiting
      import('./system-health-service.js').then(({ SystemHealthService }) => {
        SystemHealthService.logCritical('system', 'OOM_PREVENTION', `Service exceeded memory limit (${heapUsedMb}MB > ${heapLimitMb}MB). Exiting.`)
          .finally(() => {
            process.exit(1);
          });
      }).catch(() => {
        process.exit(1);
      });
      
      clearInterval(interval);
    }
  }, checkInterval);

  // Ensure the interval doesn't keep the process alive if everything else is finished
  interval.unref();
}
