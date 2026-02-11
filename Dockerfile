# NaviPlaylist - 多阶段构建以压缩镜像体积

# 阶段1：构建
FROM golang:1.22-alpine AS builder

WORKDIR /app

# 安装依赖
COPY go.mod go.sum ./
RUN go mod download

# 复制源码并构建
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o navi-playlist ./cmd/server

# 阶段2：运行
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

# 从构建阶段复制二进制和静态文件
COPY --from=builder /app/navi-playlist .
COPY --from=builder /app/web ./web

# 默认端口
EXPOSE 8080

ENTRYPOINT ["./navi-playlist"]
