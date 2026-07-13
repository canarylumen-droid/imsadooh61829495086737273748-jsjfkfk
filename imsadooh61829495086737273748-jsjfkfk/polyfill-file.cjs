// Global polyfill for `File` - required by cheerio's undici on Node <20
if (typeof globalThis.File === 'undefined') {
  class FilePolyfill {
    constructor(data, name, options) {
      this.name = name;
      this.size = data.reduce((acc, chunk) => acc + (typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length), 0);
      this.type = options?.type || '';
      this.lastModified = options?.lastModified || Date.now();
      this._data = Buffer.concat(data.map(chunk => typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
    }
    async text() { return this._data.toString('utf-8'); }
    async arrayBuffer() { return this._data.buffer; }
    async bytes() { return new Uint8Array(this._data); }
    slice() { return this; }
    stream() { throw new Error('Not implemented'); }
  }
  globalThis.File = FilePolyfill;
  console.log('✅ Polyfilled File via --require');
}
