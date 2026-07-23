FROM node:20-slim

WORKDIR /app

RUN npm install -g pnpm@9

COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./

COPY lib/api-spec/package.json lib/api-spec/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/db/package.json lib/db/
COPY artifacts/api-server/package.json artifacts/api-server/
COPY artifacts/dashboard/package.json artifacts/dashboard/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @workspace/api-spec run codegen
RUN pnpm --filter @workspace/api-server run build
RUN pnpm --filter @workspace/dashboard run build

EXPOSE 5000

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
