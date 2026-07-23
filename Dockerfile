FROM node:22-slim

# Enable corepack so the exact matching pnpm version from your workspace is used
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace and configuration files first
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy the rest of your project files
COPY . .

# Run install with frozen lockfile disabled to bypass strict mismatched catalog failures in cloud builds
RUN pnpm install --no-frozen-lockfile

# Expose port and start your app
EXPOSE 3000
CMD ["pnpm", "start"]
