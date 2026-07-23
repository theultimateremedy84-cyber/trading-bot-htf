FROM node:22-slim

# Enable corepack and prepare pnpm
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Copy all repository files
COPY . .

# Generate the correct pnpm-workspace.yaml file explicitly
RUN cat > pnpm-workspace.yaml <<'WSEOF'
packages:
  - "artifacts/*"
  - "lib/*"
WSEOF

# Use Node.js to scan every package.json and replace any "catalog:" reference with "*"
RUN node -e ' \
  const fs = require("fs"); \
  function walk(dir) { \
    let results = []; \
    let list = fs.readdirSync(dir); \
    list.forEach(file => { \
      file = dir + "/" + file; \
      let stat = fs.statSync(file); \
      if (stat && stat.isDirectory()) { \
        if (!file.includes("node_modules") && !file.includes(".git")) { \
          results = results.concat(walk(file)); \
        } \
      } else { \
        if (file.endsWith("package.json")) results.push(file); \
      } \
    }); \
    return results; \
  } \
  walk(".").forEach(file => { \
    let content = fs.readFileSync(file, "utf8"); \
    let updated = content.replace(/"catalog:"/g, "\"*\""); \
    if (content !== updated) { \
      fs.writeFileSync(file, updated, "utf8"); \
    } \
  }); \
'

# Remove old lockfile
RUN rm -f pnpm-lock.yaml

# Install dependencies, bypassing the broken binary install script hooks
RUN pnpm install --no-frozen-lockfile --ignore-scripts

# Explicitly run the workspace build step so TypeScript and bundle artifacts are generated
RUN pnpm build

# Expose port and start your app
EXPOSE 3000
CMD ["pnpm", "start"]
