package handler

import (
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type MetaResult struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Favicon     string `json:"favicon"`
	URL         string `json:"url"`
}

var (
	reTitle = regexp.MustCompile(`(?i)<title[^>]*>(.*?)</title>`)
	reDesc  = regexp.MustCompile(`(?i)<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']`)
	reDescR = regexp.MustCompile(`(?i)<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']`)
	reOGT   = regexp.MustCompile(`(?i)<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']`)
	reOGD   = regexp.MustCompile(`(?i)<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']`)
)

func MetaHandler(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		http.Error(w, "missing url", http.StatusBadRequest)
		return
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		http.Error(w, "invalid url", http.StatusBadRequest)
		return
	}

	client := &http.Client{Timeout: 8 * time.Second}
	req, _ := http.NewRequest("GET", rawURL, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; noteyard-bot/1.0)")
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, MetaResult{URL: rawURL, Favicon: faviconURL(parsed)})
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		writeJSON(w, http.StatusOK, MetaResult{URL: rawURL, Favicon: faviconURL(parsed)})
		return
	}
	html := string(body)

	title := extract(html, reOGT, reTitle)
	title = strings.TrimSpace(htmlUnescape(title))
	desc := extract(html, reOGD, reDesc, reDescR)
	desc = strings.TrimSpace(htmlUnescape(desc))
	if len(desc) > 200 {
		desc = desc[:200] + "…"
	}

	writeJSON(w, http.StatusOK, MetaResult{
		Title:       title,
		Description: desc,
		Favicon:     faviconURL(parsed),
		URL:         rawURL,
	})
}

func extract(html string, patterns ...*regexp.Regexp) string {
	for _, p := range patterns {
		if m := p.FindStringSubmatch(html); len(m) > 1 && m[1] != "" {
			return m[1]
		}
	}
	return ""
}

func faviconURL(u *url.URL) string {
	return u.Scheme + "://" + u.Host + "/favicon.ico"
}

var htmlEntities = strings.NewReplacer(
	"&amp;", "&", "&lt;", "<", "&gt;", ">",
	"&quot;", `"`, "&#39;", "'", "&nbsp;", " ",
)

func htmlUnescape(s string) string { return htmlEntities.Replace(s) }

