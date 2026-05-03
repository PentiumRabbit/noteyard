package handler

import (
	"archive/zip"
	"encoding/json"
	"net/http"
	"noteyard/server/internal/model"
	"noteyard/server/internal/repository"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// ExportHandler serves single-page and full-library export endpoints.
type ExportHandler struct {
	pages  repository.PageRepository
	blocks repository.BlockRepository
}

// NewExportHandler creates a new ExportHandler.
func NewExportHandler(pages repository.PageRepository, blocks repository.BlockRepository) *ExportHandler {
	return &ExportHandler{pages: pages, blocks: blocks}
}

// ExportPage handles GET /api/pages/{id}/export?format=markdown|json
func (h *ExportHandler) ExportPage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "markdown"
	}

	page, err := h.pages.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "page not found")
		return
	}

	allBlocks, err := h.blocks.ListByPage(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	filename := sanitizeFilename(page.Title)

	switch format {
	case "json":
		data := map[string]interface{}{
			"page":   page,
			"blocks": allBlocks,
		}
		raw, err := json.MarshalIndent(data, "", "  ")
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`.json"`)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(raw)

	default: // markdown
		content := pageToMarkdown(page, allBlocks)
		w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`.md"`)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(content))
	}
}

// ExportAll handles GET /api/export?format=markdown|json
func (h *ExportHandler) ExportAll(w http.ResponseWriter, r *http.Request) {
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "markdown"
	}

	pages, err := h.pages.ListAll(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	date := time.Now().Format("2006-01-02")
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="noteyard-export-`+date+`.zip"`)

	zw := zip.NewWriter(w)
	defer zw.Close()

	for _, page := range pages {
		allBlocks, err := h.blocks.ListByPage(r.Context(), page.ID)
		if err != nil {
			continue
		}

		baseFilename := sanitizeFilename(page.Title) + "-" + page.ID[:8]

		switch format {
		case "json":
			filename := baseFilename + ".json"
			fw, err := zw.Create(filename)
			if err != nil {
				continue
			}
			data := map[string]interface{}{
				"page":   page,
				"blocks": allBlocks,
			}
			raw, err := json.MarshalIndent(data, "", "  ")
			if err != nil {
				continue
			}
			_, _ = fw.Write(raw)

		default: // markdown
			filename := baseFilename + ".md"
			fw, err := zw.Create(filename)
			if err != nil {
				continue
			}
			content := pageToMarkdown(page, allBlocks)
			_, _ = fw.Write([]byte(content))
		}
	}
}

// pageToMarkdown converts a page and its blocks to Markdown text.
func pageToMarkdown(page *model.Page, allBlocks []*model.Block) string {
	var sb strings.Builder
	sb.WriteString("# " + page.Title + "\n\n")

	// Build top-level blocks (no parent) in order
	roots := filterBlocks(allBlocks, nil)
	for _, b := range roots {
		sb.WriteString(blockToMarkdown(b, allBlocks, 0))
	}
	return sb.String()
}

// filterBlocks returns blocks whose ParentBlockID matches parentID, sorted by OrderIndex.
func filterBlocks(all []*model.Block, parentID *string) []*model.Block {
	var result []*model.Block
	for _, b := range all {
		if parentID == nil && b.ParentBlockID == nil {
			result = append(result, b)
		} else if parentID != nil && b.ParentBlockID != nil && *b.ParentBlockID == *parentID {
			result = append(result, b)
		}
	}
	// blocks are returned from DB ordered by order_index already; preserve that order
	return result
}

// blockToMarkdown converts a single block (and recursively its children) to Markdown.
func blockToMarkdown(block *model.Block, allBlocks []*model.Block, depth int) string {
	indent := strings.Repeat("  ", depth)
	inline := inlineToMarkdown(block.Content)

	var sb strings.Builder

	switch block.Type {
	case "paragraph":
		sb.WriteString(inline + "\n")

	case "heading1":
		sb.WriteString("# " + inline + "\n")
	case "heading2":
		sb.WriteString("## " + inline + "\n")
	case "heading3":
		sb.WriteString("### " + inline + "\n")

	case "bulletListItem":
		sb.WriteString(indent + "- " + inline + "\n")
		for _, child := range filterBlocks(allBlocks, &block.ID) {
			sb.WriteString(blockToMarkdown(child, allBlocks, depth+1))
		}
		return sb.String()

	case "numberedListItem":
		sb.WriteString(indent + "1. " + inline + "\n")
		for _, child := range filterBlocks(allBlocks, &block.ID) {
			sb.WriteString(blockToMarkdown(child, allBlocks, depth+1))
		}
		return sb.String()

	case "checkListItem":
		checked := propsChecked(block.Props)
		mark := "- [ ] "
		if checked {
			mark = "- [x] "
		}
		sb.WriteString(indent + mark + inline + "\n")
		for _, child := range filterBlocks(allBlocks, &block.ID) {
			sb.WriteString(blockToMarkdown(child, allBlocks, depth+1))
		}
		return sb.String()

	case "toggle":
		sb.WriteString(indent + "> **" + inline + "**\n")
		for _, child := range filterBlocks(allBlocks, &block.ID) {
			sb.WriteString(blockToMarkdown(child, allBlocks, depth+1))
		}
		return sb.String()

	case "callout":
		sb.WriteString(indent + "> " + inline + "\n")
		for _, child := range filterBlocks(allBlocks, &block.ID) {
			sb.WriteString(blockToMarkdown(child, allBlocks, depth+1))
		}
		return sb.String()

	case "quote":
		sb.WriteString(indent + "> " + inline + "\n")

	case "code":
		lang := propsString(block.Props, "language")
		sb.WriteString("```" + lang + "\n" + inline + "\n```\n")

	case "image":
		url := propsString(block.Props, "url")
		sb.WriteString("![](" + url + ")\n")

	case "divider":
		sb.WriteString("---\n")

	case "columnList":
		children := filterBlocks(allBlocks, &block.ID)
		for i, col := range children {
			if i > 0 {
				sb.WriteString("\n")
			}
			sb.WriteString(blockToMarkdown(col, allBlocks, depth))
		}
		return sb.String()

	case "column":
		for _, child := range filterBlocks(allBlocks, &block.ID) {
			sb.WriteString(blockToMarkdown(child, allBlocks, depth))
		}
		return sb.String()

	case "database", "subpage", "fileAttach", "bookmark", "embed", "pdf", "button":
		sb.WriteString("<!-- [" + block.Type + "] -->\n")

	default:
		// Unknown types: emit a comment
		sb.WriteString("<!-- [" + block.Type + "] -->\n")
	}

	return sb.String()
}

// inlineToMarkdown converts a BlockNote inline content JSON string to Markdown.
func inlineToMarkdown(content string) string {
	if content == "" || content == "[]" || content == "null" {
		return ""
	}
	var items []map[string]interface{}
	if err := json.Unmarshal([]byte(content), &items); err != nil {
		return content
	}
	var sb strings.Builder
	for _, item := range items {
		typ, _ := item["type"].(string)
		switch typ {
		case "text":
			text, _ := item["text"].(string)
			styles, _ := item["styles"].(map[string]interface{})
			if b, _ := styles["bold"].(bool); b {
				text = "**" + text + "**"
			}
			if b, _ := styles["italic"].(bool); b {
				text = "*" + text + "*"
			}
			if b, _ := styles["strike"].(bool); b {
				text = "~~" + text + "~~"
			}
			if b, _ := styles["code"].(bool); b {
				text = "`" + text + "`"
			}
			if b, _ := styles["underline"].(bool); b {
				text = "<u>" + text + "</u>"
			}
			sb.WriteString(text)
		case "link":
			href, _ := item["href"].(string)
			linkContent, _ := item["content"].([]interface{})
			linkText := extractLinkText(linkContent)
			sb.WriteString("[" + linkText + "](" + href + ")")
		}
	}
	return sb.String()
}

// extractLinkText recursively extracts plain text from a link's content array.
func extractLinkText(content []interface{}) string {
	var sb strings.Builder
	for _, raw := range content {
		item, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		typ, _ := item["type"].(string)
		switch typ {
		case "text":
			text, _ := item["text"].(string)
			sb.WriteString(text)
		case "link":
			inner, _ := item["content"].([]interface{})
			sb.WriteString(extractLinkText(inner))
		}
	}
	return sb.String()
}

// propsChecked reads the "checked" boolean from a block's Props JSON.
func propsChecked(props string) bool {
	if props == "" {
		return false
	}
	var m map[string]interface{}
	if err := json.Unmarshal([]byte(props), &m); err != nil {
		return false
	}
	b, _ := m["checked"].(bool)
	return b
}

// propsString reads a string field from a block's Props JSON.
func propsString(props, key string) string {
	if props == "" {
		return ""
	}
	var m map[string]interface{}
	if err := json.Unmarshal([]byte(props), &m); err != nil {
		return ""
	}
	v, _ := m[key].(string)
	return v
}

// sanitizeFilename strips characters that are invalid in most file systems.
var sanitizeRe = regexp.MustCompile(`[/\\:*?"<>|]`)

func sanitizeFilename(title string) string {
	s := sanitizeRe.ReplaceAllString(title, "-")
	s = strings.TrimSpace(s)
	if s == "" {
		s = "untitled"
	}
	if len(s) > 80 {
		s = s[:80]
	}
	return s
}
