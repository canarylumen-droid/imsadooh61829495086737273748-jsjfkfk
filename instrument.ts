// ─── GLOBAL POLYFILLS (MUST RUN FIRST) ────────────────────────────────────
// Polyfill `File` for undici (used by cheerio) in Node <20 environments
if (typeof globalThis.File === 'undefined') {
  class FilePolyfill {
    name: string;
    size: number;
    type: string;
    lastModified: number;
    private _data: Buffer;
    constructor(data: (string | Buffer)[], name: string, options?: { type?: string; lastModified?: number }) {
      this.name = name;
      this.size = data.reduce((acc, chunk) => acc + (typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length), 0);
      this.type = options?.type || '';
      this.lastModified = options?.lastModified || Date.now();
      this._data = Buffer.concat(data.map(chunk => typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
    }
    async text() { return this._data.toString('utf-8'); }
    async arrayBuffer() { return this._data.buffer.slice(0); }
    async bytes() { return new Uint8Array(this._data); }
    slice() { return this; }
    stream() { throw new Error('Not implemented'); }
  }
  (globalThis as any).File = FilePolyfill;
  console.log('✅ Polyfilled File for undici compatibility');
}

import * as Sentry from "@sentry/node";
import "dotenv/config";

if (process.env.OBSERVABILITY_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.OBSERVABILITY_SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 1.0,
  });
  console.log("✅ Sentry initialized via instrument.ts");
}
