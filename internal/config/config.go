// Package config 负责从环境变量加载应用配置
package config

import (
	"os"
	"strings"
)

// Config 应用配置
type Config struct {
	NaviURL  string // Navidrome 服务器地址，如 http://localhost:4533
	NaviUser string // Navidrome 用户名
	NaviPass string // Navidrome 密码
}

// Load 从环境变量加载配置
func Load() (*Config, error) {
	cfg := &Config{
		NaviURL:  strings.TrimRight(os.Getenv("NAVI_URL"), "/"),
		NaviUser: os.Getenv("NAVI_USER"),
		NaviPass: os.Getenv("NAVI_PASS"),
	}
	return cfg, nil
}
