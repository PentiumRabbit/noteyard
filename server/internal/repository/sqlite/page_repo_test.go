package sqlite

import (
	"context"
	"testing"

	"noteyard/server/internal/model"
)

func newTestDB(t *testing.T) *PageRepo {
	t.Helper()
	db, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open in-memory db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return NewPageRepo(db)
}

func strPtr(s string) *string { return &s }

func TestPageRepo_CreateAndGetByID(t *testing.T) {
	r := newTestDB(t)
	ctx := context.Background()

	icon := "📄"
	page := &model.Page{Title: "Hello", Icon: &icon}
	if err := r.Create(ctx, page); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if page.ID == "" {
		t.Fatal("expected ID to be set after Create")
	}

	got, err := r.GetByID(ctx, page.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.Title != "Hello" {
		t.Errorf("Title: got %q, want %q", got.Title, "Hello")
	}
	if got.Icon == nil || *got.Icon != "📄" {
		t.Errorf("Icon: got %v, want %q", got.Icon, "📄")
	}
}

func TestPageRepo_GetByID_NotFound(t *testing.T) {
	r := newTestDB(t)
	_, err := r.GetByID(context.Background(), "nonexistent")
	if err == nil {
		t.Fatal("expected error for missing page, got nil")
	}
}

func TestPageRepo_ListAll(t *testing.T) {
	r := newTestDB(t)
	ctx := context.Background()

	for _, title := range []string{"A", "B", "C"} {
		if err := r.Create(ctx, &model.Page{Title: title}); err != nil {
			t.Fatalf("Create %q: %v", title, err)
		}
	}

	pages, err := r.ListAll(ctx)
	if err != nil {
		t.Fatalf("ListAll: %v", err)
	}
	if len(pages) != 3 {
		t.Errorf("ListAll: got %d pages, want 3", len(pages))
	}
}

func TestPageRepo_ListAll_ExcludesSoftDeleted(t *testing.T) {
	r := newTestDB(t)
	ctx := context.Background()

	p := &model.Page{Title: "ToDelete"}
	r.Create(ctx, p)
	r.Create(ctx, &model.Page{Title: "Keep"})
	r.SoftDelete(ctx, p.ID)

	pages, _ := r.ListAll(ctx)
	if len(pages) != 1 {
		t.Errorf("expected 1 active page, got %d", len(pages))
	}
	if pages[0].Title != "Keep" {
		t.Errorf("expected 'Keep', got %q", pages[0].Title)
	}
}

func TestPageRepo_Update(t *testing.T) {
	r := newTestDB(t)
	ctx := context.Background()

	p := &model.Page{Title: "Old"}
	r.Create(ctx, p)

	p.Title = "New"
	p.Icon = strPtr("🔥")
	if err := r.Update(ctx, p); err != nil {
		t.Fatalf("Update: %v", err)
	}

	got, _ := r.GetByID(ctx, p.ID)
	if got.Title != "New" {
		t.Errorf("Title after update: got %q, want %q", got.Title, "New")
	}
	if got.Icon == nil || *got.Icon != "🔥" {
		t.Errorf("Icon after update: got %v, want %q", got.Icon, "🔥")
	}
}

func TestPageRepo_SoftDelete_And_Restore(t *testing.T) {
	r := newTestDB(t)
	ctx := context.Background()

	p := &model.Page{Title: "Temp"}
	r.Create(ctx, p)

	if err := r.SoftDelete(ctx, p.ID); err != nil {
		t.Fatalf("SoftDelete: %v", err)
	}

	trashed, _ := r.ListTrashed(ctx)
	if len(trashed) != 1 || trashed[0].ID != p.ID {
		t.Errorf("expected trashed page in ListTrashed")
	}

	active, _ := r.ListAll(ctx)
	if len(active) != 0 {
		t.Errorf("expected 0 active pages after soft delete, got %d", len(active))
	}

	if err := r.Restore(ctx, p.ID); err != nil {
		t.Fatalf("Restore: %v", err)
	}

	active, _ = r.ListAll(ctx)
	if len(active) != 1 {
		t.Errorf("expected 1 active page after restore, got %d", len(active))
	}
}

func TestPageRepo_PermanentDelete(t *testing.T) {
	r := newTestDB(t)
	ctx := context.Background()

	p := &model.Page{Title: "Gone"}
	r.Create(ctx, p)
	r.SoftDelete(ctx, p.ID)

	if err := r.PermanentDelete(ctx, p.ID); err != nil {
		t.Fatalf("PermanentDelete: %v", err)
	}

	_, err := r.GetByID(ctx, p.ID)
	if err == nil {
		t.Fatal("expected error after permanent delete, got nil")
	}

	trashed, _ := r.ListTrashed(ctx)
	if len(trashed) != 0 {
		t.Errorf("expected empty trash after permanent delete, got %d", len(trashed))
	}
}

func TestPageRepo_Search(t *testing.T) {
	r := newTestDB(t)
	ctx := context.Background()

	r.Create(ctx, &model.Page{Title: "Go Programming"})
	r.Create(ctx, &model.Page{Title: "Python Basics"})
	r.Create(ctx, &model.Page{Title: "Golang Tips"})

	results, err := r.Search(ctx, "Go")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(results) != 2 {
		t.Errorf("Search 'Go': got %d results, want 2", len(results))
	}
}

func TestPageRepo_Search_ExcludesSoftDeleted(t *testing.T) {
	r := newTestDB(t)
	ctx := context.Background()

	p := &model.Page{Title: "Deleted Go"}
	r.Create(ctx, p)
	r.SoftDelete(ctx, p.ID)

	results, _ := r.Search(ctx, "Go")
	if len(results) != 0 {
		t.Errorf("Search should exclude soft deleted pages, got %d", len(results))
	}
}

func TestPageRepo_GetAncestors(t *testing.T) {
	r := newTestDB(t)
	ctx := context.Background()

	root := &model.Page{Title: "Root"}
	r.Create(ctx, root)
	child := &model.Page{Title: "Child", ParentID: &root.ID}
	r.Create(ctx, child)
	grandchild := &model.Page{Title: "Grandchild", ParentID: &child.ID}
	r.Create(ctx, grandchild)

	ancestors, err := r.GetAncestors(ctx, grandchild.ID)
	if err != nil {
		t.Fatalf("GetAncestors: %v", err)
	}
	if len(ancestors) != 2 {
		t.Fatalf("expected 2 ancestors, got %d", len(ancestors))
	}
	if ancestors[0].Title != "Root" {
		t.Errorf("ancestors[0] should be Root, got %q", ancestors[0].Title)
	}
	if ancestors[1].Title != "Child" {
		t.Errorf("ancestors[1] should be Child, got %q", ancestors[1].Title)
	}
}

func TestPageRepo_GetAncestors_RootPage(t *testing.T) {
	r := newTestDB(t)
	ctx := context.Background()

	root := &model.Page{Title: "Root"}
	r.Create(ctx, root)

	ancestors, err := r.GetAncestors(ctx, root.ID)
	if err != nil {
		t.Fatalf("GetAncestors: %v", err)
	}
	if len(ancestors) != 0 {
		t.Errorf("root page should have 0 ancestors, got %d", len(ancestors))
	}
}

func TestPageRepo_Move(t *testing.T) {
	r := newTestDB(t)
	ctx := context.Background()

	parent := &model.Page{Title: "Parent"}
	r.Create(ctx, parent)
	child := &model.Page{Title: "Child"}
	r.Create(ctx, child)

	if err := r.Move(ctx, child.ID, parent.ID, 1.0); err != nil {
		t.Fatalf("Move: %v", err)
	}

	got, _ := r.GetByID(ctx, child.ID)
	if got.ParentID == nil || *got.ParentID != parent.ID {
		t.Errorf("expected ParentID=%q after Move, got %v", parent.ID, got.ParentID)
	}
}

func TestPageRepo_Move_ToRoot(t *testing.T) {
	r := newTestDB(t)
	ctx := context.Background()

	parent := &model.Page{Title: "Parent"}
	r.Create(ctx, parent)
	child := &model.Page{Title: "Child", ParentID: &parent.ID}
	r.Create(ctx, child)

	if err := r.Move(ctx, child.ID, "", 0); err != nil {
		t.Fatalf("Move to root: %v", err)
	}

	got, _ := r.GetByID(ctx, child.ID)
	if got.ParentID != nil {
		t.Errorf("expected nil ParentID after move to root, got %v", got.ParentID)
	}
}

func TestPageRepo_Backlinks(t *testing.T) {
	ctx := context.Background()

	db, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()
	pageRepo := NewPageRepo(db)
	blockRepo := NewBlockRepo(db)

	target := &model.Page{Title: "Target"}
	pageRepo.Create(ctx, target)
	referrer := &model.Page{Title: "Referrer"}
	pageRepo.Create(ctx, referrer)

	content := `[{"type":"mention","props":{"pageId":"` + target.ID + `"}}]`
	blockRepo.Create(ctx, &model.Block{
		PageID:  referrer.ID,
		Type:    "paragraph",
		Content: content,
	})

	links, err := pageRepo.Backlinks(ctx, target.ID)
	if err != nil {
		t.Fatalf("Backlinks: %v", err)
	}
	if len(links) != 1 || links[0].ID != referrer.ID {
		t.Errorf("expected 1 backlink from referrer, got %d", len(links))
	}
}

func TestPageRepo_Backlinks_Empty(t *testing.T) {
	r := newTestDB(t)
	ctx := context.Background()

	p := &model.Page{Title: "Lonely"}
	r.Create(ctx, p)

	links, err := r.Backlinks(ctx, p.ID)
	if err != nil {
		t.Fatalf("Backlinks: %v", err)
	}
	if len(links) != 0 {
		t.Errorf("expected 0 backlinks, got %d", len(links))
	}
}
