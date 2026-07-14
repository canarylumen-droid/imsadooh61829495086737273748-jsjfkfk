import { type Express } from "express";
import fs from "fs";
import path from "path";
import { type Server } from "http";
import { nanoid } from "nanoid";
import { log } from "./static.js";

export async function setupVite(app: Express, server: Server) {
  // ONLY import Vite in development mode - this prevents Rollup from loading in production
  const { createServer: createViteServer, createLogger } = await import("vite");
  const viteConfig = (await import("../../../vite.config.js")).default;
  const viteLogger = createLogger();

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        console.error(`[Vite Error]: ${msg}`);
      },
    },
    server: {
      ...viteConfig.server,
      middlewareMode: true,
      hmr: {
        port: parseInt(process.env.VITE_HMR_PORT || "24679"),
      },
    },
    appType: "custom",
  });

  app.use(vite.middlewares);
  // Skip Vite for API routes - let Express handlers take over
  app.use("*", async (req, res, next) => {
    // Skip Vite for API routes
    if (req.path.startsWith('/api/') || req.path.startsWith('/webhook/')) {
      return next();
    }

    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
