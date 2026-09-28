FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
# npm's postinstall runs this helper, so it must be available before npm ci.
COPY bin/prepare-terminal.js ./bin/prepare-terminal.js
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PI_WEB_NO_OPEN=1
RUN groupadd --gid 10001 pi && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/pi pi
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/bin ./bin
COPY --from=build /app/next.config.ts ./next.config.ts

USER pi
EXPOSE 30141
ENTRYPOINT ["node", "bin/pi-web.js"]
CMD ["--mode", "multi", "--hostname", "0.0.0.0", "--no-open"]
