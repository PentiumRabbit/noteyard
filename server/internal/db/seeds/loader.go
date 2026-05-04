// Package seeds provides utilities to load seed JSON files and apply them to
// the database. The seed format is the BlockNote Seed dialect described in
// docs/requirements/features/REQ-070.md.
package seeds

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"time"
)

// ─────────────────────────────────────────────────────────────────────────────
// Seed file structs (in-memory representation after parsing)
// ─────────────────────────────────────────────────────────────────────────────

// SeedFile is the top-level structure of a *.json seed file.
type SeedFile struct {
	Version int        `json:"version"`
	Page    SeedPage   `json:"page"`
	Blocks  []SeedNode `json:"blocks"`
}

// SeedPage holds the page metadata from the seed file.
type SeedPage struct {
	ID         string  `json:"id"`
	Title      string  `json:"title"`
	Icon       string  `json:"icon"`
	OrderIndex float64 `json:"order_index"`
}

// SeedNode is a single block node inside the seed file. Content may be a
// plain string or a raw JSON array (already-expanded inline content).
type SeedNode struct {
	ID       string          `json:"id"`
	Type     string          `json:"type"`
	Props    json.RawMessage `json:"props"`
	Content  json.RawMessage `json:"content"` // string or array
	Children []SeedNode      `json:"children"`
}

// SeedBlock is a fully-resolved block ready to be written to the DB.
type SeedBlock struct {
	ID            string
	Type          string
	PageID        string
	ParentBlockID *string // nil for top-level blocks
	Content       string  // serialised JSON array
	Props         string  // serialised JSON object
	OrderIndex    float64
}

// ─────────────────────────────────────────────────────────────────────────────
// Default props per block type
// ─────────────────────────────────────────────────────────────────────────────

