type AlertLogger = (message: string, data: Record<string, unknown>) => void;

interface LatencySample {
  command: string;
  durationMs: number;
}

const DEFAULT_SLO_MS = 15;
const DEFAULT_FLUSH_MS = 60_000;
const DEFAULT_SAMPLE_LIMIT = 5000;

function readInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

export class RedisLatencyTelemetry {
  private samples: LatencySample[] = [];
  private readonly sloMs = readInt('REDIS_LATENCY_P99_SLO_MS', DEFAULT_SLO_MS);
  private readonly sampleLimit = readInt('REDIS_LATENCY_SAMPLE_LIMIT', DEFAULT_SAMPLE_LIMIT);
  private readonly flushMs = readInt('REDIS_LATENCY_FLUSH_MS', DEFAULT_FLUSH_MS);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly label: string,
    private readonly logAlert: AlertLogger = (message, data) => console.warn(message, data)
  ) {
    this.timer = setInterval(() => this.flush(), this.flushMs);
    this.timer.unref?.();
  }

  record(command: string, startedAt: bigint): void {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    this.samples.push({ command: command.toUpperCase(), durationMs });
    if (this.samples.length > this.sampleLimit) {
      this.samples.splice(0, this.samples.length - this.sampleLimit);
    }
  }

  flush(): void {
    if (this.samples.length === 0) return;

    const grouped = new Map<string, number[]>();
    for (const sample of this.samples.splice(0)) {
      const bucket = grouped.get(sample.command) || [];
      bucket.push(sample.durationMs);
      grouped.set(sample.command, bucket);
    }

    for (const [command, durations] of grouped) {
      durations.sort((a, b) => a - b);
      const p95 = percentile(durations, 95);
      const p99 = percentile(durations, 99);
      const avg = durations.reduce((sum, value) => sum + value, 0) / durations.length;
      const payload = {
        label: this.label,
        command,
        count: durations.length,
        avgMs: Number(avg.toFixed(2)),
        p95Ms: Number(p95.toFixed(2)),
        p99Ms: Number(p99.toFixed(2)),
        sloMs: this.sloMs,
      };

      if (p99 > this.sloMs) {
        this.logAlert('[RedisLatencySLO] p99 Redis RTT exceeded SLO', payload);
      } else if (process.env.REDIS_LATENCY_LOG_OK === 'true') {
        console.log('[RedisLatencySLO] Redis RTT healthy', payload);
      }
    }
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
  }
}

export function sanitizeRedisUrl(input: string): string {
  let redisUrl = input.trim();

  if (redisUrl.includes('redis-cli')) {
    redisUrl = redisUrl.replace(/^redis-cli\s+-u\s+/, '');
  }

  const match = redisUrl.match(/rediss?:\/\/[^ \n\r\t]+/);
  return match ? match[0] : redisUrl;
}

export function validateRedisEndpoint(rawUrl: string, source: string): string {
  const redisUrl = sanitizeRedisUrl(rawUrl);
  const isProd = process.env.NODE_ENV === 'production';
  const requirePrivate = process.env.REDIS_PRIVATE_ENDPOINT_REQUIRED !== 'false';
  const allowPublic = process.env.REDIS_ALLOW_PUBLIC_ENDPOINT === 'true';
  const explicitSuffixes = (process.env.REDIS_PRIVATE_HOST_SUFFIXES || '')
    .split(',')
    .map((suffix) => suffix.trim().toLowerCase())
    .filter(Boolean);

  let parsed: URL;
  try {
    parsed = new URL(redisUrl);
  } catch (_err) {
    throw new Error(`[RedisConfig] Invalid ${source}: expected redis:// or rediss:// URL`);
  }

  if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
    throw new Error(`[RedisConfig] Invalid ${source}: unsupported protocol ${parsed.protocol}`);
  }

  const host = parsed.hostname.toLowerCase();
  const isLocalDockerEndpoint = ['redis', 'localhost', '127.0.0.1', '::1'].includes(host);

  if (isProd && parsed.protocol !== 'rediss:' && process.env.REDIS_TLS !== 'true' && !isLocalDockerEndpoint) {
    throw new Error('[RedisConfig] Production Redis must use rediss:// or REDIS_TLS=true');
  }

  if (isProd && process.env.REDIS_CLOUD_HA_ENABLED !== 'true') {
    console.warn('[RedisConfig] REDIS_CLOUD_HA_ENABLED is not true. Verify Redis Cloud HA is enabled provider-side.');
  }

  if (isProd && process.env.REDIS_CLOUD_AOF_ENABLED !== 'true') {
    console.warn('[RedisConfig] REDIS_CLOUD_AOF_ENABLED is not true. Verify Redis Cloud AOF durability is enabled provider-side.');
  }

  if (isProd && requirePrivate && !allowPublic) {
    const defaultPrivateSignals = ['.internal', '.private', 'privatelink', 'private-link', 'railway.internal'];
    const privateSignals = explicitSuffixes.length > 0 ? explicitSuffixes : defaultPrivateSignals;
    const isPrivate = isLocalDockerEndpoint ||
      privateSignals.some((signal) => host.endsWith(signal) || host.includes(signal));

    if (!isPrivate) {
      throw new Error(
        `[RedisConfig] Production Redis host "${parsed.hostname}" is not recognized as a private endpoint. ` +
        'Set REDIS_PRIVATE_HOST_SUFFIXES for your Redis Cloud private domain or REDIS_ALLOW_PUBLIC_ENDPOINT=true for an explicit exception.'
      );
    }
  }

  return redisUrl;
}

export function instrumentIoRedis<T extends { sendCommand?: (...args: any[]) => any }>(
  client: T,
  label: string
): T {
  if (!client.sendCommand || (client as any).__audnixLatencyInstrumented) return client;

  const telemetry = new RedisLatencyTelemetry(label);
  const original = client.sendCommand.bind(client);

  (client as any).sendCommand = (...args: any[]) => {
    const commandName = args[0]?.name || args[0]?.command || 'UNKNOWN';
    const startedAt = process.hrtime.bigint();

    try {
      const result = original(...args);
      if (result && typeof result.then === 'function') {
        return result.finally(() => telemetry.record(commandName, startedAt));
      }
      telemetry.record(commandName, startedAt);
      return result;
    } catch (err) {
      telemetry.record(commandName, startedAt);
      throw err;
    }
  };

  (client as any).__audnixLatencyInstrumented = true;
  return client;
}

export function instrumentRedisClient<T extends object>(client: T, label: string): T {
  if ((client as any).__audnixLatencyInstrumented) return client;

  const telemetry = new RedisLatencyTelemetry(label);
  const proxy = new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      if (prop === 'connect' || prop === 'disconnect' || prop === 'quit' || prop === 'duplicate') {
        return value.bind(target);
      }

      return (...args: unknown[]) => {
        const startedAt = process.hrtime.bigint();
        try {
          const result = value.apply(target, args);
          if (result && typeof result.then === 'function') {
            return result.finally(() => telemetry.record(String(prop), startedAt));
          }
          telemetry.record(String(prop), startedAt);
          return result;
        } catch (err) {
          telemetry.record(String(prop), startedAt);
          throw err;
        }
      };
    }
  });

  (proxy as any).__audnixLatencyInstrumented = true;
  return proxy as T;
}
