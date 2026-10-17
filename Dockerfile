# syntax=docker/dockerfile:1
FROM node:26.12.0-bookworm-slim@sha256:298992629d69bbd5b2b03ad57094d8e4fcb3a8eeb7c4e25d29de656519568913 AS dependencies
WORKDIR /workspace
RUN npm install --global pnpm@12.14.0
COPY . .
RUN pnpm install --frozen-lockfile

FROM dependencies AS web-build
RUN pnpm --filter @yapper/web build

FROM dependencies AS auth-deploy
RUN pnpm --filter @yapper/auth deploy --prod /out/auth

FROM oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288 AS auth
WORKDIR /app
ENV NODE_ENV=production
COPY --from=auth-deploy --chown=bun:bun /out/auth /app
COPY --chown=bun:bun bunfig.toml /app/bunfig.toml
USER bun
CMD ["bun", "src/index.ts"]

FROM golang:1.27.2@sha256:820153096fda4de6ac1b7194d12e416b7dd8f4e9a33d17e0345b111b945162d8 AS go-build
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

FROM caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f AS ingress
COPY --from=web-build /workspace/apps/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
