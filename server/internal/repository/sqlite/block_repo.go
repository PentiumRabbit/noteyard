package sqlite

import (
	"context"
	"database/sql"
	"log"
	"noteyard/server/internal/db"
	"noteyard/server/internal/model"
	"time"

	"github.com/google/uuid"
)

type BlockRepo struct{ db *sql.DB }

func NewBlockRepo(sqlDB *sql.DB) *BlockRepo { return &BlockRepo{db: sqlDB} }

// scanBlock reads a block row and applies content migration if needed.
func scanBlock(b *model.Block, scanner interface {
	Scan(dest ...any) error
}) error {
	err := scanner.Scan(
		&b.ID, &b.PageID, &b.ParentBlockID, &b.Type,
		&b.Content, &b.ContentVersion, &b.Props,
		&b.OrderIndex, &b.CreatedAt, &b.UpdatedAt,
	)
	if err != nil {
		return err
	}
	// Apply content migration if stored version is behind current version.
	if b.ContentVersion < db.CurrentContentVersion {
		migrated, _, migrateErr := db.MigrateContent(b.Content, b.ContentVersion)
		if migrateErr != nil {
			log.Printf("[block_repo] content migration failed for block %s: %v", b.ID, migrateErr)
		} else {
			b.Content = migrated
			b.ContentVersion = db.CurrentContentVersion
		}
	}
	return nil
}

func (r *BlockRepo) ListByPage(ctx context.Context, pageID string) ([]*model.Block, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id,page_id,parent_block_id,type,content,content_version,props,order_index,created_at,updated_at
		 FROM blocks WHERE page_id=? ORDER BY order_index, created_at`,
		pageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var blocks []*model.Block
	for rows.Next() {
		b := &model.Block{}
		if err := scanBlock(b, rows); err != nil {
			return nil, err
		}
		blocks = append(blocks, b)
	}
	return blocks, rows.Err()
}

func (r *BlockRepo) GetByID(ctx context.Context, id string) (*model.Block, error) {
	b := &model.Block{}
	row := r.db.QueryRowContext(ctx,
		`SELECT id,page_id,parent_block_id,type,content,content_version,props,order_index,created_at,updated_at
		 FROM blocks WHERE id=?`, id)
	if err := scanBlock(b, row); err != nil {
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
	block.ContentVersion = db.CurrentContentVersion
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO blocks(id,page_id,parent_block_id,type,content,content_version,props,order_index,created_at,updated_at)
		 VALUES(?,?,?,?,?,?,?,?,?,?)`,
		block.ID, block.PageID, block.ParentBlockID, block.Type,
		block.Content, block.ContentVersion, block.Props,
		block.OrderIndex, block.CreatedAt, block.UpdatedAt)
	return err
}

func (r *BlockRepo) Update(ctx context.Context, block *model.Block) error {
	block.UpdatedAt = time.Now().Unix()
	block.ContentVersion = db.CurrentContentVersion
	_, err := r.db.ExecContext(ctx,
		`UPDATE blocks SET type=?,content=?,content_version=?,props=?,order_index=?,parent_block_id=?,updated_at=? WHERE id=?`,
		block.Type, block.Content, block.ContentVersion, block.Props,
		block.OrderIndex, block.ParentBlockID, block.UpdatedAt, block.ID)
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
		INSERT INTO blocks(id, page_id, parent_block_id, type, content, content_version, props, order_index, created_at, updated_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			type=excluded.type,
			content=excluded.content,
			content_version=excluded.content_version,
			props=excluded.props,
			order_index=excluded.order_index,
			parent_block_id=excluded.parent_block_id,
			updated_at=excluded.updated_at`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	// Collect all IDs present in this batch, grouped by page_id.
	pageIDs := make(map[string][]string)
	for _, b := range blocks {
		props := b.Props
		if props == "" {
			props = "{}"
		}
		if _, err := stmt.ExecContext(ctx,
			b.ID, b.PageID, b.ParentBlockID, b.Type,
			b.Content, db.CurrentContentVersion, props,
			b.OrderIndex, now, now); err != nil {
			return err
		}
		pageIDs[b.PageID] = append(pageIDs[b.PageID], b.ID)
	}

	// Delete orphan blocks: rows that belong to a page in this batch but whose
	// IDs are not present in the batch. ON DELETE CASCADE handles child blocks.
	for pageID, ids := range pageIDs {
		if len(ids) == 0 {
			// All blocks removed from page — delete everything.
			if _, err := tx.ExecContext(ctx,
				`DELETE FROM blocks WHERE page_id = ?`, pageID); err != nil {
				return err
			}
			continue
		}
		// Build a parameterised IN clause. SQLite supports up to ~999 parameters;
		// for typical page sizes this is never an issue.
		args := make([]interface{}, 0, len(ids)+1)
		args = append(args, pageID)
		placeholders := make([]byte, 0, len(ids)*2)
		for i, id := range ids {
			if i > 0 {
				placeholders = append(placeholders, ',')
			}
			placeholders = append(placeholders, '?')
			args = append(args, id)
		}
		query := "DELETE FROM blocks WHERE page_id = ? AND id NOT IN (" + string(placeholders) + ")"
		if _, err := tx.ExecContext(ctx, query, args...); err != nil {
			return err
		}
	}

	return tx.Commit()
}
