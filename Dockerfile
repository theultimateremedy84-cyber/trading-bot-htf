FROM node:22-slim

WORKDIR /app

RUN npm install -g pnpm@9.15.9

COPY . .

RUN rm -f pnpm-lock.yaml

RUN pnpm install --no-frozen-lockfile

RUN pnpm --filter @workspace/api-server run build

EXPOSE 5000

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
