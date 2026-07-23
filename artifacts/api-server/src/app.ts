import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes
app.use("/api", router);

// Serve the pre-built React dashboard as static files.
// In the Docker image the layout is:
//   /app/artifacts/api-server/dist/index.mjs   ← this file (after esbuild)
//   /app/artifacts/dashboard/dist/public/       ← Vite build output
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardDir = path.resolve(__dirname, "..", "..", "dashboard", "dist", "public");

app.use(express.static(dashboardDir));

// SPA fallback — let React Router handle all non-API routes
app.get("(.*)", (_req, res) => {
  res.sendFile(path.join(dashboardDir, "index.html"));
});

export default app;
