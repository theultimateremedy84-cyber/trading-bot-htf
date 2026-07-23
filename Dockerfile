FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy root workspace configuration
COPY package.json tsconfig.json tsconfig.base.json ./

# Copy only the packages the API server needs
COPY artifacts/api-server ./artifacts/api-server
COPY lib/api-zod         ./lib/api-zod
COPY lib/db              ./lib/db

# Copy helper scripts
COPY docker-setup.js ./docker-setup.js
COPY scripts/start.sh ./start.sh
RUN chmod +x ./start.sh

# Write a minimal pnpm-workspace.yaml with only the three required packages
RUN printf 'packages:\n  - "artifacts/api-server"\n  - "lib/api-zod"\n  - "lib/db"\nautoInstallPeers: false\n' > pnpm-workspace.yaml

# Replace "catalog:" refs with "*" and clean root package.json
RUN node docker-setup.js && rm docker-setup.js

# Install workspace dependencies (includes drizzle-kit for runtime migrations)
RUN pnpm install --no-frozen-lockfile --ignore-scripts

# Bundle the API server with esbuild
RUN pnpm --filter @workspace/api-server run build

# Railway injects PORT automatically
EXPOSE 3000

# start.sh pushes the DB schema then starts the server
CMD ["./start.sh"]
