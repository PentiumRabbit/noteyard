// Package db provides schema migration utilities for the noteyard database.
package db

import (
	"database/sql"
	"fmt"
	"time"
)

// WelcomeSeedMigration inserts a default "欢迎使用 noteyard" page with introductory
// blocks the first time a fresh database is initialised.
// It is registered as schema_migrations version 2.
func WelcomeSeedMigration(tx *sql.Tx) error {
	// Only seed if the welcome page doesn't already exist (idempotent by fixed ID).
	var count int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM pages WHERE id = '00000000-0000-0000-0000-000000000001'`).Scan(&count); err != nil {
		return fmt.Errorf("welcome seed: check welcome page: %w", err)
	}
	if count > 0 {
		return nil
	}

	now := time.Now().Unix()
	pageID := "00000000-0000-0000-0000-000000000001"

	_, err := tx.Exec(
		`INSERT INTO pages(id, parent_id, title, icon, cover, order_index, created_at, updated_at)
		 VALUES(?, NULL, ?, ?, NULL, 0.0, ?, ?)`,
		pageID, "欢迎使用 noteyard", "👋", now, now,
	)
	if err != nil {
		return fmt.Errorf("welcome seed: insert page: %w", err)
	}

	p := `{"textColor":"default","backgroundColor":"default","textAlignment":"left"}`
	h2 := `{"level":2,"textColor":"default","backgroundColor":"default","textAlignment":"left"}`
	h3 := `{"level":3,"textColor":"default","backgroundColor":"default","textAlignment":"left"}`

	blocks := []struct {
		id         string
		blockType  string
		content    string
		props      string
		orderIndex float64
	}{
		// ── 标题 ──────────────────────────────────────────────────────────────
		{
			id:         "00000000-0000-0000-0001-000000000001",
			blockType:  "heading",
			content:    `[{"type":"text","text":"欢迎使用 noteyard 👋","styles":{}}]`,
			props:      `{"level":1,"textColor":"default","backgroundColor":"default","textAlignment":"left"}`,
			orderIndex: 1,
		},
		// ── 简介 callout ──────────────────────────────────────────────────────
		{
			id:         "00000000-0000-0000-0001-000000000002",
			blockType:  "callout",
			content:    `[{"type":"text","text":"noteyard 是一款本地优先的块编辑器笔记应用，数据存储在本机，无需联网。你可以自由组合页面、数据库和各种内容块，构建属于自己的知识体系。","styles":{}}]`,
			props:      `{"icon":"📝"}`,
			orderIndex: 2,
		},
		// ── 分割线 ────────────────────────────────────────────────────────────
		{
			id:         "00000000-0000-0000-0001-000000000003",
			blockType:  "horizontalRule",
			content:    `[]`,
			props:      `{}`,
			orderIndex: 3,
		},
		// ── 第一章：页面与导航 ─────────────────────────────────────────────────
		{
			id:         "00000000-0000-0000-0001-000000000004",
			blockType:  "heading",
			content:    `[{"type":"text","text":"📄 页面与导航","styles":{}}]`,
			props:      h2,
			orderIndex: 4,
		},
		{
			id:         "00000000-0000-0000-0001-000000000005",
			blockType:  "paragraph",
			content:    `[{"type":"text","text":"noteyard 以页面为基本单位，页面可以无限嵌套，形成树状结构。","styles":{}}]`,
			props:      p,
			orderIndex: 5,
		},
		{
			id:         "00000000-0000-0000-0001-000000000006",
			blockType:  "heading",
			content:    `[{"type":"text","text":"创建与管理页面","styles":{}}]`,
			props:      h3,
			orderIndex: 6,
		},
		{
			id:         "00000000-0000-0000-0001-000000000007",
			blockType:  "numberedListItem",
			content:    `[{"type":"text","text":"点击左侧边栏底部的 ","styles":{}},{"type":"text","text":"「+ 新建页面」","styles":{"bold":true}},{"type":"text","text":" 按钮，创建顶级页面。","styles":{}}]`,
			props:      p,
			orderIndex: 7,
		},
		{
			id:         "00000000-0000-0000-0001-000000000008",
			blockType:  "numberedListItem",
			content:    `[{"type":"text","text":"将鼠标悬停在侧边栏的页面条目上，点击右侧 ","styles":{}},{"type":"text","text":"「+」","styles":{"bold":true}},{"type":"text","text":" 可在该页面下创建子页面。","styles":{}}]`,
			props:      p,
			orderIndex: 8,
		},
		{
			id:         "00000000-0000-0000-0001-000000000009",
			blockType:  "numberedListItem",
			content:    `[{"type":"text","text":"拖动侧边栏条目可以调整页面的层级与顺序。","styles":{}}]`,
			props:      p,
			orderIndex: 9,
		},
		{
			id:         "00000000-0000-0000-0001-000000000010",
			blockType:  "numberedListItem",
			content:    `[{"type":"text","text":"右键点击页面条目可以重命名、设置图标、删除页面。","styles":{}}]`,
			props:      p,
			orderIndex: 10,
		},
		{
			id:         "00000000-0000-0000-0001-000000000011",
			blockType:  "callout",
			content:    `[{"type":"text","text":"顶部搜索栏（⌘K）可以全局搜索所有页面标题，快速跳转。","styles":{}}]`,
			props:      `{"icon":"🔍"}`,
			orderIndex: 11,
		},
		// ── 第二章：块编辑器 ──────────────────────────────────────────────────
		{
			id:         "00000000-0000-0000-0001-000000000012",
			blockType:  "heading",
			content:    `[{"type":"text","text":"✏️ 块编辑器","styles":{}}]`,
			props:      h2,
			orderIndex: 12,
		},
		{
			id:         "00000000-0000-0000-0001-000000000013",
			blockType:  "paragraph",
			content:    `[{"type":"text","text":"noteyard 的编辑器以「块」为单位组织内容。每一段文字、每一个标题、每一张图片都是一个独立的块，可以自由拖拽排序。","styles":{}}]`,
			props:      p,
			orderIndex: 13,
		},
		{
			id:         "00000000-0000-0000-0001-000000000014",
			blockType:  "heading",
			content:    `[{"type":"text","text":"插入块","styles":{}}]`,
			props:      h3,
			orderIndex: 14,
		},
		{
			id:         "00000000-0000-0000-0001-000000000015",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"在任意位置输入 ","styles":{}},{"type":"text","text":"/","styles":{"bold":true}},{"type":"text","text":" 打开块菜单，选择要插入的块类型。","styles":{}}]`,
			props:      p,
			orderIndex: 15,
		},
		{
			id:         "00000000-0000-0000-0001-000000000016",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"块类型包括：标题（H1/H2/H3）、段落、有序列表、无序列表、引用、标注、分割线、代码块、数据库、子页面等。","styles":{}}]`,
			props:      p,
			orderIndex: 16,
		},
		{
			id:         "00000000-0000-0000-0001-000000000017",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"每个块左侧有 ","styles":{}},{"type":"text","text":"⠿ 拖拽手柄","styles":{"bold":true}},{"type":"text","text":"，鼠标悬停后可拖动调整顺序，点击可以进行删除、复制、转换块类型等操作。","styles":{}}]`,
			props:      p,
			orderIndex: 17,
		},
		{
			id:         "00000000-0000-0000-0001-000000000018",
			blockType:  "heading",
			content:    `[{"type":"text","text":"文字格式化","styles":{}}]`,
			props:      h3,
			orderIndex: 18,
		},
		{
			id:         "00000000-0000-0000-0001-000000000019",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"选中文字后会弹出格式工具栏，支持 ","styles":{}},{"type":"text","text":"加粗","styles":{"bold":true}},{"type":"text","text":"、","styles":{}},{"type":"text","text":"斜体","styles":{"italic":true}},{"type":"text","text":"、","styles":{}},{"type":"text","text":"下划线","styles":{"underline":true}},{"type":"text","text":"、","styles":{}},{"type":"text","text":"删除线","styles":{"strikethrough":true}},{"type":"text","text":"、设置文字颜色与背景色。","styles":{}}]`,
			props:      p,
			orderIndex: 19,
		},
		{
			id:         "00000000-0000-0000-0001-000000000020",
			blockType:  "bulletListItem",
			content:    "[{\"type\":\"text\",\"text\":\"也可以直接用 Markdown 快捷语法：\",\"styles\":{}},{\"type\":\"text\",\"text\":\"**粗体**  *斜体*  ~~删除线~~  `代码`\",\"styles\":{\"code\":true}}]",
			props:      p,
			orderIndex: 20,
		},
		// ── 第三章：数据库 ────────────────────────────────────────────────────
		{
			id:         "00000000-0000-0000-0001-000000000021",
			blockType:  "heading",
			content:    `[{"type":"text","text":"🗃️ 数据库","styles":{}}]`,
			props:      h2,
			orderIndex: 21,
		},
		{
			id:         "00000000-0000-0000-0001-000000000022",
			blockType:  "paragraph",
			content:    `[{"type":"text","text":"数据库块可以将结构化数据嵌入到任意页面中，适合管理任务、书单、项目等有规律的信息。","styles":{}}]`,
			props:      p,
			orderIndex: 22,
		},
		{
			id:         "00000000-0000-0000-0001-000000000023",
			blockType:  "numberedListItem",
			content:    `[{"type":"text","text":"在编辑区输入 ","styles":{}},{"type":"text","text":"/","styles":{"bold":true}},{"type":"text","text":" 选择「数据库」，即可在当前页面内嵌入一个表格。","styles":{}}]`,
			props:      p,
			orderIndex: 23,
		},
		{
			id:         "00000000-0000-0000-0001-000000000024",
			blockType:  "numberedListItem",
			content:    `[{"type":"text","text":"点击列标题可以修改字段名称；点击 ","styles":{}},{"type":"text","text":"「+ 添加列」","styles":{"bold":true}},{"type":"text","text":" 新增字段，支持文本、数字、日期、勾选框、选项等类型。","styles":{}}]`,
			props:      p,
			orderIndex: 24,
		},
		{
			id:         "00000000-0000-0000-0001-000000000025",
			blockType:  "numberedListItem",
			content:    `[{"type":"text","text":"点击底部 ","styles":{}},{"type":"text","text":"「+ 新建行」","styles":{"bold":true}},{"type":"text","text":" 添加数据行，直接在单元格内编辑内容。","styles":{}}]`,
			props:      p,
			orderIndex: 25,
		},
		{
			id:         "00000000-0000-0000-0001-000000000026",
			blockType:  "callout",
			content:    `[{"type":"text","text":"数据库的数据与页面内容一样保存在本地数据库中，重启后依然存在。","styles":{}}]`,
			props:      `{"icon":"💾"}`,
			orderIndex: 26,
		},
		// ── 第四章：快捷键 ────────────────────────────────────────────────────
		{
			id:         "00000000-0000-0000-0001-000000000027",
			blockType:  "heading",
			content:    `[{"type":"text","text":"⌨️ 常用快捷键","styles":{}}]`,
			props:      h2,
			orderIndex: 27,
		},
		{
			id:         "00000000-0000-0000-0001-000000000028",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"⌘K","styles":{"bold":true,"code":true}},{"type":"text","text":" — 全局搜索页面","styles":{}}]`,
			props:      p,
			orderIndex: 28,
		},
		{
			id:         "00000000-0000-0000-0001-000000000029",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"/","styles":{"bold":true,"code":true}},{"type":"text","text":" — 打开块插入菜单","styles":{}}]`,
			props:      p,
			orderIndex: 29,
		},
		{
			id:         "00000000-0000-0000-0001-000000000030",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"⌘Z / ⌘⇧Z","styles":{"bold":true,"code":true}},{"type":"text","text":" — 撤销 / 重做","styles":{}}]`,
			props:      p,
			orderIndex: 30,
		},
		{
			id:         "00000000-0000-0000-0001-000000000031",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"Tab / ⇧Tab","styles":{"bold":true,"code":true}},{"type":"text","text":" — 列表缩进 / 取消缩进","styles":{}}]`,
			props:      p,
			orderIndex: 31,
		},
		{
			id:         "00000000-0000-0000-0001-000000000032",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"Enter","styles":{"bold":true,"code":true}},{"type":"text","text":" — 新建块；","styles":{}},{"type":"text","text":"⇧Enter","styles":{"bold":true,"code":true}},{"type":"text","text":" — 块内换行","styles":{}}]`,
			props:      p,
			orderIndex: 32,
		},
		// ── 尾注 ──────────────────────────────────────────────────────────────
		{
			id:         "00000000-0000-0000-0001-000000000033",
			blockType:  "horizontalRule",
			content:    `[]`,
			props:      `{}`,
			orderIndex: 33,
		},
		{
			id:         "00000000-0000-0000-0001-000000000034",
			blockType:  "quote",
			content:    `[{"type":"text","text":"这是你的起点，也是你的空白画布。删掉这个页面，或者就从这里开始写第一篇笔记吧。","styles":{"italic":true}}]`,
			props:      p,
			orderIndex: 34,
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
