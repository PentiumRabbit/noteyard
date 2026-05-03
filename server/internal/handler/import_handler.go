package handler

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"noteyard/server/internal/model"
	"noteyard/server/internal/repository"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ImportHandler handles Markdown file imports.
type ImportHandler struct {
	pages  repository.PageRepository
	blocks repository.BlockRepository
}

// NewImportHandler creates a new ImportHandler.
func NewImportHandler(pages repository.PageRepository, blocks repository.BlockRepository) *ImportHandler {
	return &ImportHandler{pages: pages, blocks: blocks}
}

const maxImportSize = 5 << 20 // 5 MB

// ImportMarkdown handles POST /api/import/markdown
func (h *ImportHandler) ImportMarkdown(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxImportSize)

	if err := r.ParseMultipartForm(maxImportSize); err != nil {
		writeError(w, http.StatusBadRequest, "file too large or bad multipart data")
		return
	}

	file, fh, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()

	if ext := strings.ToLower(filepath.Ext(fh.Filename)); ext != ".md" {
		writeError(w, http.StatusBadRequest, "only .md files are accepted")
		return
	}

	// Derive page title from filename (strip .md extension).
	title := strings.TrimSuffix(fh.Filename, filepath.Ext(fh.Filename))
	if title == "" {
		title = "Untitled"
	}

	// Read file content.
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(file); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read file")
		return
	}
	src := buf.Bytes()

	// Create the page.
	now := time.Now().UnixMilli()
	page := &model.Page{
		ID:         uuid.New().String(),
		Title:      title,
		OrderIndex: 0,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if err := h.pages.Create(r.Context(), page); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create page")
		return
	}

	// Parse Markdown into blocks.
	blocks := parseMarkdownToBlocks(src, page.ID)

	// Persist blocks.
	for _, b := range blocks {
		if err := h.blocks.Create(r.Context(), b); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create block")
			return
		}
	}

	writeJSON(w, http.StatusCreated, map[string]string{"page_id": page.ID})
}

// ---------------------------------------------------------------------------
// Markdown → Block parser (line-by-line, no external dependencies)
// ---------------------------------------------------------------------------

// inlineItem represents a single inline content element in BlockNote format.
type inlineItem struct {
	Type   string                 `json:"type"`
	Text   string                 `json:"text,omitempty"`
	Href   string                 `json:"href,omitempty"`
	Styles map[string]interface{} `json:"styles"`
}

var (
	reFencedOpen  = regexp.MustCompile(`^` + "```" + `(\S*)`)
	reHeading     = regexp.MustCompile(`^(#{1,3})\s+(.+)`)
	reOrderedItem = regexp.MustCompile(`^\d+\.\s+(.*)`)
	reUnorderedItem = regexp.MustCompile(`^[-*+]\s+(.*)`)
	reTaskChecked   = regexp.MustCompile(`^\[x\]\s*(.*?)$`)
	reTaskUnchecked = regexp.MustCompile(`^\[ \]\s*(.*?)$`)
	reDivider     = regexp.MustCompile(`^(---+|\*\*\*+|___+)\s*$`)
	reBlockquote  = regexp.MustCompile(`^>\s?(.*)`)
)

