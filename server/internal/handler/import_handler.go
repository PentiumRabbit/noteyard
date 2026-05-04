package handler

import (
	"encoding/json"
	"net/http"
	"noteyard/server/internal/model"
	"noteyard/server/internal/repository"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	gast "github.com/yuin/goldmark/ast"
	extast "github.com/yuin/goldmark/extension/ast"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/text"
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
		if strings.Contains(err.Error(), "MaxBytesReader") || strings.Contains(err.Error(), "too large") || strings.Contains(err.Error(), "request body too large") {
			writeError(w, http.StatusRequestEntityTooLarge, "file too large")
			return
		}
		writeError(w, http.StatusBadRequest, "bad multipart data")
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
	var buf strings.Builder
	tmp := make([]byte, 32*1024)
	for {
		n, readErr := file.Read(tmp)
		if n > 0 {
			buf.Write(tmp[:n])
		}
		if readErr != nil {
			break
		}
	}
	src := []byte(buf.String())

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
		writeInternalError(w, r, err)
		return
	}

	// Parse Markdown into blocks using goldmark AST.
	blocks := parseMarkdownToBlocks(src, page.ID)

	// Persist blocks.
	for _, b := range blocks {
		if err := h.blocks.Create(r.Context(), b); err != nil {
			writeInternalError(w, r, err)
			return
		}
	}

	writeJSON(w, http.StatusCreated, map[string]string{"page_id": page.ID})
}

// ---------------------------------------------------------------------------
// Markdown → Block parser (goldmark AST-based)
// ---------------------------------------------------------------------------

// inlineItem represents a single inline content element in BlockNote format.
type inlineItem struct {
	Type    string                 `json:"type"`
	Text    string                 `json:"text,omitempty"`
	Href    string                 `json:"href,omitempty"`
	Styles  map[string]interface{} `json:"styles"`
	Content []inlineItem           `json:"content,omitempty"`
}

// mdParser is the goldmark Markdown parser with GFM extensions enabled.
var mdParser = goldmark.New(
	goldmark.WithExtensions(
		extension.GFM,
		extension.Strikethrough,
	),
)

// parseMarkdownToBlocks converts raw Markdown bytes into a slice of model.Block
// using goldmark AST traversal.
func parseMarkdownToBlocks(src []byte, pageID string) []*model.Block {
	reader := text.NewReader(src)
	doc := mdParser.Parser().Parse(reader)

	var blocks []*model.Block
	orderIdx := 0.0

	// Walk only the top-level children of the document.
	for node := doc.FirstChild(); node != nil; node = node.NextSibling() {
		switch node.Kind() {
		case gast.KindHeading:
			heading := node.(*gast.Heading)
			blockType := "heading1"
			switch heading.Level {
			case 2:
				blockType = "heading2"
			case 3:
				blockType = "heading3"
			}
			content := marshalInlineItems(collectInline(node, src))
			blocks = append(blocks, newBlock(pageID, blockType, content, "{}", orderIdx))
			orderIdx++

		case gast.KindParagraph:
			content := marshalInlineItems(collectInline(node, src))
			blocks = append(blocks, newBlock(pageID, "paragraph", content, "{}", orderIdx))
			orderIdx++

		case gast.KindThematicBreak:
			blocks = append(blocks, newBlock(pageID, "divider", "[]", "{}", orderIdx))
			orderIdx++

		case gast.KindBlockquote:
			// Collect text from the first paragraph child of the blockquote.
			content := marshalInlineItems(collectBlockquoteInline(node, src))
			blocks = append(blocks, newBlock(pageID, "quote", content, "{}", orderIdx))
			orderIdx++

		case gast.KindFencedCodeBlock:
			fcb := node.(*gast.FencedCodeBlock)
			lang := ""
			if fcb.Info != nil {
				lang = strings.TrimSpace(string(fcb.Info.Segment.Value(src)))
				// goldmark includes extra text after language; take only first word
				if sp := strings.Fields(lang); len(sp) > 0 {
					lang = sp[0]
				}
			}
			// Collect code lines.
			var codeLines []string
			for i := 0; i < fcb.Lines().Len(); i++ {
				seg := fcb.Lines().At(i)
				line := string(seg.Value(src))
				// Remove trailing newline for cleaner storage.
				line = strings.TrimRight(line, "\n")
				codeLines = append(codeLines, line)
			}
			code := strings.Join(codeLines, "\n")
			props := marshalProps(map[string]interface{}{"language": lang})
			codeInline := marshalInlineItems([]inlineItem{
				{Type: "text", Text: code, Styles: map[string]interface{}{}},
			})
			blocks = append(blocks, newBlock(pageID, "code", codeInline, props, orderIdx))
			orderIdx++

		case gast.KindList:
			list := node.(*gast.List)
			// Process only top-level list items (no recursion into nested lists).
			for item := list.FirstChild(); item != nil; item = item.NextSibling() {
				if item.Kind() != gast.KindListItem {
					continue
				}
				// Determine if this is a task list item by checking for TaskCheckBox child.
				isTask := false
				isChecked := false
				for child := item.FirstChild(); child != nil; child = child.NextSibling() {
					if child.Kind() == extast.KindTaskCheckBox {
						isTask = true
						isChecked = child.(*extast.TaskCheckBox).IsChecked
						break
					}
				}

				// Collect inline content from the list item's paragraph/text block.
				itemInline := collectListItemInline(item, src)
				content := marshalInlineItems(itemInline)

				if isTask {
					props := marshalProps(map[string]interface{}{"checked": isChecked})
					blocks = append(blocks, newBlock(pageID, "checkListItem", content, props, orderIdx))
				} else if list.IsOrdered() {
					blocks = append(blocks, newBlock(pageID, "numberedListItem", content, "{}", orderIdx))
				} else {
					blocks = append(blocks, newBlock(pageID, "bulletListItem", content, "{}", orderIdx))
				}
				orderIdx++
			}
		}
	}

	return blocks
}

