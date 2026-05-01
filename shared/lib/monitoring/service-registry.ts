import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

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

  constructor(redisUrl: string, role: string) {
    this.redis = new Redis(redisUrl);
    this.serviceId = `${role}-${uuidv4().substring(0, 8)}`;
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
      metadata
    };

    console.log(`🚀 [ServiceRegistry] Registering ${this.serviceId} as ${this.role}`);
    
    await this.redis.hset('audnix:services', this.serviceId, JSON.stringify(instance));
    
    // Set status to healthy after successful registration
    instance.status = 'healthy';
    await this.updateInstance(instance);

    // Start heartbeat
    this.heartbeatInterval = setInterval(() => this.heartbeat(), 10000);
  }

  private async heartbeat() {
    try {
      const raw = await this.redis.hget('audnix:services', this.serviceId);
      if (raw) {
        const instance: ServiceInstance = JSON.parse(raw);
        instance.lastHeartbeat = Date.now();
        instance.status = 'healthy';
        await this.updateInstance(instance);
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
      .filter(s => (now - s.lastHeartbeat) < 30000 && s.status === 'healthy');
  }

  getServiceId() {
    return this.serviceId;
  }
}
