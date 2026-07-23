FROM node:22-slim

# Enable corepack and prepare pnpm
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Copy all repository files (now containing both artifacts and libs)
COPY . .

# Explicitly ensure the workspace file covers all packages at the root level
RUN cat > pnpm-workspace.yaml <<'WSEOF'
packages:
  - "artifacts/*"
  - "lib/*"
WSEOF

# Remove old lockfile to prevent stale path resolution
RUN rm -f pnpm-lock.yaml

# Install dependencies across the entire monorepo workspace
RUN pnpm install --no-frozen-lockfile

# Expose port and start your app
EXPOSE 3000
CMD ["pnpm", "start"]
