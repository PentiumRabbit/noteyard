package seeds

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// ─────────────────────────────────────────────────────────────────────────────
// expandContent tests
// ─────────────────────────────────────────────────────────────────────────────

func TestExpandContent_String(t *testing.T) {
	raw := json.RawMessage(`"hello world"`)
	got, err := expandContent(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Should produce a single inline text object.
	var arr []map[string]interface{}
	if err := json.Unmarshal([]byte(got), &arr); err != nil {
		t.Fatalf("result is not valid JSON array: %v", err)
	}
	if len(arr) != 1 {
		t.Fatalf("expected 1 element, got %d", len(arr))
	}
	if arr[0]["type"] != "text" {
		t.Errorf("expected type=text, got %v", arr[0]["type"])
	}
	if arr[0]["text"] != "hello world" {
		t.Errorf("expected text='hello world', got %v", arr[0]["text"])
	}
	styles, ok := arr[0]["styles"].(map[string]interface{})
	if !ok {
		t.Errorf("expected styles to be a map, got %T", arr[0]["styles"])
	} else if len(styles) != 0 {
		t.Errorf("expected empty styles, got %v", styles)
	}
}

func TestExpandContent_Array(t *testing.T) {
	raw := json.RawMessage(`[{"type":"text","text":"foo","styles":{}}]`)
	got, err := expandContent(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Should come back unchanged.
	if got != `[{"type":"text","text":"foo","styles":{}}]` {
		t.Errorf("expected passthrough, got %q", got)
	}
}

func TestExpandContent_Null(t *testing.T) {
	got, err := expandContent(json.RawMessage("null"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "[]" {
		t.Errorf("expected [], got %q", got)
	}
}

func TestExpandContent_Empty(t *testing.T) {
	got, err := expandContent(nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "[]" {
		t.Errorf("expected [], got %q", got)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// columnList nesting test
// ─────────────────────────────────────────────────────────────────────────────

const columnListJSON = `{
  "version": 1,
  "page": {
    "id": "00000000-0000-0000-0000-000000000099",
    "title": "Test Page",
    "icon": "🧪",
    "order_index": 0
  },
  "blocks": [
    {
      "id": "00000000-0000-0000-0001-000000000050",
      "type": "columnList",
      "children": [
        {
          "id": "00000000-0000-0000-0001-000000000051",
          "type": "column",
          "children": [
            {
              "id": "00000000-0000-0000-0001-000000000052",
              "type": "paragraph",
              "content": "左列内容"
            }
          ]
        },
        {
          "id": "00000000-0000-0000-0001-000000000053",
          "type": "column",
          "children": [
            {
              "id": "00000000-0000-0000-0001-000000000054",
              "type": "paragraph",
              "content": "右列内容"
            }
          ]
        }
      ]
    }
  ]
}`

func TestLoadSeed_ColumnListNesting(t *testing.T) {
	// Write temp file.
	dir := t.TempDir()
	path := filepath.Join(dir, "test.json")
	if err := os.WriteFile(path, []byte(columnListJSON), 0o644); err != nil {
		t.Fatalf("write temp file: %v", err)
	}

	page, blocks, err := LoadSeed(path)
	if err != nil {
		t.Fatalf("LoadSeed error: %v", err)
	}

	if page.ID != "00000000-0000-0000-0000-000000000099" {
		t.Errorf("unexpected page id: %s", page.ID)
	}

	// Expected flat order: columnList, column(left), paragraph(left), column(right), paragraph(right).
	if len(blocks) != 5 {
		t.Fatalf("expected 5 blocks, got %d", len(blocks))
	}

	byID := make(map[string]SeedBlock)
	for _, b := range blocks {
		byID[b.ID] = b
	}

	// columnList should have no parent.
	cl := byID["00000000-0000-0000-0001-000000000050"]
	if cl.ParentBlockID != nil {
		t.Errorf("columnList should have nil parent, got %v", *cl.ParentBlockID)
	}

	// column(left) parent = columnList
	colLeft := byID["00000000-0000-0000-0001-000000000051"]
	if colLeft.ParentBlockID == nil || *colLeft.ParentBlockID != "00000000-0000-0000-0001-000000000050" {
		t.Errorf("column(left) parent should be columnList, got %v", colLeft.ParentBlockID)
	}

	// paragraph(left) parent = column(left)
	paraLeft := byID["00000000-0000-0000-0001-000000000052"]
	if paraLeft.ParentBlockID == nil || *paraLeft.ParentBlockID != "00000000-0000-0000-0001-000000000051" {
		t.Errorf("paragraph(left) parent should be column(left), got %v", paraLeft.ParentBlockID)
	}

	// Verify content string expansion for paragraph(left).
	var arr []map[string]interface{}
	if err := json.Unmarshal([]byte(paraLeft.Content), &arr); err != nil {
		t.Fatalf("paragraph content not valid JSON: %v", err)
	}
	if len(arr) != 1 || arr[0]["text"] != "左列内容" {
		t.Errorf("unexpected paragraph content: %s", paraLeft.Content)
	}

	// column(right) parent = columnList
	colRight := byID["00000000-0000-0000-0001-000000000053"]
	if colRight.ParentBlockID == nil || *colRight.ParentBlockID != "00000000-0000-0000-0001-000000000050" {
		t.Errorf("column(right) parent should be columnList, got %v", colRight.ParentBlockID)
	}

	// paragraph(right) parent = column(right)
	paraRight := byID["00000000-0000-0000-0001-000000000054"]
	if paraRight.ParentBlockID == nil || *paraRight.ParentBlockID != "00000000-0000-0000-0001-000000000053" {
		t.Errorf("paragraph(right) parent should be column(right), got %v", paraRight.ParentBlockID)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// LoadSeed: load actual welcome.json
// ─────────────────────────────────────────────────────────────────────────────

func TestLoadSeed_Welcome(t *testing.T) {
	page, blocks, err := LoadSeed("welcome.json")
	if err != nil {
		t.Fatalf("LoadSeed(welcome.json) error: %v", err)
	}
	if page.ID != "00000000-0000-0000-0000-000000000001" {
		t.Errorf("unexpected page id: %s", page.ID)
	}
	if len(blocks) == 0 {
		t.Error("expected non-empty blocks")
	}
	// Every block must have a non-empty ID, type, and valid JSON content.
	for _, b := range blocks {
		if b.ID == "" {
			t.Error("block with empty ID")
		}
		if b.Type == "" {
			t.Errorf("block %s has empty type", b.ID)
		}
		// Content must be a valid JSON array OR object (table/bookmark blocks use object content).
		var v interface{}
		if err := json.Unmarshal([]byte(b.Content), &v); err != nil {
			t.Errorf("block %s content is not valid JSON: %v", b.ID, err)
		}
	}
}
