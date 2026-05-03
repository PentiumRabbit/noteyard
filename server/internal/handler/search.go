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
	BlockID   *string  `json:"block_id"`
}

// SearchHandler handles GET /api/search.
type SearchHandler struct {
	db *sql.DB
}

// NewSearchHandler creates a new SearchHandler backed by the given *sql.DB.
func NewSearchHandler(db *sql.DB) *SearchHandler {
	return &SearchHandler{db: db}
}

// Handle serves GET /api/search?q=...&limit=...&offset=...
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

	offset := 0
	if os := r.URL.Query().Get("offset"); os != "" {
		if n, err := strconv.Atoi(os); err == nil && n > 0 {
			offset = n
		}
	}

	results, err := h.search(r.Context(), q, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string][]SearchResult{"results": results})
}

// escapeFTSQuery converts a raw user query into a safe FTS5 MATCH expression.
// Each whitespace-separated word is wrapped in double quotes (phrase token),
// and any embedded double quotes are stripped to avoid breaking FTS5 syntax.
// Words are joined with an implicit AND.
func escapeFTSQuery(q string) string {
	words := strings.Fields(q)
	if len(words) == 0 {
		return ""
	}
	escaped := make([]string, len(words))
	for i, w := range words {
		// Remove embedded double quotes to avoid breaking FTS5 syntax.
		w = strings.ReplaceAll(w, `"`, "")
		escaped[i] = `"` + w + `"`
	}
	return strings.Join(escaped, " ")
}

// pageRow is an intermediate holder returned by the SQL queries.
type pageRow struct {
	id       string
	title    string
	icon     *string
	parentID *string
	// for content match only
	snippet *string
	blockID *string
}

func (h *SearchHandler) search(ctx context.Context, q string, limit, offset int) ([]SearchResult, error) {
	ftsQuery := escapeFTSQuery(q)
	if ftsQuery == "" {
		return []SearchResult{}, nil
	}

	// --- 1. Title matches ---
	titleRows, err := h.queryTitleMatches(ctx, ftsQuery, limit, offset)
	if err != nil {
		return nil, err
	}

	// Build a set of page IDs already covered by title matches.
	seenIDs := make(map[string]struct{}, len(titleRows))
	for _, p := range titleRows {
		seenIDs[p.id] = struct{}{}
	}

	// --- 2. Content matches (exclude pages already matched by title) ---
	contentRows, err := h.queryContentMatches(ctx, ftsQuery, limit, offset)
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
			BlockID:   m.blockID,
		}
		results = append(results, sr)
	}
	return results, nil
}

func (h *SearchHandler) queryTitleMatches(ctx context.Context, ftsQuery string, limit, offset int) ([]pageRow, error) {
	rows, err := h.db.QueryContext(ctx,
		`SELECT p.id, p.title, p.icon, p.parent_id
		 FROM pages_fts
		 JOIN pages p ON pages_fts.rowid = p.rowid
		 WHERE pages_fts MATCH ? AND p.deleted_at IS NULL
		 ORDER BY rank
		 LIMIT ? OFFSET ?`,
		ftsQuery, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPageRows(rows)
}

func (h *SearchHandler) queryContentMatches(ctx context.Context, ftsQuery string, limit, offset int) ([]pageRow, error) {
	rows, err := h.db.QueryContext(ctx,
		`SELECT p.id, p.title, p.icon, p.parent_id, b.id AS block_id,
		        snippet(blocks_fts, 0, '<b>', '</b>', '...', 15) AS snippet
		 FROM blocks_fts
		 JOIN blocks b ON blocks_fts.rowid = b.rowid
		 JOIN pages p ON b.page_id = p.id
		 WHERE blocks_fts MATCH ? AND p.deleted_at IS NULL
		 ORDER BY rank
		 LIMIT ? OFFSET ?`,
		ftsQuery, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []pageRow
	seen := make(map[string]struct{})
	for rows.Next() {
		var (
			id, title, blockID string
			icon, parentID     *string
			snip               *string
		)
		if err := rows.Scan(&id, &title, &icon, &parentID, &blockID, &snip); err != nil {
			return nil, err
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		results = append(results, pageRow{
			id:       id,
			title:    title,
			icon:     icon,
			parentID: parentID,
			snippet:  snip,
			blockID:  &blockID,
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
