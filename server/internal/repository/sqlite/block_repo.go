package sqlite

import (
	"context"
	"database/sql"
	"noteyard/server/internal/model"
	"time"

	"github.com/google/uuid"
)

type BlockRepo struct{ db *sql.DB }

func NewBlockRepo(db *sql.DB) *BlockRepo { return &BlockRepo{db: db} }

func (r *BlockRepo) ListByPage(ctx context.Context, pageID string) ([]*model.Block, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id,page_id,parent_block_id,type,content,props,order_index,created_at,updated_at FROM blocks WHERE page_id=? ORDER BY order_index, created_at`,
		pageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var blocks []*model.Block
	for rows.Next() {
		b := &model.Block{}
		if err := rows.Scan(&b.ID, &b.PageID, &b.ParentBlockID, &b.Type, &b.Content, &b.Props, &b.OrderIndex, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return nil, err
		}
		blocks = append(blocks, b)
	}
	return blocks, rows.Err()
}

func (r *BlockRepo) GetByID(ctx context.Context, id string) (*model.Block, error) {
	b := &model.Block{}
	err := r.db.QueryRowContext(ctx,
		`SELECT id,page_id,parent_block_id,type,content,props,order_index,created_at,updated_at FROM blocks WHERE id=?`, id,
	).Scan(&b.ID, &b.PageID, &b.ParentBlockID, &b.Type, &b.Content, &b.Props, &b.OrderIndex, &b.CreatedAt, &b.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return b, nil
}

func (r *BlockRepo) Create(ctx context.Context, block *model.Block) error {
	if block.ID == "" {
		block.ID = uuid.NewString()
	}
	now := time.Now().Unix()
	block.CreatedAt = now
	block.UpdatedAt = now
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO blocks(id,page_id,parent_block_id,type,content,props,order_index,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
		block.ID, block.PageID, block.ParentBlockID, block.Type, block.Content, block.Props, block.OrderIndex, block.CreatedAt, block.UpdatedAt)
	return err
}

func (r *BlockRepo) Update(ctx context.Context, block *model.Block) error {
	block.UpdatedAt = time.Now().Unix()
	_, err := r.db.ExecContext(ctx,
		`UPDATE blocks SET type=?,content=?,props=?,order_index=?,parent_block_id=?,updated_at=? WHERE id=?`,
		block.Type, block.Content, block.Props, block.OrderIndex, block.ParentBlockID, block.UpdatedAt, block.ID)
	return err
}

func (r *BlockRepo) Delete(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM blocks WHERE id=?`, id)
	return err
}

func (r *BlockRepo) BatchUpdate(ctx context.Context, blocks []*model.Block) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := time.Now().Unix()
	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO blocks(id, page_id, parent_block_id, type, content, props, order_index, created_at, updated_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			type=excluded.type,
			content=excluded.content,
			props=excluded.props,
			order_index=excluded.order_index,
			parent_block_id=excluded.parent_block_id,
			updated_at=excluded.updated_at`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, b := range blocks {
		if _, err := stmt.ExecContext(ctx, b.ID, b.PageID, b.ParentBlockID, b.Type, b.Content, b.Props, b.OrderIndex, now, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}
