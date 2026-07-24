import express, { type Express, type Request, type Response } from "express";
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

// Serve the built React dashboard (present in production Docker builds)
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const dashboardDist = path.resolve(currentDir, "../../dashboard/dist/public");

if (existsSync(dashboardDist)) {
  app.use(express.static(dashboardDist));

  // SPA catch-all: let React Router handle all non-API paths
  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(dashboardDist, "index.html"));
  });
} else {
  logger.warn(
    { dashboardDist },
    "Dashboard build not found — static files will not be served. Run `pnpm --filter @workspace/dashboard run build` to build the dashboard.",
  );
}

export default app;
