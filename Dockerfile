FROM node:22-slim

# Enable corepack for pnpm support
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy the entire workspace files
COPY . .

# Install all workspace dependencies without strict lockfile failures
RUN pnpm install --no-frozen-lockfile

# Expose port and run the app
EXPOSE 3000
CMD ["pnpm", "start"]
