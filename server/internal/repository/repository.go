package repository

import (
	"context"
	"noteyard/server/internal/model"
)

type PageRepository interface {
	GetByID(ctx context.Context, id string) (*model.Page, error)
	ListChildren(ctx context.Context, parentID string) ([]*model.Page, error)
	ListAll(ctx context.Context) ([]*model.Page, error)
	Create(ctx context.Context, page *model.Page) error
	Update(ctx context.Context, page *model.Page) error
	Delete(ctx context.Context, id string) error
	Move(ctx context.Context, id, newParentID string, newOrder float64) error
}

type BlockRepository interface {
	ListByPage(ctx context.Context, pageID string) ([]*model.Block, error)
	GetByID(ctx context.Context, id string) (*model.Block, error)
	Create(ctx context.Context, block *model.Block) error
	Update(ctx context.Context, block *model.Block) error
	Delete(ctx context.Context, id string) error
	BatchUpdate(ctx context.Context, blocks []*model.Block) error
}

type DatabaseRepository interface {
	Create(ctx context.Context, db *model.Database) error
	GetByID(ctx context.Context, id string) (*model.Database, error)
	Delete(ctx context.Context, id string) error

	AddColumn(ctx context.Context, col *model.DBColumn) error
	UpdateColumn(ctx context.Context, col *model.DBColumn) error
	DeleteColumn(ctx context.Context, colID string) error

	AddRow(ctx context.Context, row *model.DBRow) error
	DeleteRow(ctx context.Context, rowID string) error
	ListRows(ctx context.Context, dbID string) ([]*model.DBRow, error)
	BatchUpdateCells(ctx context.Context, rowID string, cells []*model.DBCell) error
}
