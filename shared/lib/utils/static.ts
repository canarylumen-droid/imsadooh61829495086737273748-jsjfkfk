import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "..", "dist", "public");
  console.log(`[Static] Production static directory: ${distPath}`);

  if (!fs.existsSync(distPath)) {
    console.warn(`⚠️ [Static] Production directory ${distPath} does not exist!`);
    const fallbackPath = path.resolve(process.cwd(), "dist", "public");
    if (fs.existsSync(fallbackPath)) {
      console.log(`[Static] Using fallback CWD path: ${fallbackPath}`);
    } else {
      console.error(`❌ [Static] No valid static directory found at ${distPath} or ${fallbackPath}`);
    }
  } else {
    console.log(`✅ [Static] Found production directory at ${distPath}`);
  }

  // Optimized static serving for production
  app.use(express.static(distPath, {
    dotfiles: 'allow',
    index: false,
    maxAge: '1d',
    setHeaders: (res, filePath) => {
      // Explicit Content-Type for critical assets
      if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
      if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
      if (filePath.endsWith('.json') || filePath.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/json');
      // Set permissive cache for assets but no-cache for index/sw
      if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }));

  // Explicit route handlers for PWA/Manifest files with strict path validation
  app.get(['/sw.js', '/manifest.json', '/favicon.ico', '/robots.txt', '/favicon.svg'], (req, res) => {
    const safeFiles = ['sw.js', 'manifest.json', 'favicon.ico', 'robots.txt', 'favicon.svg'];
    const fileName = req.path.substring(1);

    if (!safeFiles.includes(fileName)) {
      return res.status(404).end();
    }

    const filePath = path.resolve(distPath, fileName);
    if (fs.existsSync(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(filePath);
    } else {
      res.status(404).end();
    }
  });

  // Handle all other routes by serving index.html (SPA)
  app.get('*', (req, res) => {
    // CRITICAL: Never serve index.html for API, Webhook, or Platform-specific internal routes
    const isInternalPlatformRoute = 
      req.path.startsWith('/_vercel/') || 
      req.path.startsWith('/_next/') || 
      req.path.startsWith('/.well-known/');

    if (req.path.startsWith('/api/') || req.path.startsWith('/webhook/') || req.path === '/health' || isInternalPlatformRoute) {
      if (req.path === '/health') {
        return res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
      }
      return res.status(404).json({ error: "Not found" });
    }

    // Do not serve index.html for static assets that were genuinely missing
    if (req.path.match(/\.(js|css|map|png|jpg|svg|ico|json|woff|woff2|ttf)$/i)) {
      return res.status(404).end();
    }

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
