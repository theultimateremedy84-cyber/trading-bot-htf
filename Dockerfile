FROM node:22-slim

WORKDIR /app

RUN npm install -g pnpm@9.15.9

COPY . .

# Use Node (always available) to rewrite config files so pnpm can install
# without Replit-specific workspace features or catalog references.
RUN node -e " \
  const fs = require('fs'); \
  \
  fs.writeFileSync('pnpm-workspace.yaml', \
    'packages:\n  - artifacts/api-server\n  - lib/api-zod\n  - lib/db\n'); \
  \
  const patches = { \
    'artifacts/api-server/package.json': { \
      '\"drizzle-orm\": \"catalog:\"': '\"drizzle-orm\": \"^0.45.2\"', \
      '\"@types/node\": \"catalog:\"': '\"@types/node\": \"^22.0.0\"' \
    }, \
    'lib/db/package.json': { \
      '\"drizzle-orm\": \"catalog:\"': '\"drizzle-orm\": \"^0.45.2\"', \
      '\"zod\": \"catalog:\"': '\"zod\": \"^3.25.76\"', \
      '\"@types/node\": \"catalog:\"': '\"@types/node\": \"^22.0.0\"' \
    }, \
    'lib/api-zod/package.json': { \
      '\"zod\": \"catalog:\"': '\"zod\": \"^3.25.76\"' \
    } \
  }; \
  \
  for (const [file, replacements] of Object.entries(patches)) { \
    let content = fs.readFileSync(file, 'utf8'); \
    for (const [from, to] of Object.entries(replacements)) { \
      content = content.split(from).join(to); \
    } \
    fs.writeFileSync(file, content); \
  } \
  \
  fs.rmSync('pnpm-lock.yaml', { force: true }); \
  console.log('Config files patched successfully'); \
"

RUN pnpm install --no-frozen-lockfile

RUN pnpm --filter @workspace/api-server run build

EXPOSE 5000

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
