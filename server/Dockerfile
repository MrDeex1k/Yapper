FROM golang:1.27.1-alpine AS build
WORKDIR /src
COPY server/go.mod ./
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /yapper ./cmd/yapper
FROM alpine:3.23
RUN apk add --no-cache ca-certificates && addgroup -S yapper && adduser -S -G yapper -u 10001 yapper
COPY --from=build /yapper /usr/local/bin/yapper
USER 10001:10001
ENV HTTP_ADDR=0.0.0.0:8080
EXPOSE 8080
ENTRYPOINT ["yapper"]
