FROM node:22-slim

WORKDIR /app

# Pin pnpm to a version that supports the catalog feature (9.5+)
RUN npm install -g pnpm@9.15.9

COPY . .

# Remove the Replit-specific pnpm-workspace.yaml and use the Railway-compatible one
# (already replaced in the repo — this is just a clean install)
RUN pnpm install --no-frozen-lockfile

RUN pnpm --filter @workspace/api-server run build

EXPOSE 5000

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
