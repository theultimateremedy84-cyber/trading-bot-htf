# Single-stage build so that pnpm + drizzle-kit remain available at runtime
# for the startup schema-push. The image is a bit larger (~400 MB) but fully
# self-contained – no manual migration step needed after the first deploy.

FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy root workspace configuration
COPY package.json tsconfig.json tsconfig.base.json ./

# Copy only the packages the API server needs
COPY artifacts/api-server ./artifacts/api-server
COPY lib/api-zod         ./lib/api-zod
COPY lib/db              ./lib/db

# Copy the startup script
COPY scripts/start.sh ./start.sh
RUN chmod +x ./start.sh

# Write a minimal pnpm-workspace.yaml – only the three packages that matter.
# The original file also lists lib/api-client-react and lib/api-spec which are
# frontend-only; including them in the server build confuses Railway.
RUN printf 'packages:\n  - "artifacts/api-server"\n  - "lib/api-zod"\n  - "lib/db"\nautoInstallPeers: false\n' \
    > pnpm-workspace.yaml

# Replace every "catalog:" version reference with "*" and strip the
# preinstall guard (it rejects non-pnpm agents and breaks Docker builds).
RUN node -e '
  const fs = require("fs");
  function walk(dir) {
    let out = [];
    for (const f of fs.readdirSync(dir)) {
      const full = dir + "/" + f;
      if (f === "node_modules" || f === ".git") continue;
      if (fs.statSync(full).isDirectory()) out = out.concat(walk(full));
      else if (f === "package.json") out.push(full);
    }
    return out;
  }
  walk(".").forEach(file => {
    let txt = fs.readFileSync(file, "utf8");
    let out = txt.replace(/"catalog:"/g, "\"*\"");
    if (file === "./package.json") {
      const pkg = JSON.parse(out);
      delete pkg.scripts.preinstall;  // remove pnpm-only guard
      delete pkg.dependencies;        // @replit/connectors-sdk not needed
      out = JSON.stringify(pkg, null, 2);
    }
    if (txt !== out) fs.writeFileSync(file, out);
  });
'

# Install all workspace dependencies (including drizzle-kit for migrations)
RUN pnpm install --no-frozen-lockfile --ignore-scripts

# Bundle the API server with esbuild → artifacts/api-server/dist/
RUN pnpm --filter @workspace/api-server run build

# Railway injects PORT automatically; the server reads it at startup.
EXPOSE 3000

# start.sh runs `drizzle-kit push --force` then starts the server.
CMD ["./start.sh"]
