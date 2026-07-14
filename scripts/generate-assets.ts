import { createCanvas } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';

const PUBLIC_DIR = path.resolve(process.cwd(), 'client', 'public');

function drawLogo(ctx: any, width: number, height: number, theme: 'transparent' | 'dark' = 'transparent') {
  ctx.save();
  if (theme === 'dark') {
    // Premium dark background gradient
    const bgGrad = ctx.createRadialGradient(width / 2, height / 2, 50, width / 2, height / 2, Math.max(width, height));
    bgGrad.addColorStop(0, '#0c1322'); // deep dark blue-grey
    bgGrad.addColorStop(1, '#05070c'); // near black
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Draw nice futuristic grid lines
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.04)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  } else {
    ctx.clearRect(0, 0, width, height);
  }

  // Draw logo elements centered
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  if (width === 1200 && height === 630) {
    // OG Image layout: Left side logo, right side text
    const logoSize = 250;
    scale = logoSize / 40;
    offsetX = 150;
    offsetY = (height - logoSize) / 2;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    renderLogoPaths(ctx);
    ctx.restore();

    // Text details
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 72px sans-serif';
    ctx.fillText('AUDNIX AI', 500, 240);

    ctx.fillStyle = '#22d3ee';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText('The #1 Autonomous AI Sales Rep', 500, 310);

    ctx.fillStyle = '#9ca3af';
    ctx.font = '22px sans-serif';
    ctx.fillText('Close High-Ticket Deals 24/7 on Autopilot', 500, 370);
    ctx.fillText('Autonomous Timing & Objection Handling', 500, 410);

  } else {
    // Normal centered logo
    const minDim = Math.min(width, height);
    scale = (minDim * 0.85) / 40;
    offsetX = (width - 40 * scale) / 2;
    offsetY = (height - 40 * scale) / 2;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    renderLogoPaths(ctx);
    ctx.restore();
  }
  ctx.restore();
}

function renderLogoPaths(ctx: any) {
  const grad = ctx.createLinearGradient(20, 4, 20, 31);
  grad.addColorStop(0, '#67e8f9');
  grad.addColorStop(1, '#22d3ee');

  // 1. Path: Outer triangle M20 4L34 31H6L20 4Z
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(20, 4);
  ctx.lineTo(34, 31);
  ctx.lineTo(6, 31);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // 2. Path: Inner triangle M20 7L30 28H10L20 7Z
  ctx.save();
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(20, 7);
  ctx.lineTo(30, 28);
  ctx.lineTo(10, 28);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // 3. Circle: cx=20, cy=19, r=3.5
  ctx.save();
  ctx.fillStyle = '#22d3ee';
  ctx.beginPath();
  ctx.arc(20, 19, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 4. Path: Bottom line M14 22H26
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(14, 22);
  ctx.lineTo(26, 22);
  ctx.stroke();
  ctx.restore();
}

function saveCanvas(width: number, height: number, filename: string, theme: 'transparent' | 'dark' = 'transparent') {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  drawLogo(ctx, width, height, theme);
  const buffer = canvas.toBuffer('image/png');
  const filePath = path.join(PUBLIC_DIR, filename);
  fs.writeFileSync(filePath, buffer);
  console.log(`✓ Generated ${filename} (${width}x${height}) -> ${filePath}`);
}

async function main() {
  if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  }

  saveCanvas(512, 512, 'logo.png', 'transparent');
  saveCanvas(32, 32, 'favicon.png', 'transparent');
  saveCanvas(32, 32, 'favicon.ico', 'transparent'); // browsers can render PNG favicon.ico
  saveCanvas(16, 16, 'favicon-16x16.png', 'transparent');
  saveCanvas(32, 32, 'favicon-32x32.png', 'transparent');
  saveCanvas(512, 512, 'favicon-white.png', 'transparent');
  saveCanvas(180, 180, 'apple-touch-icon.png', 'transparent');
  saveCanvas(1200, 630, 'og-image.png', 'dark');

  console.log('\n⭐ All asset generation complete!');
}

main().catch(err => {
  console.error('Error generating assets:', err);
  process.exit(1);
});
