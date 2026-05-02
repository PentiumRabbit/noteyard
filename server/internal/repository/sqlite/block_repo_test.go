package sqlite

import (
	"context"
	"testing"

	"noteyard/server/internal/model"
)

func newTestDBWithBlock(t *testing.T) (*PageRepo, *BlockRepo) {
	t.Helper()
	db, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open in-memory db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return NewPageRepo(db), NewBlockRepo(db)
}

func seedPage(t *testing.T, pr *PageRepo, title string) *model.Page {
	t.Helper()
	p := &model.Page{Title: title}
	if err := pr.Create(context.Background(), p); err != nil {
		t.Fatalf("seed page %q: %v", title, err)
	}
	return p
}

func TestBlockRepo_CreateAndGetByID(t *testing.T) {
	pr, br := newTestDBWithBlock(t)
	ctx := context.Background()
	page := seedPage(t, pr, "Test Page")

	block := &model.Block{
		PageID:  page.ID,
		Type:    "paragraph",
		Content: `[{"text":"hello"}]`,
		Props:   `{}`,
	}
	if err := br.Create(ctx, block); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if block.ID == "" {
		t.Fatal("expected ID to be set after Create")
	}

	got, err := br.GetByID(ctx, block.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.Type != "paragraph" {
		t.Errorf("Type: got %q, want %q", got.Type, "paragraph")
	}
	if got.Content != `[{"text":"hello"}]` {
		t.Errorf("Content: got %q", got.Content)
	}
}

func TestBlockRepo_GetByID_NotFound(t *testing.T) {
	_, br := newTestDBWithBlock(t)
	_, err := br.GetByID(context.Background(), "no-such-id")
	if err == nil {
		t.Fatal("expected error for missing block, got nil")
	}
}

func TestBlockRepo_ListByPage(t *testing.T) {
	pr, br := newTestDBWithBlock(t)
	ctx := context.Background()
	page := seedPage(t, pr, "Page A")
	other := seedPage(t, pr, "Page B")

	for i, content := range []string{`["a"]`, `["b"]`, `["c"]`} {
		br.Create(ctx, &model.Block{PageID: page.ID, Type: "paragraph", Content: content, OrderIndex: float64(i)})
	}
	br.Create(ctx, &model.Block{PageID: other.ID, Type: "paragraph", Content: `["x"]`})

	blocks, err := br.ListByPage(ctx, page.ID)
	if err != nil {
		t.Fatalf("ListByPage: %v", err)
	}
	if len(blocks) != 3 {
		t.Errorf("expected 3 blocks, got %d", len(blocks))
	}
}

func TestBlockRepo_ListByPage_Empty(t *testing.T) {
	pr, br := newTestDBWithBlock(t)
	page := seedPage(t, pr, "Empty")

	blocks, err := br.ListByPage(context.Background(), page.ID)
	if err != nil {
		t.Fatalf("ListByPage: %v", err)
	}
	if len(blocks) != 0 {
		t.Errorf("expected 0 blocks, got %d", len(blocks))
	}
}

func TestBlockRepo_Update(t *testing.T) {
	pr, br := newTestDBWithBlock(t)
	ctx := context.Background()
	page := seedPage(t, pr, "Page")

	b := &model.Block{PageID: page.ID, Type: "paragraph", Content: `["old"]`, Props: `{}`}
	br.Create(ctx, b)

	b.Content = `["new"]`
	b.Type = "heading"
	if err := br.Update(ctx, b); err != nil {
		t.Fatalf("Update: %v", err)
	}

	got, _ := br.GetByID(ctx, b.ID)
	if got.Content != `["new"]` {
		t.Errorf("Content after update: got %q", got.Content)
	}
	if got.Type != "heading" {
		t.Errorf("Type after update: got %q", got.Type)
	}
}

func TestBlockRepo_Delete(t *testing.T) {
	pr, br := newTestDBWithBlock(t)
	ctx := context.Background()
	page := seedPage(t, pr, "Page")

	b := &model.Block{PageID: page.ID, Type: "paragraph", Content: `[]`}
	br.Create(ctx, b)

	if err := br.Delete(ctx, b.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	_, err := br.GetByID(ctx, b.ID)
	if err == nil {
		t.Fatal("expected error after delete, got nil")
	}
}

func TestBlockRepo_BatchUpdate_Insert(t *testing.T) {
	pr, br := newTestDBWithBlock(t)
	ctx := context.Background()
	page := seedPage(t, pr, "Page")

	blocks := []*model.Block{
		{ID: "b1", PageID: page.ID, Type: "paragraph", Content: `["x"]`, Props: `{}`, OrderIndex: 0},
		{ID: "b2", PageID: page.ID, Type: "paragraph", Content: `["y"]`, Props: `{}`, OrderIndex: 1},
	}
	if err := br.BatchUpdate(ctx, blocks); err != nil {
		t.Fatalf("BatchUpdate insert: %v", err)
	}

	listed, _ := br.ListByPage(ctx, page.ID)
	if len(listed) != 2 {
		t.Errorf("expected 2 blocks after batch insert, got %d", len(listed))
	}
}

func TestBlockRepo_BatchUpdate_Upsert(t *testing.T) {
	pr, br := newTestDBWithBlock(t)
	ctx := context.Background()
	page := seedPage(t, pr, "Page")

	b := &model.Block{PageID: page.ID, Type: "paragraph", Content: `["old"]`, Props: `{}`}
	br.Create(ctx, b)

	updated := []*model.Block{
		{ID: b.ID, PageID: page.ID, Type: "paragraph", Content: `["new"]`, Props: `{}`, OrderIndex: 0},
	}
	if err := br.BatchUpdate(ctx, updated); err != nil {
		t.Fatalf("BatchUpdate upsert: %v", err)
	}

	got, _ := br.GetByID(ctx, b.ID)
	if got.Content != `["new"]` {
		t.Errorf("Content after upsert: got %q, want %q", got.Content, `["new"]`)
	}
}

func TestBlockRepo_BatchUpdate_EmptyProps(t *testing.T) {
	pr, br := newTestDBWithBlock(t)
	ctx := context.Background()
	page := seedPage(t, pr, "Page")

	blocks := []*model.Block{
		{ID: "b-empty-props", PageID: page.ID, Type: "paragraph", Content: `[]`, Props: "", OrderIndex: 0},
	}
	if err := br.BatchUpdate(ctx, blocks); err != nil {
		t.Fatalf("BatchUpdate with empty props: %v", err)
	}

	got, _ := br.GetByID(ctx, "b-empty-props")
	if got.Props != "{}" {
		t.Errorf("empty props should be stored as {}, got %q", got.Props)
	}
}
