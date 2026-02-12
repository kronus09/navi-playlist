# NaviPlaylist

从文本列表匹配 Navidrome 曲库，通过 **Subsonic API 直接在服务端创建歌单**，无需配置复杂的物理路径映射。

---

## 项目简介

NaviPlaylist 是一个轻量级工具，帮助你用「歌名 - 歌手」格式的文本列表，批量匹配 Navidrome 中的歌曲并创建歌单。支持模糊匹配、降级搜索与自动选取，适合从歌单网站、播放记录等导出文本后的快速导入。

---

## 技术优势：API 创建歌单

与传统的 M3U 本地生成方案不同，本项目直接调用 **Subsonic createPlaylist API** 在 Navidrome 服务端创建歌单：

| 对比项 | 传统 M3U 方案 | 本方案（Subsonic API） |
|--------|----------------|------------------------|
| 路径配置 | 需配置音乐目录挂载、输出路径 | **无需任何路径配置** |
| 路径映射 | 需处理本地路径与 Navidrome 的对应关系 | **无需处理** |
| 部署复杂度 | 需挂载卷、配置 PLAYLIST_PATH 等 | 只需 Navidrome 地址与账号 |
| 歌单位置 | 本地文件，需手动导入 | **直接出现在 Navidrome 服务端** |

**核心接口**：

- `search3.view`：搜索曲库，获取歌曲 id
- `createPlaylist.view`：提交 songId 列表，在服务端创建歌单

---

## 功能特性

- 支持「歌名 - 歌手」格式的文本列表匹配
- 模糊匹配：歌手名包含即视为匹配（如「五月 天」「五月天 • 纪晓君」）
- 歌名清洗：忽略括号、方括号及 `#` 后内容
- 降级搜索：过滤无结果时返回原始结果供手动选择
- 自动选取首项：若有同名歌曲，可勾选自动选择第一条
- 响应式界面：匹配成功 / 缺失分栏展示

---

## 使用说明

### 环境要求

- Go 1.21+
- Navidrome 服务（支持 Subsonic API）

### 配置

复制 `.env.example` 为 `.env`，按需修改：

```bash
cp .env.example .env
```

或通过环境变量直接设置（参见 `.env.example` 中的说明）。

### 本地运行

```bash
go run ./cmd/server
```

默认监听 `http://localhost:8080`，可通过 `PORT` 环境变量修改端口。

### Docker 运行

```bash
docker compose up -d
```

访问 http://localhost:8080

### 使用 Docker Compose（推荐）

**创建 `docker-compose.yml` 文件**  
   在项目目录下创建文件，内容如下：

   ```yaml

   services:
     navi-playlist:
       image: ghcr.io/kronus09/navi-playlist:latest
       container_name: navi-playlist
       ports:
         - "8080:8080"  # 主机端口:容器端口（按需修改左侧端口）
       restart: always
       # 可选配置（按需取消注释）：
       # environment:
       #   - TZ=Asia/Shanghai  # 设置时区
       #   - APP_ENV=production
       # volumes:
       #   - ./data:/app/data  # 持久化数据（如需）
       #   - ./config.yaml:/app/config.yaml  # 自定义配置
```
---
###🔒 安全提示
✅ 镜像已通过 GitHub Actions 自动构建+签名

✅ 镜像来源：ghcr.io/kronus09/navi-playlist（官方仓库）

✅ 无需 Docker Hub 账号 / Token（公开镜像免认证）

⚠️ 如部署在公网，建议前置 Nginx 添加 HTTPS 和认证


## 许可证

MIT