// collectBlockquoteInline gathers inline content from the first paragraph inside a blockquote.
func collectBlockquoteInline(node gast.Node, src []byte) []inlineItem {
	for child := node.FirstChild(); child != nil; child = child.NextSibling() {
		if child.Kind() == gast.KindParagraph || child.Kind() == gast.KindTextBlock {
			return collectInline(child, src)
		}
	}
	return nil
}

// collectListItemInline gathers inline content from the first paragraph/text block inside a list item,
// skipping any TaskCheckBox node at the start.
func collectListItemInline(item gast.Node, src []byte) []inlineItem {
	for child := item.FirstChild(); child != nil; child = child.NextSibling() {
		if child.Kind() == gast.KindParagraph || child.Kind() == gast.KindTextBlock {
			return collectInline(child, src)
		}
		// Skip inner nested List nodes (only top-level items are processed).
		if child.Kind() == gast.KindList {
			continue
		}
	}
	return nil
}

// collectInline traverses the inline children of a block node and returns
// a slice of inlineItems in BlockNote format.
func collectInline(node gast.Node, src []byte) []inlineItem {
	var items []inlineItem
	gast.Walk(node, func(n gast.Node, entering bool) (gast.WalkStatus, error) {
		if n == node {
			return gast.WalkContinue, nil
		}
		switch n.Kind() {
		case gast.KindText:
			if entering {
				t := n.(*gast.Text)
				txt := string(t.Segment.Value(src))
				if t.SoftLineBreak() {
					txt += " "
				}
				// Inherit styles from ancestor emphasis nodes.
				styles := inheritedStyles(n)
				if isInsideLink(n) || isInsideStrikethrough(n) {
					// handled by their parent nodes
					return gast.WalkSkipChildren, nil
				}
				items = append(items, inlineItem{
					Type:   "text",
					Text:   txt,
					Styles: styles,
				})
			}
		case gast.KindString:
			if entering {
				s := n.(*gast.String)
				styles := inheritedStyles(n)
				items = append(items, inlineItem{
					Type:   "text",
					Text:   string(s.Value),
					Styles: styles,
				})
			}
		case gast.KindCodeSpan:
			if entering {
				// Collect raw text from the code span's children.
				var code string
				for child := n.FirstChild(); child != nil; child = child.NextSibling() {
					if child.Kind() == gast.KindText {
						code += string(child.(*gast.Text).Segment.Value(src))
					}
				}
				items = append(items, inlineItem{
					Type:   "text",
					Text:   code,
					Styles: map[string]interface{}{"code": true},
				})
				return gast.WalkSkipChildren, nil
			}
		case extast.KindStrikethrough:
			if entering {
				inner := collectInlineChildren(n, src)
				for i := range inner {
					if inner[i].Styles == nil {
						inner[i].Styles = map[string]interface{}{}
					}
					inner[i].Styles["strike"] = true
				}
				items = append(items, inner...)
				return gast.WalkSkipChildren, nil
			}
		case gast.KindEmphasis:
			if entering {
				em := n.(*gast.Emphasis)
				inner := collectInlineChildren(n, src)
				key := "italic"
				if em.Level == 2 {
					key = "bold"
				}
				for i := range inner {
					if inner[i].Styles == nil {
						inner[i].Styles = map[string]interface{}{}
					}
					inner[i].Styles[key] = true
				}
				items = append(items, inner...)
				return gast.WalkSkipChildren, nil
			}
		case gast.KindLink:
			if entering {
				link := n.(*gast.Link)
				innerItems := collectInlineChildren(n, src)
				items = append(items, inlineItem{
					Type:    "link",
					Href:    string(link.Destination),
					Styles:  map[string]interface{}{},
					Content: innerItems,
				})
				return gast.WalkSkipChildren, nil
			}
		case extast.KindTaskCheckBox:
			// Skip task checkbox nodes — handled at list item level.
			return gast.WalkSkipChildren, nil
		}
		return gast.WalkContinue, nil
	})
	return items
}

