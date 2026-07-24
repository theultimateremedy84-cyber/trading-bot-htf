import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
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

// Serve the built React dashboard (present in production Docker builds).
// NOTE: app.get("*") is invalid in Express 5 — use app.use() for the catch-all.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const dashboardDist = path.resolve(currentDir, "../../dashboard/dist/public");

if (existsSync(dashboardDist)) {
  app.use(express.static(dashboardDist));

  // SPA fallback — must use app.use(), not app.get("*"), because Express 5
  // removed wildcard "*" support in route paths.
  app.use((_req: Request, res: Response, _next: NextFunction) => {
    res.sendFile(path.join(dashboardDist, "index.html"));
  });
} else {
  logger.warn(
    { dashboardDist },
    "Dashboard build not found — static files will not be served.",
  );
}

export default app;
