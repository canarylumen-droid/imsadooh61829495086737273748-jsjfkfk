import { Redis } from 'ioredis';
import { randomUUID } from 'crypto';

function getTaskId(): string {
  // ECS Fargate: metadata endpoint provides task ID
  // Railway: RAILWAY_REPLICA_ID
  // K8s: HOSTNAME
  return process.env.ECS_TASK_ID
    || process.env.RAILWAY_REPLICA_ID
    || process.env.HOSTNAME
    || randomUUID().substring(0, 8);
}

export interface ServiceInstance {
  id: string;
  role: string;
  ip: string;
  version: string;
  status: 'starting' | 'healthy' | 'unhealthy' | 'shutting_down';
  lastHeartbeat: number;
  metadata?: Record<string, any>;
}

export class ServiceRegistry {
  private redis: Redis;
  private serviceId: string;
  private role: string;
  private heartbeatInterval?: NodeJS.Timeout;
  private readonly HEARTBEAT_MS = 30_000;
  private readonly TTL_SECONDS = 90;

  constructor(redisUrl: string, role: string) {
    this.redis = new Redis(redisUrl);
    this.serviceId = `${role}-${getTaskId()}`;
    this.role = role;
  }

  async register(metadata: Record<string, any> = {}) {
    const instance: ServiceInstance = {
      id: this.serviceId,
      role: this.role,
      ip: process.env.HOSTNAME || 'unknown',
      version: process.env.npm_package_version || '1.0.0',
      status: 'starting',
      lastHeartbeat: Date.now(),
      metadata: { ecsTaskId: getTaskId(), ...metadata }
    };

    console.log(`🚀 [ServiceRegistry] Registering ${this.serviceId} as ${this.role}`);

    await this.redis.hset('audnix:services', this.serviceId, JSON.stringify(instance));
    await this.redis.expire('audnix:services', this.TTL_SECONDS);

    // Set status to healthy after successful registration
    instance.status = 'healthy';
    await this.updateInstance(instance);

    // Start heartbeat every 30s (matches 90s TTL for 3-beat tolerance)
    this.heartbeatInterval = setInterval(() => this.heartbeat(), this.HEARTBEAT_MS);
  }

  private async heartbeat() {
    try {
      const raw = await this.redis.hget('audnix:services', this.serviceId);
      if (raw) {
        const instance: ServiceInstance = JSON.parse(raw);
        instance.lastHeartbeat = Date.now();
        instance.status = 'healthy';
        await this.updateInstance(instance);
        await this.redis.expire('audnix:services', this.TTL_SECONDS);
      }
    } catch (err) {
      console.error(`❌ [ServiceRegistry] Heartbeat failed for ${this.serviceId}`, err);
    }
  }

  private async updateInstance(instance: ServiceInstance) {
    await this.redis.hset('audnix:services', this.serviceId, JSON.stringify(instance));
  }

  async deregister() {
    console.log(`🛑 [ServiceRegistry] Deregistering ${this.serviceId}`);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    try {
      const raw = await this.redis.hget('audnix:services', this.serviceId);
      if (raw) {
        const instance: ServiceInstance = JSON.parse(raw);
        instance.status = 'shutting_down';
        await this.updateInstance(instance);
        // Clean up after 5 seconds to allow monitoring to catch the shutdown
        setTimeout(async () => {
          await this.redis.hdel('audnix:services', this.serviceId);
        }, 5000);
      }
    } catch (err) {
      console.error(`❌ [ServiceRegistry] Deregistration failed for ${this.serviceId}`, err);
    }
  }

  async getHealthyServices(): Promise<ServiceInstance[]> {
    const all = await this.redis.hgetall('audnix:services');
    const now = Date.now();
    return Object.values(all)
      .map(s => JSON.parse(s) as ServiceInstance)
      .filter(s => (now - s.lastHeartbeat) < this.TTL_SECONDS * 1000 && s.status === 'healthy');
  }

  getServiceId() {
    return this.serviceId;
  }
}