// parseMarkdownToBlocks converts raw Markdown bytes into a slice of model.Block.
func parseMarkdownToBlocks(src []byte, pageID string) []*model.Block {
	var blocks []*model.Block
	orderIdx := 0.0

	scanner := bufio.NewScanner(bytes.NewReader(src))

	var (
		inCode      bool
		codeLang    string
		codeLines   []string
	)

	// paragraphLines accumulates lines for a paragraph block.
	var paragraphLines []string

	flushParagraph := func() {
		if len(paragraphLines) == 0 {
			return
		}
		text := strings.Join(paragraphLines, " ")
		paragraphLines = nil
		if strings.TrimSpace(text) == "" {
			return
		}
		blocks = append(blocks, newBlock(pageID, "paragraph", marshalInline(parseInline(text)), "{}", orderIdx))
		orderIdx++
	}

	for scanner.Scan() {
		line := scanner.Text()

		// ── Inside a fenced code block ──────────────────────────────────────
		if inCode {
			if strings.HasPrefix(line, "```") {
				// End of code block.
				code := strings.Join(codeLines, "\n")
				props := marshalProps(map[string]interface{}{"language": codeLang})
				content := marshalInline([]inlineItem{{Type: "text", Text: code, Styles: map[string]interface{}{}}})
				blocks = append(blocks, newBlock(pageID, "code", content, props, orderIdx))
				orderIdx++
				inCode = false
				codeLines = nil
				codeLang = ""
			} else {
				codeLines = append(codeLines, line)
			}
			continue
		}

		// ── Fenced code block open ──────────────────────────────────────────
		if m := reFencedOpen.FindStringSubmatch(line); m != nil {
			flushParagraph()
			inCode = true
			codeLang = m[1]
			codeLines = nil
			continue
		}

		// ── Blank line — flush pending paragraph ────────────────────────────
		if strings.TrimSpace(line) == "" {
			flushParagraph()
			continue
		}

		// ── Thematic break ──────────────────────────────────────────────────
		if reDivider.MatchString(line) {
			flushParagraph()
			blocks = append(blocks, newBlock(pageID, "divider", "[]", "{}", orderIdx))
			orderIdx++
			continue
		}

		// ── Heading ─────────────────────────────────────────────────────────
		if m := reHeading.FindStringSubmatch(line); m != nil {
			flushParagraph()
			level := len(m[1])
			blockType := "heading1"
			switch level {
			case 2:
				blockType = "heading2"
			case 3:
				blockType = "heading3"
			}
			content := marshalInline(parseInline(m[2]))
			blocks = append(blocks, newBlock(pageID, blockType, content, "{}", orderIdx))
			orderIdx++
			continue
		}

		// ── Blockquote ──────────────────────────────────────────────────────
		if m := reBlockquote.FindStringSubmatch(line); m != nil {
			flushParagraph()
			content := marshalInline(parseInline(m[1]))
			blocks = append(blocks, newBlock(pageID, "quote", content, "{}", orderIdx))
			orderIdx++
			continue
		}

		// ── Ordered list item ────────────────────────────────────────────────
		if m := reOrderedItem.FindStringSubmatch(line); m != nil {
			flushParagraph()
			content := marshalInline(parseInline(m[1]))
			blocks = append(blocks, newBlock(pageID, "numberedListItem", content, "{}", orderIdx))
			orderIdx++
			continue
		}

		// ── Unordered list item (possibly task list) ─────────────────────────
		if m := reUnorderedItem.FindStringSubmatch(line); m != nil {
			flushParagraph()
			rest := m[1]
			if tc := reTaskChecked.FindStringSubmatch(rest); tc != nil {
				content := marshalInline(parseInline(tc[1]))
				props := marshalProps(map[string]interface{}{"checked": true})
				blocks = append(blocks, newBlock(pageID, "checkListItem", content, props, orderIdx))
				orderIdx++
				continue
			}
			if tu := reTaskUnchecked.FindStringSubmatch(rest); tu != nil {
				content := marshalInline(parseInline(tu[1]))
				props := marshalProps(map[string]interface{}{"checked": false})
				blocks = append(blocks, newBlock(pageID, "checkListItem", content, props, orderIdx))
				orderIdx++
				continue
			}
			content := marshalInline(parseInline(rest))
			blocks = append(blocks, newBlock(pageID, "bulletListItem", content, "{}", orderIdx))
			orderIdx++
			continue
		}

		// ── Regular text line → accumulate into paragraph ────────────────────
		paragraphLines = append(paragraphLines, line)
	}

	// Flush any trailing paragraph and open code block.
	if inCode && len(codeLines) > 0 {
		code := strings.Join(codeLines, "\n")
		props := marshalProps(map[string]interface{}{"language": codeLang})
		content := marshalInline([]inlineItem{{Type: "text", Text: code, Styles: map[string]interface{}{}}})
		blocks = append(blocks, newBlock(pageID, "code", content, props, orderIdx))
		orderIdx++
	}
	flushParagraph()

	return blocks
}

