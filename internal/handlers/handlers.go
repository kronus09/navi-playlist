// Package handlers 提供 HTTP API 和静态文件托管
package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"strings"
	"unicode"

	"navi-playlist/internal/navidrome"

	"github.com/go-chi/chi/v5"
)

// Handler 组合所有依赖
type Handler struct {
	navi   *navidrome.Client
	webDir string
}

// New 创建 Handler
func New(navi *navidrome.Client, webDir string) *Handler {
	return &Handler{
		navi:   navi,
		webDir: webDir,
	}
}

// 搜索请求体
type searchRequest struct {
	Items []string `json:"items"` // 每行格式: "歌名 - 歌手"
}

// 搜索结果事件（流式返回）
// 统一使用 songs 数组返回，确保 id/title/artist/album 字段名一致
type searchEvent struct {
	Type   string           `json:"type"` // progress | result | done
	Index  int              `json:"index,omitempty"`
	Total  int              `json:"total,omitempty"`
	Query  string           `json:"query,omitempty"`
	Status string           `json:"status,omitempty"` // unique | multiple | missing
	Songs  []navidrome.Song `json:"songs"`
}

// 生成请求体
type generateRequest struct {
	PlaylistName string           `json:"playlistName"`
	Songs        []navidrome.Song `json:"songs"`
}

// 生成响应
type generateResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
	Error   string `json:"error,omitempty"`
}

// parseSongLine 解析 "歌名 - 歌手" 格式，返回 (歌名, 歌手)
// 若无法解析则返回 (原始字符串, "")
func parseSongLine(s string) (title, artist string) {
	s = strings.TrimSpace(s)
	seps := []string{" - ", " – ", " — ", " － "} // 常见分隔符：ASCII 连字符、en dash、em dash、全角
	for _, sep := range seps {
		if i := strings.Index(s, sep); i >= 0 {
			return strings.TrimSpace(s[:i]), strings.TrimSpace(s[i+len(sep):])
		}
	}
	return s, ""
}

// removeAllSpace 强行去除所有空白字符（空格、制表符、全角空格、换行等）用于容错对比
func removeAllSpace(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, s)
}

// artistMatches 模糊匹配：只要结果中的歌手名包含输入的歌手即视为匹配
// 强行去除所有空格后对比，应对 "五 月天"、"五月 天"、"五月天 • 纪晓君" 等情况
func artistMatches(songArtist, inputArtist string) bool {
	if inputArtist == "" {
		return true
	}
	sa := strings.ToLower(removeAllSpace(songArtist))
	ia := strings.ToLower(removeAllSpace(inputArtist))
	return strings.Contains(sa, ia)
}

var (
	reParen  = regexp.MustCompile(`\([^()]*\)`)
	reBracket = regexp.MustCompile(`\[[^\[\]]*\]`)
)

// normalizeTitle 清洗歌名用于对比：忽略大小写，去掉 ()、[] 及其内容，去掉 # 后的内容，去除所有空格
func normalizeTitle(s string) string {
	s = strings.TrimSpace(s)
	// 去掉 # 及其后内容
	if i := strings.Index(s, "#"); i >= 0 {
		s = strings.TrimSpace(s[:i])
	}
	// 循环去掉 () 及内容（处理嵌套）
	for reParen.MatchString(s) {
		s = reParen.ReplaceAllString(s, "")
	}
	// 循环去掉 [] 及内容
	for reBracket.MatchString(s) {
		s = reBracket.ReplaceAllString(s, "")
	}
	return strings.ToLower(removeAllSpace(s))
}

// titleMatches 歌名是否匹配（清洗后对比）
func titleMatches(songTitle, inputTitle string) bool {
	return normalizeTitle(songTitle) == normalizeTitle(inputTitle) ||
		strings.Contains(normalizeTitle(songTitle), normalizeTitle(inputTitle)) ||
		strings.Contains(normalizeTitle(inputTitle), normalizeTitle(songTitle))
}

// filterAndLog 按歌手、歌名过滤，匹配失败时打印详细日志
func filterAndLog(songs []navidrome.Song, inputTitle, inputArtist string) []navidrome.Song {
	var out []navidrome.Song
	for _, s := range songs {
		artistOk := artistMatches(s.Artist, inputArtist)
		titleOk := titleMatches(s.Title, inputTitle)
		if artistOk && titleOk {
			out = append(out, s)
		} else {
			if !artistOk {
				log.Printf("歌手不匹配: [%s] vs [%s]", s.Artist, inputArtist)
			}
			if !titleOk {
				log.Printf("歌名不匹配: [%s] vs [%s]", s.Title, inputTitle)
			}
		}
	}
	return out
}

