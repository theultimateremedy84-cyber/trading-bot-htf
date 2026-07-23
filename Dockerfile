FROM node:22-slim

# Enable corepack and install pnpm
RUN corepack enable && npm install -g pnpm@9.15.9

WORKDIR /app

# Copy all project files
COPY . .

# Use Node.js to safely parse and replace catalog dependencies with actual valid versions across all package.json files
RUN node -e ' \
  const fs = require("fs"); \
  const glob = require("node:fs").readdirSync; \
  // Find package.json files recursively \
  function walk(dir) { \
    let results = []; \
    list = fs.readdirSync(dir); \
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
  let files = walk("."); \
  files.forEach(file => { \
    let content = fs.readFileSync(file, "utf8"); \
    let updated = content.replace(/"catalog:"/g, "\"*\""); \
    if (content !== updated) { \
      fs.writeFileSync(file, updated, "utf8"); \
      console.log("Patched catalogs in: " + file); \
    } \
  }); \
'

# Remove old lockfile to force fresh resolution
RUN rm -f pnpm-lock.yaml

# Install dependencies smoothly
RUN pnpm install --no-frozen-lockfile

# Expose port and start your app
EXPOSE 3000
CMD ["pnpm", "start"]
