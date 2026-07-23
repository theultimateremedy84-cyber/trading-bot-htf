FROM node:22-slim

# Enable corepack and prepare pnpm
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Copy all project files
COPY . .

# Generate the pnpm-workspace.yaml configuration explicitly so local workspace packages resolve
RUN cat > pnpm-workspace.yaml <<'WSEOF'
packages:
  - "artifacts/*"
  - "lib/*"
WSEOF

# Remove old lockfile to ensure a clean sync
RUN rm -f pnpm-lock.yaml

# Install dependencies successfully across the monorepo workspace
RUN pnpm install --no-frozen-lockfile

# Expose port and start your app
EXPOSE 3000
CMD ["pnpm", "start"]
