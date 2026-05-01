/**
 * PDF Polyfills for Node.js environments
 * Fixes "ReferenceError: DOMMatrix is not defined" and missing canvas modules
 * when using pdfjs-dist in Node.js (e.g., via pdf-parse)
 */

if (typeof global !== 'undefined') {
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
