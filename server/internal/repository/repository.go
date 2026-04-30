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
