# syntax=docker/dockerfile:1.29.0@sha256:572cebbc2b15e6f84c077742952674889cb63cd5e9b80abdffcbe587b6f19183
FROM node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS dependencies
WORKDIR /workspace
RUN npm install --global pnpm@12.21.0
COPY . .
RUN pnpm install --frozen-lockfile

FROM dependencies AS web-build
RUN pnpm --filter @yapper/web build

FROM dependencies AS auth-deploy
RUN pnpm --filter @yapper/auth deploy --prod /out/auth

FROM oven/bun:1.4.5-slim@sha256:b780593f3e10918cbdaec3d5a08d52224b9198069a65eb47812085c2ec007643 AS auth
WORKDIR /app
ENV NODE_ENV=production
COPY --from=auth-deploy --chown=bun:bun /out/auth /app
COPY --chown=bun:bun bunfig.toml /app/bunfig.toml
USER bun
CMD ["bun", "src/index.ts"]

FROM golang:1.27.4@sha256:205c7636d74e0ffbe3d007162df7d74f859f5a8c8322dfb9f907977686c126cf AS go-build
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

FROM caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0 AS ingress
COPY --from=web-build /workspace/apps/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