// collectInlineChildren is like collectInline but processes the children of node n,
// used for nested inline contexts (emphasis, strikethrough, link).
func collectInlineChildren(n gast.Node, src []byte) []inlineItem {
	var items []inlineItem
	for child := n.FirstChild(); child != nil; child = child.NextSibling() {
		switch child.Kind() {
		case gast.KindText:
			t := child.(*gast.Text)
			txt := string(t.Segment.Value(src))
			if t.SoftLineBreak() {
				txt += " "
			}
			items = append(items, inlineItem{
				Type:   "text",
				Text:   txt,
				Styles: map[string]interface{}{},
			})
		case gast.KindString:
			s := child.(*gast.String)
			items = append(items, inlineItem{
				Type:   "text",
				Text:   string(s.Value),
				Styles: map[string]interface{}{},
			})
		case gast.KindCodeSpan:
			var code string
			for cc := child.FirstChild(); cc != nil; cc = cc.NextSibling() {
				if cc.Kind() == gast.KindText {
					code += string(cc.(*gast.Text).Segment.Value(src))
				}
			}
			items = append(items, inlineItem{
				Type:   "text",
				Text:   code,
				Styles: map[string]interface{}{"code": true},
			})
		case gast.KindEmphasis:
			em := child.(*gast.Emphasis)
			inner := collectInlineChildren(child, src)
			key := "italic"
			if em.Level == 2 {
				key = "bold"
			}
			for i := range inner {
				if inner[i].Styles == nil {
					inner[i].Styles = map[string]interface{}{}
				}
				inner[i].Styles[key] = true
			}
			items = append(items, inner...)
		case extast.KindStrikethrough:
			inner := collectInlineChildren(child, src)
			for i := range inner {
				if inner[i].Styles == nil {
					inner[i].Styles = map[string]interface{}{}
				}
				inner[i].Styles["strike"] = true
			}
			items = append(items, inner...)
		case gast.KindLink:
			link := child.(*gast.Link)
			innerItems := collectInlineChildren(child, src)
			items = append(items, inlineItem{
				Type:    "link",
				Href:    string(link.Destination),
				Styles:  map[string]interface{}{},
				Content: innerItems,
			})
		}
	}
	return items
}

// inheritedStyles walks up the ancestor chain to determine text styles.
// This is a fallback for deeply nested text nodes not caught by Walk-skipping.
func inheritedStyles(n gast.Node) map[string]interface{} {
	styles := map[string]interface{}{}
	parent := n.Parent()
	for parent != nil {
		switch parent.Kind() {
		case gast.KindEmphasis:
			em := parent.(*gast.Emphasis)
			if em.Level == 2 {
				styles["bold"] = true
			} else {
				styles["italic"] = true
			}
		case extast.KindStrikethrough:
			styles["strike"] = true
		case gast.KindCodeSpan:
			styles["code"] = true
		}
		parent = parent.Parent()
	}
	return styles
}

// isInsideLink returns true if node n has a Link ancestor.
func isInsideLink(n gast.Node) bool {
	for p := n.Parent(); p != nil; p = p.Parent() {
		if p.Kind() == gast.KindLink {
			return true
		}
	}
	return false
}

// isInsideStrikethrough returns true if node n has a Strikethrough ancestor.
func isInsideStrikethrough(n gast.Node) bool {
	for p := n.Parent(); p != nil; p = p.Parent() {
		if p.Kind() == extast.KindStrikethrough {
			return true
		}
	}
	return false
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

// marshalInlineItems serialises a slice of inlineItems to JSON string.
func marshalInlineItems(items []inlineItem) string {
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
