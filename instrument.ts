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
