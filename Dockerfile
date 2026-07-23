FROM node:22-slim

# Enable corepack for pnpm support
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy the entire repository into the container first (avoids missing file/path errors)
COPY . .

# Install dependencies allowing a non-frozen lockfile pass
RUN pnpm install --no-frozen-lockfile

# Expose port and start your app
EXPOSE 3000
CMD ["pnpm", "start"]
