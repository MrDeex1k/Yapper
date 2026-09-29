# syntax=docker/dockerfile:1
FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS dependencies
WORKDIR /workspace
RUN npm install --global pnpm@12.6.0
COPY . .
RUN pnpm install --frozen-lockfile

FROM dependencies AS web-build
RUN pnpm --filter @yapper/web build

FROM dependencies AS auth-deploy
RUN pnpm --filter @yapper/auth deploy --prod /out/auth

FROM oven/bun:1.4.2-slim@sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61 AS auth
WORKDIR /app
ENV NODE_ENV=production
COPY --from=auth-deploy --chown=bun:bun /out/auth /app
COPY --chown=bun:bun bunfig.toml /app/bunfig.toml
USER bun
CMD ["bun", "src/index.ts"]

FROM golang:1.27.1@sha256:3680233e3204827fbdc66088528ae6d4b3d034f51d03a99d454f6de034888244 AS go-build
WORKDIR /workspace/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/yapper ./cmd/yapper

FROM scratch AS server
COPY --from=go-build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=go-build /out/yapper /yapper
USER 10001:10001
ENTRYPOINT ["/yapper"]

FROM caddy:2.11.2-alpine@sha256:834468128c7696cec0ceea6172f7d692daf645ae51983ca76e39da54a97c570d AS ingress
COPY --from=web-build /workspace/apps/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
