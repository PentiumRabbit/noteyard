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
}

type Block struct {
	ID            string  `json:"id"`
	PageID        string  `json:"page_id"`
	ParentBlockID *string `json:"parent_block_id"`
	Type          string  `json:"type"`
	Content       string  `json:"content"`
	OrderIndex    float64 `json:"order_index"`
	CreatedAt     int64   `json:"created_at"`
	UpdatedAt     int64   `json:"updated_at"`
}
