package model

type Page struct {
	ID         string  `json:"id"`
	ParentID   *string `json:"parent_id"`
	Title      string  `json:"title"`
	Icon       *string `json:"icon"`
	Cover      *string `json:"cover"`
	OrderIndex float64 `json:"order_index"`
	CreatedAt  int64   `json:"created_at"`
	UpdatedAt  int64   `json:"updated_at"`
	DeletedAt  *int64  `json:"deleted_at,omitempty"`
}

type Block struct {
	ID             string  `json:"id"`
	PageID         string  `json:"page_id"`
	ParentBlockID  *string `json:"parent_block_id"`
	Type           string  `json:"type"`
	Content        string  `json:"content"`
	ContentVersion int     `json:"content_version"`
	Props          string  `json:"props"`
	OrderIndex     float64 `json:"order_index"`
	CreatedAt      int64   `json:"created_at"`
	UpdatedAt      int64   `json:"updated_at"`
}

type Database struct {
	ID        string      `json:"id"`
	PageID    string      `json:"page_id"`
	Title     string      `json:"title"`
	Columns   []*DBColumn `json:"columns"`
	CreatedAt int64       `json:"created_at"`
	UpdatedAt int64       `json:"updated_at"`
}

type DBColumn struct {
	ID         string  `json:"id"`
	DatabaseID string  `json:"database_id"`
	Name       string  `json:"name"`
	Type       string  `json:"type"`
	Options    string  `json:"options"`
	Formula    string  `json:"formula"`
	IsHidden   bool    `json:"is_hidden"`
	OrderIndex float64 `json:"order_index"`
	CreatedAt  int64   `json:"created_at"`
	UpdatedAt  int64   `json:"updated_at"`
}

type DBRow struct {
	ID         string            `json:"id"`
	DatabaseID string            `json:"database_id"`
	Content    string            `json:"content"`
	OrderIndex float64           `json:"order_index"`
	Cells      map[string]string `json:"cells"`
	CreatedAt  int64             `json:"created_at"`
	UpdatedAt  int64             `json:"updated_at"`
}

type DBCell struct {
	RowID     string `json:"row_id"`
	ColumnID  string `json:"column_id"`
	Value     string `json:"value"`
	UpdatedAt int64  `json:"updated_at"`
}

// DatabaseSummary is a lightweight representation of a database used by ListAll.
// It omits columns and row data to keep the response small.
type DatabaseSummary struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	PageID string `json:"page_id"`
}
