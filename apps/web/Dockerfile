FROM oven/bun:alpine AS base

FROM base AS builder

WORKDIR /app

ARG FREESOUND_CLIENT_ID
ARG FREESOUND_API_KEY
ARG NEXT_PUBLIC_MARBLE_API_URL=https://api.marblecms.com
ARG MARBLE_WORKSPACE_KEY=build-placeholder
# 构建期代理：next/font 要从 Google Fonts 拉 Inter，大陆直连不通。
# compose 里 build.network=host + HTTP(S)_PROXY 指向宿主 Clash。
ARG HTTP_PROXY
ARG HTTPS_PROXY
ENV HTTP_PROXY=$HTTP_PROXY HTTPS_PROXY=$HTTPS_PROXY

COPY package.json package.json
COPY bun.lock bun.lock
COPY turbo.json turbo.json

COPY apps/web/package.json apps/web/package.json
RUN bun install

COPY apps/web/ apps/web/

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Build-time env stubs to pass zod validation
ENV DATABASE_URL="postgresql://opencut:opencut@localhost:5432/opencut"
ENV BETTER_AUTH_SECRET="build-time-secret"
ENV UPSTASH_REDIS_REST_URL="http://localhost:8079"
ENV UPSTASH_REDIS_REST_TOKEN="example_token"
ENV NEXT_PUBLIC_SITE_URL="http://localhost:3000"
ENV NEXT_PUBLIC_MARBLE_API_URL=$NEXT_PUBLIC_MARBLE_API_URL
ENV MARBLE_WORKSPACE_KEY=$MARBLE_WORKSPACE_KEY

ENV FREESOUND_CLIENT_ID=$FREESOUND_CLIENT_ID
ENV FREESOUND_API_KEY=$FREESOUND_API_KEY

WORKDIR /app/apps/web
RUN bun run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# 用镜像自带的 bun 用户（uid/gid 1000）跑，和宿主 keido 对齐，
# 转码产物目录用 bind mount 时不用 sudo 改属主。
#
# ffmpeg/ffprobe：服务端素材转码。浏览器解不了 HEVC / 10bit / 4:2:2，
# 前端把素材流式传上来，在这里转成 H.264 8bit 4:2:0 再回传。
RUN sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories \
    && apk add --no-cache ffmpeg
RUN mkdir -p /data/media/tmp /data/media/out \
    && chown -R bun:bun /data/media

COPY --from=builder --chown=bun:bun /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=bun:bun /app/apps/web/.next/standalone ./
COPY --from=builder --chown=bun:bun /app/apps/web/.next/static ./apps/web/.next/static

RUN chown bun:bun apps

USER bun

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["bun", "apps/web/server.js"]
