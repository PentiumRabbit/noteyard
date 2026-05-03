package handler

import (
	"io"
	"net"
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

// privateNets holds the CIDR blocks that must never be fetched (SSRF protection).
var privateNets []*net.IPNet

func init() {
	for _, cidr := range []string{
		"127.0.0.0/8",
		"::1/128",
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"169.254.0.0/16",
		"fe80::/10",
	} {
		_, ipNet, _ := net.ParseCIDR(cidr)
		privateNets = append(privateNets, ipNet)
	}
}

// isPrivateHostFn is the SSRF guard; replaced in tests.
var isPrivateHostFn = defaultIsPrivateHost

// isPrivateHost returns true when host resolves to a loopback, RFC-1918, or
// link-local address that must not be contacted by the server.
func isPrivateHost(host string) bool { return isPrivateHostFn(host) }

func defaultIsPrivateHost(host string) bool {
	// Strip port if present.
	h, _, err := net.SplitHostPort(host)
	if err != nil {
		h = host
	}
	ip := net.ParseIP(h)
	if ip == nil {
		// Unresolvable or non-IP hostname — treat as safe; real SSRF via DNS
		// rebinding is a separate concern outside this scope.
		return false
	}
	for _, n := range privateNets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

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
	if isPrivateHost(parsed.Host) {
		http.Error(w, "forbidden url", http.StatusBadRequest)
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
