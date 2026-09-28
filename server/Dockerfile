FROM golang:1.26.8-alpine AS build
WORKDIR /src
COPY server/go.mod ./
COPY server/ ./
ARG VERSION=0.5.0-dev
RUN CGO_ENABLED=0 go build -ldflags "-X github.com/MrDeex1k/Yapper/server/internal/app.Version=${VERSION}" -trimpath -o /yapper ./cmd/yapper
FROM alpine:3.23
RUN apk add --no-cache ca-certificates && addgroup -S yapper && adduser -S -G yapper -u 10001 yapper
COPY --from=build /yapper /usr/local/bin/yapper
RUN mkdir -p /data/files && chown -R 10001:10001 /data
USER 10001:10001
ENV HTTP_ADDR=0.0.0.0:8080
EXPOSE 8080
ENTRYPOINT ["yapper"]