// RegisterRoutes 注册所有路由
func (h *Handler) RegisterRoutes(r chi.Router) {
	// API 优先匹配
	r.Route("/api", func(r chi.Router) {
		r.Post("/search", h.handleSearch)
		r.Post("/generate", h.handleGenerate)
	})
	// 静态文件：托管 web 目录（FileServer 会自动提供 index.html）
	r.Handle("/*", http.FileServer(http.Dir(h.webDir)))
}

// handleSearch 处理搜索请求，流式返回每个条目的搜索结果
func (h *Handler) handleSearch(w http.ResponseWriter, r *http.Request) {
	var req searchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "无效的请求体", http.StatusBadRequest)
		return
	}
	if len(req.Items) == 0 {
		http.Error(w, "列表不能为空", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}

	encoder := json.NewEncoder(w)
	total := len(req.Items)

	for i, raw := range req.Items {
		query := strings.TrimSpace(raw)
		if query == "" {
			encoder.Encode(searchEvent{Type: "result", Index: i, Total: total, Query: raw, Status: "missing", Songs: []navidrome.Song{}})
			flusher.Flush()
			continue
		}

		// 发送进度
		encoder.Encode(searchEvent{Type: "progress", Index: i, Total: total, Query: query, Status: "searching"})
		flusher.Flush()

		// 解析 "歌名 - 歌手"：只把歌名传给 Navidrome API，收到结果后再按歌手、歌名过滤
		title, artist := parseSongLine(query)
		apiQuery := title
		songs, err := h.navi.Search(apiQuery)
		if err != nil {
			log.Printf("搜索失败 [%s]: %v", query, err)
			encoder.Encode(searchEvent{Type: "result", Index: i, Total: total, Query: query, Status: "missing", Songs: []navidrome.Song{}})
			flusher.Flush()
			continue
		}

		// 按歌手、歌名过滤，匹配失败时打印详细日志
		rawSongs := songs
		songs = filterAndLog(rawSongs, title, artist)

		// 降级搜索：若过滤后无结果但 API 有返回，则忽略过滤条件，返回全部供用户选择
		if len(songs) == 0 && len(rawSongs) > 0 {
			log.Printf("降级搜索: [%s] 过滤后无匹配，返回 %d 条原始结果供用户选择", query, len(rawSongs))
			songs = rawSongs
		}

		// 多版本：把所有匹配成功的（还你自由版、MaydayBlue20th 等）封装成数组返回
		ev := searchEvent{Type: "result", Index: i, Total: total, Query: query, Songs: songs}
		if len(songs) == 0 {
			ev.Status = "missing"
		} else if len(songs) == 1 {
			ev.Status = "unique"
		} else {
			ev.Status = "multiple"
		}
		encoder.Encode(ev)
		flusher.Flush()
	}

	encoder.Encode(searchEvent{Type: "done"})
	flusher.Flush()
}

// handleGenerate 处理歌单创建请求：调用 Subsonic createPlaylist API 在 Navidrome 服务端创建歌单
func (h *Handler) handleGenerate(w http.ResponseWriter, r *http.Request) {
	var req generateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondJSON(w, generateResponse{Success: false, Error: "无效的请求体"}, http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.PlaylistName) == "" {
		respondJSON(w, generateResponse{Success: false, Error: "请输入歌单名称"}, http.StatusBadRequest)
		return
	}
	if len(req.Songs) == 0 {
		respondJSON(w, generateResponse{Success: false, Error: "请至少选择一首歌曲"}, http.StatusBadRequest)
		return
	}

	// 提取每首歌的 id（来自 search3 返回的 XML id 属性，自动选取时也会保留完整 song 对象含 id）
	songIds := make([]string, 0, len(req.Songs))
	for _, s := range req.Songs {
		id := strings.TrimSpace(s.ID)
		if id != "" {
			songIds = append(songIds, id)
		}
	}
	if len(songIds) == 0 {
		respondJSON(w, generateResponse{Success: false, Error: "所选歌曲缺少有效的 id"}, http.StatusBadRequest)
		return
	}

	if err := h.navi.CreatePlaylist(strings.TrimSpace(req.PlaylistName), songIds); err != nil {
		log.Printf("创建歌单失败: %v", err)
		respondJSON(w, generateResponse{Success: false, Error: err.Error()}, http.StatusInternalServerError)
		return
	}

	respondJSON(w, generateResponse{Success: true, Message: "歌单已直接创建至 Navidrome 服务端"}, http.StatusOK)
}

func respondJSON(w http.ResponseWriter, v interface{}, status int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
