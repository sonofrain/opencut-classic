> **This is a personal fork.** Upstream: [OpenCut-app/opencut-classic](https://github.com/OpenCut-app/opencut-classic) (archived).
> All local changes live on the `local` branch; `main` tracks upstream verbatim.
> 本仓库是自用 fork，改动清单见文末。

# OpenCut (Legacy)

This is the original OpenCut codebase. It's archived and no longer maintained.

The rewrite is happening at [opencut-app/opencut](https://github.com/opencut-app/opencut).

## Sponsors

Thanks to [Vercel](https://vercel.com?utm_source=github-opencut&utm_campaign=oss) and [fal.ai](https://fal.ai?utm_source=github-opencut&utm_campaign=oss) for their support of open-source software.

<a href="https://vercel.com/oss">
  <img alt="Vercel OSS Program" src="https://vercel.com/oss/program-badge.svg" />
</a>

<a href="https://fal.ai">
  <img alt="Powered by fal.ai" src="https://img.shields.io/badge/Powered%20by-fal.ai-000000?style=flat&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyIDJMMTMuMDkgOC4yNkwyMCAxMEwxMy4wOSAxNS43NEwxMiAyMkwxMC45MSAxNS43NEw0IDEwTDEwLjkxIDguMjZMMTIgMloiIGZpbGw9IndoaXRlIi8+Cjwvc3ZnPgo=" />
</a>

## Why?

- **Privacy**: Your videos stay on your device
- **Free features**: Most basic CapCut features are now paywalled 
- **Simple**: People want editors that are easy to use - CapCut proved that

## Project Structure

- `apps/web/`: Next.js web application
- `apps/desktop/`: Native desktop app built with GPUI (in progress)
- `rust/`: Platform-agnostic core: GPU compositor, effects, masks, and WASM bindings. We're actively migrating business logic here from TypeScript.
- `docs/`: Architecture and subsystem documentation

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/docs/installation)
- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)

> **Note:** Docker is optional but recommended for running the local database and Redis. If you only want to work on frontend features, you can skip it.

### Setup

1. Fork and clone the repository

2. Copy the environment file:

   ```bash
   # Unix/Linux/Mac
   cp apps/web/.env.example apps/web/.env.local

   # Windows PowerShell
   Copy-Item apps/web/.env.example apps/web/.env.local
   ```

3. Start the database and Redis:

   ```bash
   docker compose up -d db redis serverless-redis-http
   ```

4. Install dependencies and start the dev server:

   ```bash
   bun install
   bun dev:web
   ```

The application will be available at [http://localhost:3000](http://localhost:3000).

The `.env.example` has sensible defaults that match the Docker Compose config — it should work out of the box.

### Desktop setup

Desktop is opt-in. If you're only working on the web app, skip this entirely.

If you want to get ready for `apps/desktop`, see [`apps/desktop/README.md`](apps/desktop/README.md). It's a two-step setup: Rust toolchain first, then desktop native dependencies.

### Local WASM development

Only needed if you're editing `rust/wasm` and want the web app to use your local build instead of the published package.

**Prerequisites** — install these once before anything else:

```bash
# Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# build the WASM package
cargo install wasm-pack

# reruns the build on file changes, used by bun dev:wasm
cargo install cargo-watch
```

1. Build the package once from the repo root:

   ```bash
   bun run build:wasm
   ```

2. Register the generated package for linking:

   ```bash
   cd rust/wasm/pkg
   bun link
   ```

3. Link `apps/web` to the local package:

   ```bash
   cd apps/web
   bun link opencut-wasm
   ```

4. Rebuild on changes while you work:

   ```bash
   bun dev:wasm
   ```

To switch `apps/web` back to the published package, run:

```bash
cd apps/web
bun add opencut-wasm
```

### Self-Hosting with Docker

To run everything (including a production build of the app) in Docker:

```bash
docker compose up -d
```

The app will be available at [http://localhost:3100](http://localhost:3100).

## Contributing

We welcome contributions! While we're actively developing and refactoring certain areas, there are plenty of opportunities to contribute effectively.

**🎯 Focus areas:** Timeline functionality, project management, performance, bug fixes, and UI improvements outside the preview panel.

**⚠️ Avoid for now:** Preview panel enhancements (fonts, stickers, effects) and export functionality - we're refactoring these with a new binary rendering approach.

See our [Contributing Guide](.github/CONTRIBUTING.md) for detailed setup instructions, development guidelines, and complete focus area guidance.

**Quick start for contributors:**

- Fork the repo and clone locally
- Follow the setup instructions in CONTRIBUTING.md
- Working on `apps/desktop`? See [`apps/desktop/README.md`](apps/desktop/README.md) for setup
- Create a feature branch and submit a PR

## License

[MIT LICENSE](LICENSE)

---

![Star History Chart](https://api.star-history.com/svg?repos=opencut-app/opencut&type=Date)



---

## 本 fork 的改动（自用，不提 PR）

上游 `opencut-classic` 已于 2025 年归档，不再更新；本 fork 只保留本机部署必须的修补。
`main` = 上游原样，`local` = 下面这些改动。

### 1. `docker-compose.yml`：web 服务加 `init: true`，修僵尸进程堆积

```yaml
  web:
    restart: unless-stopped
    init: true          # tini 当 pid 1：healthcheck 的 sh/wget 退出后被回收，不再堆僵尸
```

**症状**：容器跑起来后宿主 `ps` 里出现上百个 `wget <defunct>`，一天能到 128+，重启容器才清。

**根因**：compose 里 web 服务的 healthcheck 用 `CMD-SHELL` 起 `sh -c "wget ..."`，每 30 秒一轮。这些进程的父进程是容器的 pid 1（`node`/`bun` 应用）。运行时不会为「非自己 spawn」的子进程 `wait`，于是每次探活都留一个僵尸。

**修法**：`init: true` 让 Docker 在容器里注入 tini 当 pid 1，所有孤儿和探活子进程都会被 `wait` 掉。

**验证**：重建后 `ps -eo stat=,comm= | awk '$1 ~ /^Z/'` 观察 10 分钟（20 次探活）仍为 0。

### 2. `docker-compose.yml`：去掉 postgres / redis 的宿主端口暴露

上游把 `5432` 和 `6379` 直接映射到宿主，本机没必要暴露数据库和缓存：

```yaml
-    ports:
-      - "5432:5432"
```

容器之间走 compose 网络，功能不受影响。

### 3. TypeScript 编译适配（classic 代码 vs 升级后的依赖）

上游归档后依赖继续升级，几处调用点的 API 签名变了，不改编译不过：

- `apps/web/src/services/storage/migrations/runner.ts`、`v1-to-v2.ts`
  `new IndexedDBAdapter(name, store, version)` → `new IndexedDBAdapter({ dbName, storeName, version })`；
  `adapter.set(key, val)` → `adapter.set({ key, val })`
- `apps/web/src/stickers/providers/index.ts`
  `registry.register(id, provider)` → `registry.register({ key: id, definition: provider })`
- `apps/web/src/actions/definitions.ts`、`keybinding.ts`
  新增 `isActionWithOptionalArgs()` 类型守卫，收窄 `TActionWithOptionalArg` 判定（`remove-media-asset(s)` 必须带参数）

这些只改调用点，不动业务逻辑。

### 4. 服务端自动转码（新增功能）

浏览器 WebCodecs 解不了 HEVC / 10bit H.264 / 4:2:2 / ProRes，素材能上传但预览不了。
现在导入前先探测，解不了的交给服务端 ffmpeg 转成 H.264 8bit 4:2:0 再回传：

- `apps/web/src/app/api/media/transcode/route.ts` —— 流式上传 / 查进度 / 取回产物 / 取消
- `apps/web/src/app/api/media/stats/route.ts` —— 磁盘空间、任务队列、缓存列表
- `apps/web/src/app/api/media/_lib/transcode-service.ts` —— ffmpeg 调度、进度解析、磁盘统计
- `apps/web/src/media/transcode-client.ts` —— 前端上传（XHR 带进度）+ 轮询 + 取回
- `apps/web/src/media/transcode-preference.ts` —— 分辨率与「仅此次 / 长期允许」偏好
- `apps/web/src/components/editor/panels/assets/transcode-confirm-dialog.tsx` —— 上传后的询问弹窗
- `apps/web/src/components/editor/panels/assets/transcode-manager-dialog.tsx` —— 管理弹窗（素材面板工具栏图标）

行为：

- 只处理浏览器解不了的素材，能直接播的不动
- 默认 1080p，可选 720p / 保持原分辨率
- 上传后弹窗问「仅此次转码 / 长期允许，直接转」，选长期后不再问
- 服务器只留转码产物（容器内 `/data/media/out`，宿主 `~/docker/opencut/media`），源文件转完即删
- 转码参数：libx264 / high / yuv420p / CRF 20 / veryfast / AAC 192k / +faststart

镜像改动：runner 阶段 `apk add ffmpeg`，改用镜像自带的 bun 用户（uid 1000）运行，保持 bind mount 不用 sudo 改属主。

---

*上游已归档，没有跟进成本。若将来迁到新版 OpenCut（重写版），本 fork 作废。*
