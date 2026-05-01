interface WorkerHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'failed';
  lastRun: Date | null;
  lastError: string | null;
  runCount: number;
  errorCount: number;
}

class WorkerHealthMonitor {
  private workers: Map<string, WorkerHealth> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private globalAiPause: boolean = false;
  private pauseReason: string | null = null;

  /**
   * Register a worker for health monitoring
   */
  registerWorker(name: string): void {
    this.workers.set(name, {
      name,
      status: 'healthy',
      lastRun: null,
      lastError: null,
      runCount: 0,
      errorCount: 0
    });
  }

  /**
   * Record successful worker run
   */
  recordSuccess(name: string): void {
    const worker = this.workers.get(name);
    if (worker) {
      worker.lastRun = new Date();
      worker.runCount++;
      worker.status = 'healthy';
      worker.lastError = null;
    }
  }

  /**
   * Record worker error
   */
  recordError(name: string, error: string): void {
    const worker = this.workers.get(name);
    if (worker) {
      worker.errorCount++;
      worker.lastError = error;
      worker.status = worker.errorCount > 3 ? 'failed' : 'degraded';
      
      // Alert admin if worker fails
      if (worker.status === 'failed') {
        this.alertAdmin(name, error);
        this.evaluateEmergencyBrake();
      }
    }
  }

  /**
   * Phase 50: Global Kill-Switch
   * Disables all AI workers if system error density is too high.
   */
  private evaluateEmergencyBrake(): void {
    const status = this.getDetailedStatus();
    const failedRatio = status.failedCount / Math.max(1, status.total);

    if (failedRatio > 0.4 || status.failedCount >= 3) {
      this.globalAiPause = true;
      this.pauseReason = `Critical failure density detected: ${status.failedCount} workers failed.`;
      console.error(`🚨 [Emergency Brake] ACTIVATED. ${this.pauseReason}`);
    }
  }

  isSystemPaused(): { paused: boolean; reason: string | null } {
    return { paused: this.globalAiPause, reason: this.pauseReason };
  }

  resetPause(): void {
    this.globalAiPause = false;
    this.pauseReason = null;
    console.log("🟢 [Emergency Brake] System reset.");
  }

  /**
   * Get health status of all workers
   */
  getHealthStatus(): WorkerHealth[] {
    return Array.from(this.workers.values());
  }

  /**
   * Get detailed summary of all workers
   */
  getDetailedStatus() {
    const workers = Array.from(this.workers.values());
    let healthyCount = 0;
    let degradedCount = 0;
    let failedCount = 0;
    const failedWorkers: string[] = [];

    for (const w of workers) {
      if (w.status === 'healthy') healthyCount++;
      else if (w.status === 'degraded') degradedCount++;
      else if (w.status === 'failed') {
        failedCount++;
        failedWorkers.push(w.name);
      }
    }

    return {
      healthy: failedCount === 0,
      total: workers.length,
      healthyCount,
      degradedCount,
      failedCount,
      failedWorkers,
      workers
    };
  }

  /**
   * Get health status of specific worker
   */
  getWorkerHealth(name: string): WorkerHealth | null {
    return this.workers.get(name) || null;
  }

  /**
   * Start health check monitoring
   */
  start(): void {
    if (this.checkInterval) return;

    // Check every 5 minutes
    this.checkInterval = setInterval(() => {
      this.performHealthCheck();
    }, 5 * 60 * 1000);

    console.log('✅ Worker health monitoring started');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Perform health check on all workers
   */
  private performHealthCheck(): void {
    const now = new Date();
    
    for (const worker of this.workers.values()) {
      // If worker hasn't run in 30 minutes, mark as degraded
      if (worker.lastRun) {
        const timeSinceLastRun = now.getTime() - worker.lastRun.getTime();
        const minutesSinceLastRun = timeSinceLastRun / (1000 * 60);
        
        if (minutesSinceLastRun > 30 && worker.status === 'healthy') {
          worker.status = 'degraded';
          console.warn(`⚠️ Worker ${worker.name} hasn't run in ${minutesSinceLastRun.toFixed(0)} minutes`);
        }
      }
    }
  }

  /**
   * Alert admin about worker failure
   */
  private async alertAdmin(workerName: string, error: string): Promise<void> {
    console.error(`🚨 WORKER FAILURE: ${workerName} - ${error}`);
    // Using Neon database for admin notifications - no Supabase needed
  }
}

export const workerHealthMonitor = new WorkerHealthMonitor();
