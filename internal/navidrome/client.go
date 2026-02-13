// Package navidrome 封装对 Navidrome (Subsonic API) 的调用
package navidrome

import (
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
)

// Subsonic API 版本
const apiVersion = "1.16.1"
const clientName = "NaviPlaylist"

// Song 表示一首歌曲（XML 从属性读取，JSON 使用小写字段名供前端使用）
type Song struct {
	ID     string `xml:"id,attr" json:"id"`
	Title  string `xml:"title,attr" json:"title"`
	Artist string `xml:"artist,attr" json:"artist"`
	Album  string `xml:"album,attr" json:"album"`
	Path   string `xml:"path,attr" json:"path"`
}

// searchResult3 Subsonic search3 响应结构
// 歌曲信息在 <song> 标签的属性中（title, artist, album 等），attr 正确从属性读取
// 支持：直接 <song>、<child>、以及 <match><song/></match> 包装
type searchResult3 struct {
	XMLName  xml.Name `xml:"searchResult3"`
	Songs    []Song   `xml:"song"`
	Children []Song   `xml:"child"`
	Matches  []struct {
		Song Song `xml:"song"`
	} `xml:"match"`
}

// subsonicResponse Subsonic 通用响应包装
type subsonicResponse struct {
	XMLName xml.Name      `xml:"subsonic-response"`
	Status  string        `xml:"status,attr"`
	Result  searchResult3 `xml:"searchResult3"`
	Error   *struct {
		Code    int    `xml:"code,attr"`
		Message string `xml:"message,attr"`
	} `xml:"error"`
}

// Client Navidrome API 客户端
type Client struct {
	baseURL  string
	user     string
	password string
	client   *http.Client
}

// NewClient 创建 Navidrome 客户端
func NewClient(baseURL, user, password string) *Client {
	return &Client{
		baseURL:  baseURL,
		user:     user,
		password: password,
		client:   &http.Client{},
	}
}

// Search 调用 search3.view 搜索歌曲，返回匹配的歌曲列表
func (c *Client) Search(query string) ([]Song, error) {
	u, err := url.Parse(c.baseURL + "/rest/search3.view")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("u", c.user)
	q.Set("p", c.password)
	q.Set("v", apiVersion)
	q.Set("c", clientName)
	q.Set("query", query)
	q.Set("songCount", "50")
	u.RawQuery = q.Encode()

	fullURL := u.String()
	log.Printf("发起搜索请求: %s", fullURL)

	resp, err := c.client.Get(fullURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	log.Printf("收到响应: %s", string(body))

	var sr subsonicResponse
	if err := xml.Unmarshal(body, &sr); err != nil {
		return nil, fmt.Errorf("解析 Subsonic 响应失败: %w", err)
	}

	if sr.Status != "ok" && sr.Error != nil {
		return nil, fmt.Errorf("Subsonic API 错误: %s", sr.Error.Message)
	}

	// 合并多种结构：直接 song、child、或 match>song
	songs := sr.Result.Songs
	if len(songs) == 0 && len(sr.Result.Children) > 0 {
		songs = sr.Result.Children
	}
	if len(songs) == 0 && len(sr.Result.Matches) > 0 {
		for _, m := range sr.Result.Matches {
			songs = append(songs, m.Song)
		}
	}
	return songs, nil
}

// pingResponse ping.view 响应结构
type pingResponse struct {
	XMLName xml.Name `xml:"subsonic-response"`
	Status  string   `xml:"status,attr"`
	Error   *struct {
		Code    int    `xml:"code,attr"`
		Message string `xml:"message,attr"`
	} `xml:"error"`
}

// createPlaylistResponse createPlaylist 响应结构（用于解析错误）
type createPlaylistResponse struct {
	XMLName xml.Name `xml:"subsonic-response"`
	Status  string   `xml:"status,attr"`
	Error   *struct {
		Code    int    `xml:"code,attr"`
		Message string `xml:"message,attr"`
	} `xml:"error"`
}

// CreatePlaylist 调用 createPlaylist.view 在 Navidrome 服务端创建歌单
// songIds: 每首歌的 id（来自 search3 返回的 <song id="..."> 属性）
// 参见 Subsonic API: https://opensubsonic.netlify.app/docs/endpoints/createplaylist
func (c *Client) CreatePlaylist(name string, songIds []string) error {
	u, err := url.Parse(c.baseURL + "/rest/createPlaylist.view")
	if err != nil {
		return err
	}
	q := u.Query()
	q.Set("u", c.user)
	q.Set("p", c.password)
	q.Set("v", apiVersion)
	q.Set("c", clientName)
	q.Set("name", name)
	// 添加 shared=true 参数确保歌单对所有用户可见
	q.Set("shared", "true")
	for _, id := range songIds {
		q.Add("songId", id)
	}
	u.RawQuery = q.Encode()

	fullURL := u.String()
	log.Printf("发起创建歌单请求: %s", fullURL)

	resp, err := c.client.Get(fullURL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	log.Printf("createPlaylist 响应: %s", string(body))

	var sr createPlaylistResponse
	if err := xml.Unmarshal(body, &sr); err != nil {
		return fmt.Errorf("解析 createPlaylist 响应失败: %w", err)
	}

	if sr.Status != "ok" && sr.Error != nil {
		return fmt.Errorf("Subsonic API 错误: %s", sr.Error.Message)
	}
	return nil
}

// Ping 调用 ping.view 测试连接和认证
// 返回 nil 表示成功，否则返回错误信息
// 错误类型：
//   - 网络错误：无法连接服务器
//   - 认证错误：错误码 40（用户名或密码错误）
//   - 其他 API 错误
func (c *Client) Ping() error {
	u, err := url.Parse(c.baseURL + "/rest/ping.view")
	if err != nil {
		return err
	}
	q := u.Query()
	q.Set("u", c.user)
	q.Set("p", c.password)
	q.Set("v", apiVersion)
	q.Set("c", clientName)
	u.RawQuery = q.Encode()

	fullURL := u.String()
	log.Printf("发起连接测试请求: %s", fullURL)

	resp, err := c.client.Get(fullURL)
	if err != nil {
		// 网络错误：无法连接服务器
		return fmt.Errorf("network_error: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("读取响应失败: %w", err)
	}

	log.Printf("ping 响应: %s", string(body))

	var pr pingResponse
	if err := xml.Unmarshal(body, &pr); err != nil {
		return fmt.Errorf("解析 ping 响应失败: %w", err)
	}

	if pr.Status != "ok" && pr.Error != nil {
		// 认证错误：错误码 40
		if pr.Error.Code == 40 {
			return fmt.Errorf("auth_error: %s", pr.Error.Message)
		}
		// 其他 API 错误
		return fmt.Errorf("api_error: %s", pr.Error.Message)
	}

	return nil
}
