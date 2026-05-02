// Package db provides schema migration utilities for the noteyard database.
package db

import (
	"database/sql"
	"fmt"
	"time"
)

// WelcomeSeedMigration inserts a default "欢迎使用 noteyard" page with introductory
// blocks the first time a fresh database is initialised (no pages exist).
// It is registered as schema_migrations version 2.
func WelcomeSeedMigration(tx *sql.Tx) error {
	// Only seed when the pages table is empty — never overwrite user data.
	var count int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM pages`).Scan(&count); err != nil {
		return fmt.Errorf("welcome seed: count pages: %w", err)
	}
	if count > 0 {
		return nil
	}

	now := time.Now().Unix()
	pageID := "00000000-0000-0000-0000-000000000001"
	icon := "👋"

	_, err := tx.Exec(
		`INSERT INTO pages(id, parent_id, title, icon, cover, order_index, created_at, updated_at)
		 VALUES(?, NULL, ?, ?, NULL, 1.0, ?, ?)`,
		pageID, "欢迎使用 noteyard", icon, now, now,
	)
	if err != nil {
		return fmt.Errorf("welcome seed: insert page: %w", err)
	}

	blocks := []struct {
		id         string
		blockType  string
		content    string
		props      string
		orderIndex float64
	}{
		{
			id:        "00000000-0000-0000-0001-000000000001",
			blockType: "heading",
			// InlineContent[] — one text segment
			content:    `[{"type":"text","text":"欢迎使用 noteyard","styles":{}}]`,
			props:      `{"level":1,"textColor":"default","backgroundColor":"default","textAlignment":"left"}`,
			orderIndex: 1,
		},
		{
			id:        "00000000-0000-0000-0001-000000000002",
			blockType: "paragraph",
			content:   `[{"type":"text","text":"noteyard 是一个块编辑器笔记应用，支持页面、数据库和丰富的内容块。以下是快速上手指南。","styles":{}}]`,
			props:     `{"textColor":"default","backgroundColor":"default","textAlignment":"left"}`,

			orderIndex: 2,
		},
		{
			id:        "00000000-0000-0000-0001-000000000003",
			blockType: "heading",
			content:   `[{"type":"text","text":"创建页面","styles":{}}]`,
			props:     `{"level":2,"textColor":"default","backgroundColor":"default","textAlignment":"left"}`,

			orderIndex: 3,
		},
		{
			id:         "00000000-0000-0000-0001-000000000004",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"点击左侧边栏底部的「+」按钮，或在空白处按 Enter 新建子页面。","styles":{}}]`,
			props:      `{"textColor":"default","backgroundColor":"default","textAlignment":"left"}`,
			orderIndex: 4,
		},
		{
			id:         "00000000-0000-0000-0001-000000000005",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"拖动侧边栏的页面条目可以调整层级与顺序。","styles":{}}]`,
			props:      `{"textColor":"default","backgroundColor":"default","textAlignment":"left"}`,
			orderIndex: 5,
		},
		{
			id:        "00000000-0000-0000-0001-000000000006",
			blockType: "heading",
			content:   `[{"type":"text","text":"使用块编辑器","styles":{}}]`,
			props:     `{"level":2,"textColor":"default","backgroundColor":"default","textAlignment":"left"}`,

			orderIndex: 6,
		},
		{
			id:         "00000000-0000-0000-0001-000000000007",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"在编辑区输入 / 打开块菜单，可插入标题、列表、代码块、引用等。","styles":{}}]`,
			props:      `{"textColor":"default","backgroundColor":"default","textAlignment":"left"}`,
			orderIndex: 7,
		},
		{
			id:         "00000000-0000-0000-0001-000000000008",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"选中文字可以加粗、斜体、设置颜色或添加链接。","styles":{}}]`,
			props:      `{"textColor":"default","backgroundColor":"default","textAlignment":"left"}`,
			orderIndex: 8,
		},
		{
			id:         "00000000-0000-0000-0001-000000000009",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"每个块左侧有拖拽手柄，可自由调整顺序。","styles":{}}]`,
			props:      `{"textColor":"default","backgroundColor":"default","textAlignment":"left"}`,
			orderIndex: 9,
		},
		{
			id:        "00000000-0000-0000-0001-000000000010",
			blockType: "heading",
			content:   `[{"type":"text","text":"创建数据库","styles":{}}]`,
			props:     `{"level":2,"textColor":"default","backgroundColor":"default","textAlignment":"left"}`,

			orderIndex: 10,
		},
		{
			id:         "00000000-0000-0000-0001-000000000011",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"输入 / 并选择「数据库」，即可在当前页面内嵌入一个表格数据库。","styles":{}}]`,
			props:      `{"textColor":"default","backgroundColor":"default","textAlignment":"left"}`,
			orderIndex: 11,
		},
		{
			id:         "00000000-0000-0000-0001-000000000012",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"支持文本、数字、日期、选项等字段类型，可添加行和自定义列。","styles":{}}]`,
			props:      `{"textColor":"default","backgroundColor":"default","textAlignment":"left"}`,
			orderIndex: 12,
		},
		{
			id:        "00000000-0000-0000-0001-000000000013",
			blockType: "heading",
			content:   `[{"type":"text","text":"更多功能","styles":{}}]`,
			props:     `{"level":2,"textColor":"default","backgroundColor":"default","textAlignment":"left"}`,

			orderIndex: 13,
		},
		{
			id:         "00000000-0000-0000-0001-000000000014",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"使用 @[页面名] 可以创建页面间的引用（反向链接）。","styles":{}}]`,
			props:      `{"textColor":"default","backgroundColor":"default","textAlignment":"left"}`,
			orderIndex: 14,
		},
		{
			id:         "00000000-0000-0000-0001-000000000015",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"顶部搜索栏可全局搜索所有页面标题。","styles":{}}]`,
			props:      `{"textColor":"default","backgroundColor":"default","textAlignment":"left"}`,
			orderIndex: 15,
		},
		{
			id:         "00000000-0000-0000-0001-000000000016",
			blockType:  "paragraph",
			content:    `[{"type":"text","text":"祝你使用愉快！可以直接删除或编辑本页面。","styles":{"italic":true}}]`,
			props:      `{"textColor":"default","backgroundColor":"default","textAlignment":"left"}`,
			orderIndex: 16,
		},
	}

	for _, b := range blocks {
		_, err := tx.Exec(
			`INSERT INTO blocks(id, page_id, parent_block_id, type, content, content_version, props, order_index, created_at, updated_at)
			 VALUES(?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
			b.id, pageID, b.blockType, b.content, CurrentContentVersion, b.props, b.orderIndex, now, now,
		)
		if err != nil {
			return fmt.Errorf("welcome seed: insert block %s: %w", b.id, err)
		}
	}

	return nil
}

func init() {
	Migrations = append(Migrations, Migration{
		Version: 2,
		Up:      WelcomeSeedMigration,
	})
}
