FROM node:24-alpine AS build
RUN npm install -g pnpm@12.6.0
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/landing/package.json apps/landing/package.json
RUN pnpm install --frozen-lockfile
COPY apps/web/ apps/web/
RUN pnpm --filter @yapper/web build
FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
