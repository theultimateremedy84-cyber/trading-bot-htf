FROM node:22-slim

# Enable corepack and prepare pnpm
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Copy all project files
COPY . .

# Generate a complete pnpm-workspace.yaml covering all local packages and subdirectories
RUN cat > pnpm-workspace.yaml <<'WSEOF'
packages:
  - "artifacts/api-server"
  - "artifacts/dashboard"
  - "lib/api-client-react"
  - "lib/api-spec"
  - "lib/api-zod"
  - "lib/db"
WSEOF

# Remove old lockfile to clear any stale dependencies
RUN rm -f pnpm-lock.yaml

# Install dependencies successfully across the monorepo workspace
RUN pnpm install --no-frozen-lockfile

# Expose port and start your app
EXPOSE 3000
CMD ["pnpm", "start"]