// newBlock constructs a model.Block with generated ID and timestamps.
func newBlock(pageID, blockType, content, props string, orderIdx float64) *model.Block {
	now := time.Now().UnixMilli()
	return &model.Block{
		ID:         uuid.New().String(),
		PageID:     pageID,
		Type:       blockType,
		Content:    content,
		Props:      props,
		OrderIndex: orderIdx,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
}

// ---------------------------------------------------------------------------
// Inline content parser
// ---------------------------------------------------------------------------

// parseInline converts a Markdown inline string into a slice of inlineItems.
// Supported: **bold**, *italic*, ~~strikethrough~~, `code`, [text](href).
func parseInline(s string) []inlineItem {
	var items []inlineItem
	for len(s) > 0 {
		// Link: [text](href)
		if idx := strings.Index(s, "["); idx >= 0 {
			// Check for leading plain text before the link.
			if idx > 0 {
				items = append(items, plainItem(s[:idx]))
				s = s[idx:]
				continue
			}
			end := strings.Index(s, "](")
			if end > 0 {
				linkText := s[1:end]
				rest := s[end+2:]
				closeIdx := strings.Index(rest, ")")
				if closeIdx >= 0 {
					href := rest[:closeIdx]
					items = append(items, inlineItem{
						Type:   "link",
						Href:   href,
						Text:   linkText,
						Styles: map[string]interface{}{},
					})
					s = rest[closeIdx+1:]
					continue
				}
			}
		}

		// Bold (**text** or __text__)
		if idx := findDelimiter(s, "**"); idx >= 0 {
			if idx > 0 {
				items = append(items, plainItem(s[:idx]))
				s = s[idx:]
				continue
			}
			end := strings.Index(s[2:], "**")
			if end >= 0 {
				inner := s[2 : end+2]
				items = append(items, inlineItem{
					Type: "text", Text: inner,
					Styles: map[string]interface{}{"bold": true},
				})
				s = s[end+4:]
				continue
			}
		}

		// Italic (*text* or _text_) — single asterisk/underscore
		if idx := findDelimiter(s, "*"); idx >= 0 {
			if idx > 0 {
				items = append(items, plainItem(s[:idx]))
				s = s[idx:]
				continue
			}
			end := strings.Index(s[1:], "*")
			if end >= 0 {
				inner := s[1 : end+1]
				items = append(items, inlineItem{
					Type: "text", Text: inner,
					Styles: map[string]interface{}{"italic": true},
				})
				s = s[end+2:]
				continue
			}
		}

		// Strikethrough (~~text~~)
		if idx := findDelimiter(s, "~~"); idx >= 0 {
			if idx > 0 {
				items = append(items, plainItem(s[:idx]))
				s = s[idx:]
				continue
			}
			end := strings.Index(s[2:], "~~")
			if end >= 0 {
				inner := s[2 : end+2]
				items = append(items, inlineItem{
					Type: "text", Text: inner,
					Styles: map[string]interface{}{"strike": true},
				})
				s = s[end+4:]
				continue
			}
		}

		// Inline code (`code`)
		if idx := strings.Index(s, "`"); idx >= 0 {
			if idx > 0 {
				items = append(items, plainItem(s[:idx]))
				s = s[idx:]
				continue
			}
			end := strings.Index(s[1:], "`")
			if end >= 0 {
				inner := s[1 : end+1]
				items = append(items, inlineItem{
					Type: "text", Text: inner,
					Styles: map[string]interface{}{"code": true},
				})
				s = s[end+2:]
				continue
			}
		}

		// No more special syntax found — emit the rest as plain text.
		items = append(items, plainItem(s))
		break
	}
	return items
}

// findDelimiter returns the first index of delim in s, or -1 if not found.
func findDelimiter(s, delim string) int {
	idx := strings.Index(s, delim)
	if idx < 0 {
		return -1
	}
	// Ensure there's a closing delimiter somewhere after the opening one.
	rest := s[idx+len(delim):]
	if strings.Contains(rest, delim) {
		return idx
	}
	return -1
}

// plainItem creates a plain text inlineItem.
func plainItem(text string) inlineItem {
	return inlineItem{Type: "text", Text: text, Styles: map[string]interface{}{}}
}

// marshalInline serialises a slice of inlineItems to JSON string.
func marshalInline(items []inlineItem) string {
	if len(items) == 0 {
		return "[]"
	}
	b, err := json.Marshal(items)
	if err != nil {
		return "[]"
	}
	return string(b)
}

// marshalProps serialises a props map to JSON string.
func marshalProps(m map[string]interface{}) string {
	b, err := json.Marshal(m)
	if err != nil {
		return "{}"
	}
	return string(b)
}
