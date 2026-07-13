/**
 * Global polyfills for Node.js environments
 * Fixes missing browser APIs like File, DOMMatrix, Path2D, ImageData
 */

if (typeof global !== 'undefined') {
    // Polyfill `File` for undici (used by cheerio) in Node <20
    if (typeof (global as any).File === 'undefined') {
        (global as any).File = class File {
            name: string;
            size: number;
            type: string;
            lastModified: number;
            _data: Buffer;
            constructor(data: (string | Buffer)[], name: string, options?: { type?: string; lastModified?: number }) {
                this.name = name;
                this.size = data.reduce((acc: number, chunk: string | Buffer) => acc + (typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length), 0);
                this.type = options?.type || '';
                this.lastModified = options?.lastModified || Date.now();
                this._data = Buffer.concat(data.map((chunk: string | Buffer) => typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
            }
            async text() { return this._data.toString('utf-8'); }
            async arrayBuffer() { return this._data.buffer.slice(0); }
            async bytes() { return new Uint8Array(this._data); }
            slice() { return this; }
            stream() { throw new Error('Not implemented'); }
        };
        console.log('✅ Polyfilled File for undici compatibility');
    }

    // Minimal polyfill for DOMMatrix
    if (typeof (global as any).DOMMatrix === 'undefined') {
        (global as any).DOMMatrix = class DOMMatrix {
            a: number = 1;
            b: number = 0;
            c: number = 0;
            d: number = 1;
            e: number = 0;
            f: number = 0;

            constructor(init?: string | number[]) {
                if (typeof init === 'string') {
                    // Very basic parsing for common cases if needed
                } else if (Array.isArray(init)) {
                    this.a = init[0] ?? 1;
                    this.b = init[1] ?? 0;
                    this.c = init[2] ?? 0;
                    this.d = init[3] ?? 1;
                    this.e = init[4] ?? 0;
                    this.f = init[5] ?? 0;
                }
            }

            static fromMatrix(other: any) {
                return new DOMMatrix([other.a, other.b, other.c, other.d, other.e, other.f]);
            }

            multiply(other: any) { return new DOMMatrix(); }
            scale(s: number) { return new DOMMatrix(); }
            translate(x: number, y: number) { return new DOMMatrix(); }
            rotate(angle: number) { return new DOMMatrix(); }
            inverse() { return new DOMMatrix(); }
            toString() { return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`; }
        };
        console.log('✅ Polyfilled DOMMatrix for PDF processing');
    }

    // Minimal polyfill for Path2D
    if (typeof (global as any).Path2D === 'undefined') {
        (global as any).Path2D = class Path2D {
            addPath() { }
            closePath() { }
            moveTo() { }
            lineTo() { }
            bezierCurveTo() { }
            quadraticCurveTo() { }
            arc() { }
            arcTo() { }
            ellipse() { }
            rect() { }
        };
        console.log('✅ Polyfilled Path2D for PDF processing');
    }

    // Minimal polyfill for ImageData
    if (typeof (global as any).ImageData === 'undefined') {
        (global as any).ImageData = class ImageData {
            data: Uint8ClampedArray;
            width: number;
            height: number;
            constructor(width: number, height: number) {
                this.width = width;
                this.height = height;
                this.data = new Uint8ClampedArray(width * height * 4);
            }
        };
        console.log('✅ Polyfilled ImageData for PDF processing');
    }
}
