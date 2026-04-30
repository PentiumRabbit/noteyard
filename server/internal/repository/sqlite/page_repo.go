package sqlite

import (
	"context"
	"database/sql"
	"noteyard/server/internal/model"
	"time"

	"github.com/google/uuid"
)

type PageRepo struct{ db *sql.DB }

func NewPageRepo(db *sql.DB) *PageRepo { return &PageRepo{db: db} }

func (r *PageRepo) GetByID(ctx context.Context, id string) (*model.Page, error) {
	row := r.db.QueryRowContext(ctx, `SELECT id,parent_id,title,icon,cover,order_index,created_at,updated_at FROM pages WHERE id=?`, id)
	return scanPage(row)
}

func (r *PageRepo) ListChildren(ctx context.Context, parentID string) ([]*model.Page, error) {
	var rows *sql.Rows
	var err error
	if parentID == "" {
		rows, err = r.db.QueryContext(ctx, `SELECT id,parent_id,title,icon,cover,order_index,created_at,updated_at FROM pages WHERE parent_id IS NULL ORDER BY order_index`)
	} else {
		rows, err = r.db.QueryContext(ctx, `SELECT id,parent_id,title,icon,cover,order_index,created_at,updated_at FROM pages WHERE parent_id=? ORDER BY order_index`, parentID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPages(rows)
}

func (r *PageRepo) ListAll(ctx context.Context) ([]*model.Page, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id,parent_id,title,icon,cover,order_index,created_at,updated_at FROM pages ORDER BY order_index`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPages(rows)
}

func (r *PageRepo) Create(ctx context.Context, page *model.Page) error {
	if page.ID == "" {
		page.ID = uuid.NewString()
	}
	now := time.Now().Unix()
	page.CreatedAt = now
	page.UpdatedAt = now
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO pages(id,parent_id,title,icon,cover,order_index,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`,
		page.ID, page.ParentID, page.Title, page.Icon, page.Cover, page.OrderIndex, page.CreatedAt, page.UpdatedAt,
	)
	return err
}

func (r *PageRepo) Update(ctx context.Context, page *model.Page) error {
	page.UpdatedAt = time.Now().Unix()
	_, err := r.db.ExecContext(ctx,
		`UPDATE pages SET title=?,icon=?,cover=?,order_index=?,updated_at=? WHERE id=?`,
		page.Title, page.Icon, page.Cover, page.OrderIndex, page.UpdatedAt, page.ID,
	)
	return err
}

func (r *PageRepo) Delete(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM pages WHERE id=?`, id)
	return err
}

func (r *PageRepo) Move(ctx context.Context, id, newParentID string, newOrder float64) error {
	var parentID interface{}
	if newParentID != "" {
		parentID = newParentID
	}
	_, err := r.db.ExecContext(ctx,
		`UPDATE pages SET parent_id=?,order_index=?,updated_at=? WHERE id=?`,
		parentID, newOrder, time.Now().Unix(), id,
	)
	return err
}

func scanPage(row *sql.Row) (*model.Page, error) {
	p := &model.Page{}
	err := row.Scan(&p.ID, &p.ParentID, &p.Title, &p.Icon, &p.Cover, &p.OrderIndex, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return p, nil
}

func scanPages(rows *sql.Rows) ([]*model.Page, error) {
	var pages []*model.Page
	for rows.Next() {
		p := &model.Page{}
		if err := rows.Scan(&p.ID, &p.ParentID, &p.Title, &p.Icon, &p.Cover, &p.OrderIndex, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		pages = append(pages, p)
	}
	return pages, rows.Err()
}
