FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# ── Copy root workspace configuration ────────────────────────────────────────
COPY package.json tsconfig.json tsconfig.base.json ./

# ── Copy all packages needed for the build ───────────────────────────────────
COPY artifacts/api-server   ./artifacts/api-server
COPY artifacts/dashboard    ./artifacts/dashboard
COPY lib/api-zod            ./lib/api-zod
COPY lib/api-client-react   ./lib/api-client-react
COPY lib/db                 ./lib/db

# ── Copy helper scripts ───────────────────────────────────────────────────────
COPY docker-setup.js ./docker-setup.js
COPY scripts/start.sh ./start.sh
RUN chmod +x ./start.sh

# ── Write a minimal pnpm-workspace.yaml ──────────────────────────────────────
# List only the packages that actually exist in this build context.
RUN printf 'packages:\n  - "artifacts/api-server"\n  - "artifacts/dashboard"\n  - "lib/api-zod"\n  - "lib/api-client-react"\n  - "lib/db"\nautoInstallPeers: false\n' > pnpm-workspace.yaml

# ── Replace "catalog:" refs and clean root package.json ──────────────────────
RUN node docker-setup.js && rm docker-setup.js

# ── Install all workspace dependencies ───────────────────────────────────────
RUN pnpm install --no-frozen-lockfile --ignore-scripts

# ── Build the React dashboard ─────────────────────────────────────────────────
# BASE_PATH=/ serves the SPA at the root of the Railway domain.
# NODE_ENV=production skips Replit-only dev plugins.
RUN BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/dashboard run build

# ── Bundle the API server with esbuild ───────────────────────────────────────
RUN pnpm --filter @workspace/api-server run build

# ── Railway injects PORT automatically ───────────────────────────────────────
EXPOSE 3000

# start.sh pushes the DB schema then starts the server
CMD ["./start.sh"]
