package handler

import (
	"context"
	"database/sql"
	"net/http"
	"strconv"
	"strings"
)

// SearchResult represents a single item returned by the global search API.
type SearchResult struct {
	PageID    string   `json:"page_id"`
	PageTitle string   `json:"page_title"`
	PageIcon  *string  `json:"page_icon"`
	PagePath  []string `json:"page_path"`
	MatchType string   `json:"match_type"` // "title" or "content"
	Snippet   *string  `json:"snippet"`
}

// SearchHandler handles GET /api/search.
type SearchHandler struct {
	db *sql.DB
}

// NewSearchHandler creates a new SearchHandler backed by the given *sql.DB.
func NewSearchHandler(db *sql.DB) *SearchHandler {
	return &SearchHandler{db: db}
}

// Handle serves GET /api/search?q=...&limit=...
func (h *SearchHandler) Handle(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		writeJSON(w, http.StatusOK, map[string][]SearchResult{"results": {}})
		return
	}

	limit := 20
	if ls := r.URL.Query().Get("limit"); ls != "" {
		if n, err := strconv.Atoi(ls); err == nil {
			limit = n
		}
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}

	results, err := h.search(r.Context(), q, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string][]SearchResult{"results": results})
}

// pageRow is an intermediate holder returned by the SQL queries.
type pageRow struct {
	id       string
	title    string
	icon     *string
	parentID *string
	// for content match only
	snippet *string
}

func (h *SearchHandler) search(ctx context.Context, q string, limit int) ([]SearchResult, error) {
	pattern := "%" + q + "%"
	lowerPattern := "%" + strings.ToLower(q) + "%"

	// --- 1. Title matches ---
	titleRows, err := h.queryTitleMatches(ctx, lowerPattern)
	if err != nil {
		return nil, err
	}

	// Build a set of page IDs already covered by title matches.
	seenIDs := make(map[string]struct{}, len(titleRows))
	for _, p := range titleRows {
		seenIDs[p.id] = struct{}{}
	}

	// --- 2. Content matches (exclude pages already matched by title) ---
	contentRows, err := h.queryContentMatches(ctx, pattern, lowerPattern, q)
	if err != nil {
		return nil, err
	}

	// --- 3. Merge: title first, then content (deduped) ---
	type mergedRow struct {
		pageRow
		matchType string
	}
	var merged []mergedRow
	for _, p := range titleRows {
		merged = append(merged, mergedRow{p, "title"})
	}
	for _, p := range contentRows {
		if _, exists := seenIDs[p.id]; exists {
			continue
		}
		seenIDs[p.id] = struct{}{}
		merged = append(merged, mergedRow{p, "content"})
	}

	// Apply limit.
	if len(merged) > limit {
		merged = merged[:limit]
	}

	// --- 4. Build final results with page_path ---
	results := make([]SearchResult, 0, len(merged))
	for _, m := range merged {
		path, err := h.buildPagePath(ctx, m.parentID)
		if err != nil {
			return nil, err
		}
		sr := SearchResult{
			PageID:    m.id,
			PageTitle: m.title,
			PageIcon:  m.icon,
			PagePath:  path,
			MatchType: m.matchType,
			Snippet:   m.snippet,
		}
		results = append(results, sr)
	}
	return results, nil
}

func (h *SearchHandler) queryTitleMatches(ctx context.Context, lowerPattern string) ([]pageRow, error) {
	rows, err := h.db.QueryContext(ctx,
		`SELECT id, title, icon, parent_id
		 FROM pages
		 WHERE deleted_at IS NULL
		   AND lower(title) LIKE ?
		 ORDER BY updated_at DESC`,
		lowerPattern,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPageRows(rows)
}

func (h *SearchHandler) queryContentMatches(ctx context.Context, pattern, lowerPattern, q string) ([]pageRow, error) {
	// Query pages whose blocks contain the search term, carrying one matching
	// block's content so we can build a snippet.
	rows, err := h.db.QueryContext(ctx,
		`SELECT p.id, p.title, p.icon, p.parent_id, b.content
		 FROM pages p
		 JOIN blocks b ON b.page_id = p.id
		 WHERE p.deleted_at IS NULL
		   AND (b.content LIKE ? OR lower(b.content) LIKE ?)
		 GROUP BY p.id
		 ORDER BY p.updated_at DESC`,
		pattern, lowerPattern,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []pageRow
	seen := make(map[string]struct{})
	for rows.Next() {
		var (
			id, title, rawContent string
			icon, parentID        *string
		)
		if err := rows.Scan(&id, &title, &icon, &parentID, &rawContent); err != nil {
			return nil, err
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		snip := extractSnippet(rawContent, q, 80)
		results = append(results, pageRow{
			id:       id,
			title:    title,
			icon:     icon,
			parentID: parentID,
			snippet:  snip,
		})
	}
	return results, rows.Err()
}

func scanPageRows(rows *sql.Rows) ([]pageRow, error) {
	var out []pageRow
	for rows.Next() {
		var p pageRow
		if err := rows.Scan(&p.id, &p.title, &p.icon, &p.parentID); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// buildPagePath walks up the parent chain and returns titles root-first,
// not including the current page itself.
// A visited set guards against circular parent_id references in corrupt data.
func (h *SearchHandler) buildPagePath(ctx context.Context, parentID *string) ([]string, error) {
	var path []string
	visited := make(map[string]struct{})
	cur := parentID
	for cur != nil {
		if _, seen := visited[*cur]; seen {
			// Circular reference detected; stop to avoid infinite loop.
			break
		}
		visited[*cur] = struct{}{}
		var title string
		var nextParent *string
		err := h.db.QueryRowContext(ctx,
			`SELECT title, parent_id FROM pages WHERE id = ?`, *cur,
		).Scan(&title, &nextParent)
		if err != nil {
			// Parent page may have been deleted; stop here.
			break
		}
		path = append(path, title)
		cur = nextParent
	}
	// Reverse so that root comes first.
	for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
		path[i], path[j] = path[j], path[i]
	}
	if path == nil {
		path = []string{}
	}
	return path, nil
}

// extractSnippet returns a substring of content centred around the first
// occurrence of q (case-insensitive), totalling at most maxLen runes.
// Returns nil if q is not found.
func extractSnippet(content, q string, maxLen int) *string {
	lower := strings.ToLower(content)
	lowerQ := strings.ToLower(q)
	idx := strings.Index(lower, lowerQ)
	if idx < 0 {
		return nil
	}

	runes := []rune(content)
	qRunes := []rune(q)
	// Find rune index corresponding to byte index idx.
	runeIdx := len([]rune(content[:idx]))

	half := (maxLen - len(qRunes)) / 2
	if half < 0 {
		half = 0
	}
	start := runeIdx - half
	if start < 0 {
		start = 0
	}
	end := start + maxLen
	if end > len(runes) {
		end = len(runes)
		start = end - maxLen
		if start < 0 {
			start = 0
		}
	}

	snip := string(runes[start:end])
	if start > 0 {
		snip = "..." + snip
	}
	if end < len(runes) {
		snip = snip + "..."
	}
	return &snip
}
