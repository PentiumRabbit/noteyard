package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	neturl "net/url"
	"testing"
)

func TestMetaHandler_MissingURL(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/meta", nil)
	w := httptest.NewRecorder()
	MetaHandler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestMetaHandler_InvalidScheme(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/meta?url=ftp://example.com", nil)
	w := httptest.NewRecorder()
	MetaHandler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestMetaHandler_NotParseable(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/meta?url=://bad", nil)
	w := httptest.NewRecorder()
	MetaHandler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestMetaHandler_UnreachableHost_ReturnsOK(t *testing.T) {
	// 192.0.2.x is TEST-NET per RFC5737 — guaranteed unreachable
	req := httptest.NewRequest(http.MethodGet, "/api/meta?url=http://192.0.2.1/", nil)
	w := httptest.NewRecorder()
	MetaHandler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusOK)
	}
	var result MetaResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("response not JSON: %v", err)
	}
	if result.URL != "http://192.0.2.1/" {
		t.Errorf("URL: got %q", result.URL)
	}
	if result.Favicon != "http://192.0.2.1/favicon.ico" {
		t.Errorf("Favicon: got %q", result.Favicon)
	}
}

func TestMetaHandler_LocalServer_OGTags(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(`<html>
<head>
<meta property="og:title" content="My OG Title"/>
<meta property="og:description" content="My OG Desc"/>
<title>Fallback Title</title>
</head></html>`))
	}))
	defer srv.Close()

	req := httptest.NewRequest(http.MethodGet, "/api/meta?url="+srv.URL, nil)
	w := httptest.NewRecorder()
	MetaHandler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d", w.Code)
	}
	var result MetaResult
	json.NewDecoder(w.Body).Decode(&result)
	if result.Title != "My OG Title" {
		t.Errorf("Title: got %q, want %q", result.Title, "My OG Title")
	}
	if result.Description != "My OG Desc" {
		t.Errorf("Description: got %q", result.Description)
	}
}

func TestMetaHandler_LocalServer_FallbackTitle(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(`<html><head><title>Page Title</title></head></html>`))
	}))
	defer srv.Close()

	req := httptest.NewRequest(http.MethodGet, "/api/meta?url="+srv.URL, nil)
	w := httptest.NewRecorder()
	MetaHandler(w, req)

	var result MetaResult
	json.NewDecoder(w.Body).Decode(&result)
	if result.Title != "Page Title" {
		t.Errorf("Title: got %q, want %q", result.Title, "Page Title")
	}
}

func TestMetaHandler_LocalServer_DescriptionTruncated(t *testing.T) {
	longDesc := make([]byte, 300)
	for i := range longDesc {
		longDesc[i] = 'a'
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(`<html><head>
<meta name="description" content="` + string(longDesc) + `"/>
</head></html>`))
	}))
	defer srv.Close()

	req := httptest.NewRequest(http.MethodGet, "/api/meta?url="+srv.URL, nil)
	w := httptest.NewRecorder()
	MetaHandler(w, req)

	var result MetaResult
	json.NewDecoder(w.Body).Decode(&result)
	if len([]rune(result.Description)) > 205 {
		t.Errorf("Description not truncated: len=%d", len(result.Description))
	}
}

func TestExtract(t *testing.T) {
	cases := []struct {
		name string
		html string
		want string
	}{
		{
			name: "OG title wins over <title>",
			html: `<meta property="og:title" content="OG"/><title>Fallback</title>`,
			want: "OG",
		},
		{
			name: "Fallback to <title>",
			html: `<title>Fallback</title>`,
			want: "Fallback",
		},
		{
			name: "No match returns empty",
			html: `<div>nothing</div>`,
			want: "",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := extract(c.html, reOGT, reTitle)
			if got != c.want {
				t.Errorf("extract: got %q, want %q", got, c.want)
			}
		})
	}
}

func TestHTMLUnescape(t *testing.T) {
	cases := []struct{ in, want string }{
		{"&amp;", "&"},
		{"&lt;div&gt;", "<div>"},
		{"&quot;hello&quot;", `"hello"`},
		{"&#39;", "'"},
		{"&nbsp;", " "},
		{"plain text", "plain text"},
	}
	for _, c := range cases {
		got := htmlUnescape(c.in)
		if got != c.want {
			t.Errorf("htmlUnescape(%q): got %q, want %q", c.in, got, c.want)
		}
	}
}

func TestFaviconURL(t *testing.T) {
	cases := []struct{ rawURL, want string }{
		{"https://example.com/page", "https://example.com/favicon.ico"},
		{"http://sub.domain.org/path?q=1", "http://sub.domain.org/favicon.ico"},
	}
	for _, c := range cases {
		parsed, err := neturl.Parse(c.rawURL)
		if err != nil {
			t.Fatalf("parse url: %v", err)
		}
		got := faviconURL(parsed)
		if got != c.want {
			t.Errorf("faviconURL(%q): got %q, want %q", c.rawURL, got, c.want)
		}
	}
}