// defaultProps returns the JSON props string for a block type when the seed
// file omits the "props" field (null / absent).
func defaultProps(blockType string, rawProps json.RawMessage) (string, error) {
	// If props were explicitly provided (and are not null), use them directly.
	if len(rawProps) > 0 && string(rawProps) != "null" {
		return string(rawProps), nil
	}
	switch blockType {
	case "heading":
		return `{"level":1,"textColor":"default","backgroundColor":"default","textAlignment":"left"}`, nil
	case "callout":
		return `{"icon":"💡"}`, nil
	case "columnList", "column":
		return `{}`, nil
	default:
		return `{"textColor":"default","backgroundColor":"default","textAlignment":"left"}`, nil
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Content expansion
// ─────────────────────────────────────────────────────────────────────────────

// expandContent converts a seed content value to a JSON array string.
// - If the raw value is a JSON string  → wrap in inline text object array.
// - If the raw value is a JSON array   → use as-is.
// - If absent / null                   → return "[]".
func expandContent(raw json.RawMessage) (string, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return "[]", nil
	}

	// Check first non-whitespace character.
	trimmed := raw
	for len(trimmed) > 0 && (trimmed[0] == ' ' || trimmed[0] == '\t' || trimmed[0] == '\n' || trimmed[0] == '\r') {
		trimmed = trimmed[1:]
	}
	if len(trimmed) == 0 {
		return "[]", nil
	}

	switch trimmed[0] {
	case '"':
		// It's a JSON string — decode and wrap.
		var text string
		if err := json.Unmarshal(raw, &text); err != nil {
			return "", fmt.Errorf("expandContent: decode string: %w", err)
		}
		type inlineText struct {
			Type   string         `json:"type"`
			Text   string         `json:"text"`
			Styles map[string]any `json:"styles"`
		}
		arr := []inlineText{{Type: "text", Text: text, Styles: map[string]any{}}}
		out, err := json.Marshal(arr)
		if err != nil {
			return "", fmt.Errorf("expandContent: marshal inline: %w", err)
		}
		return string(out), nil

	case '[':
		// Already a JSON array — return as-is.
		return string(raw), nil

	case '{':
		// JSON object content (table, bookmark, button, database, etc.) — pass through as-is.
		return string(raw), nil

	default:
		return "", fmt.Errorf("expandContent: unexpected content type (starts with %q)", string(trimmed[0]))
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Flatten tree → flat []SeedBlock list (with parent tracking)
// ─────────────────────────────────────────────────────────────────────────────

// flattenNodes recursively flattens a tree of SeedNodes into a flat slice of
// SeedBlocks, assigning parent_block_id and order_index correctly.
func flattenNodes(nodes []SeedNode, pageID string, parentBlockID *string, startIndex float64) ([]SeedBlock, error) {
	var result []SeedBlock
	idx := startIndex
	for _, node := range nodes {
		idx++

		content, err := expandContent(node.Content)
		if err != nil {
			return nil, fmt.Errorf("block %s: %w", node.ID, err)
		}

		props, err := defaultProps(node.Type, node.Props)
		if err != nil {
			return nil, fmt.Errorf("block %s props: %w", node.ID, err)
		}

		var pid *string
		if parentBlockID != nil {
			s := *parentBlockID
			pid = &s
		}

		block := SeedBlock{
			ID:            node.ID,
			Type:          node.Type,
			PageID:        pageID,
			ParentBlockID: pid,
			Content:       content,
			Props:         props,
			OrderIndex:    idx,
		}
		result = append(result, block)

		// Recurse into children (columnList → column → inner blocks).
		if len(node.Children) > 0 {
			childID := node.ID
			children, err := flattenNodes(node.Children, pageID, &childID, 0)
			if err != nil {
				return nil, err
			}
			result = append(result, children...)
		}
	}
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

// LoadSeed reads the JSON seed file at path, parses it, and returns a SeedPage
// and the fully-resolved flat list of SeedBlocks ready to be written to the DB.
func LoadSeed(path string) (*SeedPage, []SeedBlock, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, fmt.Errorf("LoadSeed: read %s: %w", path, err)
	}
	return ParseSeed(data)
}

// ParseSeed parses a seed JSON byte slice and returns a SeedPage and the
// fully-resolved flat list of SeedBlocks ready to be written to the DB.
// This is useful when the seed data is embedded via go:embed.
func ParseSeed(data []byte) (*SeedPage, []SeedBlock, error) {
	var sf SeedFile
	if err := json.Unmarshal(data, &sf); err != nil {
		return nil, nil, fmt.Errorf("ParseSeed: parse JSON: %w", err)
	}

	blocks, err := flattenNodes(sf.Blocks, sf.Page.ID, nil, 0)
	if err != nil {
		return nil, nil, fmt.Errorf("ParseSeed: flatten blocks: %w", err)
	}

	page := sf.Page
	return &page, blocks, nil
}

// ApplySeed writes the page and blocks into the database inside tx.
// If the page already exists (by id) the operation is a no-op (idempotent).
func ApplySeed(tx *sql.Tx, page *SeedPage, blocks []SeedBlock) error {
	// Idempotency check — skip if page already present.
	var count int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM pages WHERE id = ?`, page.ID).Scan(&count); err != nil {
		return fmt.Errorf("ApplySeed: check page: %w", err)
	}
	if count > 0 {
		return nil
	}

	now := time.Now().Unix()

	_, err := tx.Exec(
		`INSERT INTO pages(id, parent_id, title, icon, cover, order_index, created_at, updated_at)
		 VALUES(?, NULL, ?, ?, NULL, ?, ?, ?)`,
		page.ID, page.Title, page.Icon, page.OrderIndex, now, now,
	)
	if err != nil {
		return fmt.Errorf("ApplySeed: insert page: %w", err)
	}

	const contentVersion = 1 // CurrentContentVersion at time of seed

	for _, b := range blocks {
		var parentID interface{}
		if b.ParentBlockID != nil {
			parentID = *b.ParentBlockID
		}
		_, err := tx.Exec(
			`INSERT INTO blocks(id, page_id, parent_block_id, type, content, content_version, props, order_index, created_at, updated_at)
			 VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			b.ID, b.PageID, parentID, b.Type, b.Content, contentVersion, b.Props, b.OrderIndex, now, now,
		)
		if err != nil {
			return fmt.Errorf("ApplySeed: insert block %s: %w", b.ID, err)
		}
	}

	return nil
}
