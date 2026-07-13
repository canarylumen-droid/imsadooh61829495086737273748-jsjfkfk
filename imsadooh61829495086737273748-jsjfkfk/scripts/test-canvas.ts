import { createCanvas } from '@napi-rs/canvas';
import fs from 'fs';

try {
  const canvas = createCanvas(100, 100);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'blue';
  ctx.fillRect(10, 10, 80, 80);
  const buffer = canvas.toBuffer('image/png');
  console.log('Canvas works! Buffer size:', buffer.length);
} catch (e) {
  console.error('Canvas failed:', e);
}
