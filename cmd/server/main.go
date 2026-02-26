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
const Version = "1.3.0"

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

	// 定位 web 静态文件目录
	webDir := os.Getenv("WEB_DIR")
	if webDir == "" {
		exe, _ := os.Executable()
		exeDir := filepath.Dir(exe)

		// 优先检查可执行文件同级的 web 目录
		webDir = filepath.Join(exeDir, "web")
		if _, err := os.Stat(webDir); err != nil {
			// 开发环境下，尝试当前工作目录下的 web
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
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("X-Content-Type-Options", "nosniff")

			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}

			next.ServeHTTP(w, r)
		})
	})

	// 1. 注册 API 路由 (后端接口)
	h.RegisterRoutes(r)

	// 2. 静态资源路由 (映射 web/static 文件夹)
	// 这样 HTML 里的 /static/app.js 就能指向 web/static/app.js
	staticDir := filepath.Join(webDir, "static")
	r.Handle("/static/*", http.StripPrefix("/static/", http.FileServer(http.Dir(staticDir))))

	// 3. 首页路由
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(webDir, "index.html"))
	})

	addr := ":8080"
	if p := os.Getenv("PORT"); p != "" {
		addr = ":" + p
	}
	log.Printf("NaviPlaylist 启动于 http://localhost%s", addr)
	log.Printf("Web 目录路径: %s", webDir)

	log.Fatal(http.ListenAndServe(addr, r))
}
