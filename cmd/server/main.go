// NaviPlaylist 主程序入口
// 为 Navidrome 创建歌单：从文本列表匹配曲库，通过 Subsonic createPlaylist API 在服务端创建
package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"navi-playlist/internal/config"
	"navi-playlist/internal/handlers"
	"navi-playlist/internal/navidrome"

	"github.com/go-chi/chi/v5"
)

// Version 应用版本号
const Version = "1.2.2"

func main() {
	// 加载配置
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}

	// 校验必填项
	if cfg.NaviURL == "" || cfg.NaviUser == "" || cfg.NaviPass == "" {
		log.Fatal("请设置环境变量: NAVI_URL, NAVI_USER, NAVI_PASS")
	}

	// 定位 web 静态文件目录（相对可执行文件或工作目录）
	webDir := os.Getenv("WEB_DIR")
	if webDir == "" {
		// 默认：与可执行文件同级的 web 目录
		exe, _ := os.Executable()
		webDir = filepath.Join(filepath.Dir(exe), "web")
		if _, err := os.Stat(webDir); err != nil {
			// 开发时可能从项目根运行，尝试 ./web
			webDir = "web"
		}
	}

	// 初始化组件
	naviClient := navidrome.NewClient(cfg.NaviURL, cfg.NaviUser, cfg.NaviPass)
	h := handlers.New(naviClient, webDir, cfg.NaviURL, cfg.NaviUser, Version)

	r := chi.NewRouter()

	// CORS中间件
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// 设置CORS头
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("X-Content-Type-Options", "nosniff")

			// 处理预检请求
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}

			next.ServeHTTP(w, r)
		})
	})

	h.RegisterRoutes(r)

	addr := ":8080"
	if p := os.Getenv("PORT"); p != "" {
		addr = ":" + p
	}
	log.Printf("NaviPlaylist 启动于 http://localhost%s", addr)
	log.Fatal(http.ListenAndServe(addr, r))
}
