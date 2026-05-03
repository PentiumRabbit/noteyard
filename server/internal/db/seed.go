// Package db provides schema migration utilities for the noteyard database.
package db

import (
	"database/sql"
	"fmt"
	"noteyard/server/internal/db/seeds"
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
			content:    `[{"type":"text","text":"选中文字后会弹出格式工具栏，支持 ","styles":{}},{"type":"text","text":"加粗","styles":{"bold":true}},{"type":"text","text":"、","styles":{}},{"type":"text","text":"斜体","styles":{"italic":true}},{"type":"text","text":"、","styles":{}},{"type":"text","text":"下划线","styles":{"underline":true}},{"type":"text","text":"、","styles":{}},{"type":"text","text":"删除线","styles":{"strike":true}},{"type":"text","text":"、设置文字颜色与背景色。","styles":{}}]`,
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
		// ── 第四章：页面装饰 ──────────────────────────────────────────────────
		{
			id:         "00000000-0000-0000-0001-000000000035",
			blockType:  "heading",
			content:    `[{"type":"text","text":"🎨 页面装饰","styles":{}}]`,
			props:      h2,
			orderIndex: 27,
		},
		{
			id:         "00000000-0000-0000-0001-000000000036",
			blockType:  "paragraph",
			content:    `[{"type":"text","text":"每个页面可以设置封面图和图标，让笔记更有辨识度。","styles":{}}]`,
			props:      p,
			orderIndex: 28,
		},
		{
			id:         "00000000-0000-0000-0001-000000000037",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"点击页面标题上方的「添加封面」按钮，可以选择渐变色或上传图片作为封面。","styles":{}}]`,
			props:      p,
			orderIndex: 29,
		},
		{
			id:         "00000000-0000-0000-0001-000000000038",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"点击页面标题前的图标区域，可以选择 emoji 作为页面图标。","styles":{}}]`,
			props:      p,
			orderIndex: 30,
		},
		{
			id:         "00000000-0000-0000-0001-000000000039",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"封面和图标会在侧边栏和搜索结果中显示，方便快速识别页面。","styles":{}}]`,
			props:      p,
			orderIndex: 31,
		},
		// ── 第五章：并排布局 ──────────────────────────────────────────────────
		{
			id:         "00000000-0000-0000-0001-000000000040",
			blockType:  "heading",
			content:    `[{"type":"text","text":"📐 并排布局","styles":{}}]`,
			props:      h2,
			orderIndex: 32,
		},
		{
			id:         "00000000-0000-0000-0001-000000000041",
			blockType:  "paragraph",
			content:    `[{"type":"text","text":"noteyard 支持将块拖动成左右并排的多列布局。","styles":{}}]`,
			props:      p,
			orderIndex: 33,
		},
		{
			id:         "00000000-0000-0000-0001-000000000042",
			blockType:  "numberedListItem",
			content:    `[{"type":"text","text":"创建两个或多个段落块。","styles":{}}]`,
			props:      p,
			orderIndex: 34,
		},
		{
			id:         "00000000-0000-0000-0001-000000000043",
			blockType:  "numberedListItem",
			content:    `[{"type":"text","text":"拖动其中一个块到另一个块的左侧或右侧边缘，出现蓝色分栏指示线时释放鼠标。","styles":{}}]`,
			props:      p,
			orderIndex: 35,
		},
		{
			id:         "00000000-0000-0000-0001-000000000044",
			blockType:  "numberedListItem",
			content:    `[{"type":"text","text":"两个块会自动合并为左右并排的双列布局。","styles":{}}]`,
			props:      p,
			orderIndex: 36,
		},
		{
			id:         "00000000-0000-0000-0001-000000000045",
			blockType:  "callout",
			content:    `[{"type":"text","text":"可以继续向列中拖入更多块，也可以拖出列来恢复单列排列。","styles":{}}]`,
			props:      `{"icon":"💡"}`,
			orderIndex: 37,
		},
		// ── 第六章：快捷键 ────────────────────────────────────────────────────
		{
			id:         "00000000-0000-0000-0001-000000000027",
			blockType:  "heading",
			content:    `[{"type":"text","text":"⌨️ 常用快捷键","styles":{}}]`,
			props:      h2,
			orderIndex: 38,
		},
		{
			id:         "00000000-0000-0000-0001-000000000028",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"⌘K","styles":{"bold":true,"code":true}},{"type":"text","text":" — 全局搜索页面","styles":{}}]`,
			props:      p,
			orderIndex: 39,
		},
		{
			id:         "00000000-0000-0000-0001-000000000029",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"/","styles":{"bold":true,"code":true}},{"type":"text","text":" — 打开块插入菜单","styles":{}}]`,
			props:      p,
			orderIndex: 40,
		},
		{
			id:         "00000000-0000-0000-0001-000000000030",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"⌘Z / ⌘⇧Z","styles":{"bold":true,"code":true}},{"type":"text","text":" — 撤销 / 重做","styles":{}}]`,
			props:      p,
			orderIndex: 41,
		},
		{
			id:         "00000000-0000-0000-0001-000000000031",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"Tab / ⇧Tab","styles":{"bold":true,"code":true}},{"type":"text","text":" — 列表缩进 / 取消缩进","styles":{}}]`,
			props:      p,
			orderIndex: 42,
		},
		{
			id:         "00000000-0000-0000-0001-000000000032",
			blockType:  "bulletListItem",
			content:    `[{"type":"text","text":"Enter","styles":{"bold":true,"code":true}},{"type":"text","text":" — 新建块；","styles":{}},{"type":"text","text":"⇧Enter","styles":{"bold":true,"code":true}},{"type":"text","text":" — 块内换行","styles":{}}]`,
			props:      p,
			orderIndex: 43,
		},
		// ── 尾注 ──────────────────────────────────────────────────────────────
		{
			id:         "00000000-0000-0000-0001-000000000033",
			blockType:  "horizontalRule",
			content:    `[]`,
			props:      `{}`,
			orderIndex: 44,
		},
		{
			id:         "00000000-0000-0000-0001-000000000034",
			blockType:  "quote",
			content:    `[{"type":"text","text":"这是你的起点，也是你的空白画布。删掉这个页面，或者就从这里开始写第一篇笔记吧。","styles":{"italic":true}}]`,
			props:      p,
			orderIndex: 45,
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

// cleanWelcomeBlocks removes any stale/duplicate blocks on the welcome page
// and re-inserts the canonical seed blocks. This fixes installations where
// BlockNote saved its initial empty state before content was loaded.
func cleanWelcomeBlocks(tx *sql.Tx) error {
	const pageID = "00000000-0000-0000-0000-000000000001"
	// Only clean if the welcome page exists
	var count int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM pages WHERE id = ?`, pageID).Scan(&count); err != nil {
		return fmt.Errorf("clean welcome blocks: check page: %w", err)
	}
	if count == 0 {
		return nil
	}
	// Wipe all blocks for the welcome page and re-seed them
	if _, err := tx.Exec(`DELETE FROM blocks WHERE page_id = ?`, pageID); err != nil {
		return fmt.Errorf("clean welcome blocks: delete: %w", err)
	}
	// Re-run the seed insert (reuse WelcomeSeedMigration logic inline)
	now := time.Now().Unix()
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
		{"00000000-0000-0000-0001-000000000001", "heading", `[{"type":"text","text":"欢迎使用 noteyard 👋","styles":{}}]`, `{"level":1,"textColor":"default","backgroundColor":"default","textAlignment":"left"}`, 1},
		{"00000000-0000-0000-0001-000000000002", "callout", `[{"type":"text","text":"noteyard 是一款本地优先的块编辑器笔记应用，数据存储在本机，无需联网。你可以自由组合页面、数据库和各种内容块，构建属于自己的知识体系。","styles":{}}]`, `{"icon":"📝"}`, 2},
		{"00000000-0000-0000-0001-000000000003", "horizontalRule", `[]`, `{}`, 3},
		{"00000000-0000-0000-0001-000000000004", "heading", `[{"type":"text","text":"📄 页面与导航","styles":{}}]`, h2, 4},
		{"00000000-0000-0000-0001-000000000005", "paragraph", `[{"type":"text","text":"noteyard 以页面为基本单位，页面可以无限嵌套，形成树状结构。","styles":{}}]`, p, 5},
		{"00000000-0000-0000-0001-000000000006", "heading", `[{"type":"text","text":"创建与管理页面","styles":{}}]`, h3, 6},
		{"00000000-0000-0000-0001-000000000007", "numberedListItem", `[{"type":"text","text":"点击左侧边栏底部的 ","styles":{}},{"type":"text","text":"「+ 新建页面」","styles":{"bold":true}},{"type":"text","text":" 按钮，创建顶级页面。","styles":{}}]`, p, 7},
		{"00000000-0000-0000-0001-000000000008", "numberedListItem", `[{"type":"text","text":"将鼠标悬停在侧边栏的页面条目上，点击右侧 ","styles":{}},{"type":"text","text":"「+」","styles":{"bold":true}},{"type":"text","text":" 可在该页面下创建子页面。","styles":{}}]`, p, 8},
		{"00000000-0000-0000-0001-000000000009", "numberedListItem", `[{"type":"text","text":"拖动侧边栏条目可以调整页面的层级与顺序。","styles":{}}]`, p, 9},
		{"00000000-0000-0000-0001-000000000010", "numberedListItem", `[{"type":"text","text":"右键点击页面条目可以重命名、设置图标、删除页面。","styles":{}}]`, p, 10},
		{"00000000-0000-0000-0001-000000000011", "callout", `[{"type":"text","text":"顶部搜索栏（⌘K）可以全局搜索所有页面标题，快速跳转。","styles":{}}]`, `{"icon":"🔍"}`, 11},
		{"00000000-0000-0000-0001-000000000012", "heading", `[{"type":"text","text":"✏️ 块编辑器","styles":{}}]`, h2, 12},
		{"00000000-0000-0000-0001-000000000013", "paragraph", `[{"type":"text","text":"noteyard 的编辑器以「块」为单位组织内容。每一段文字、每一个标题、每一张图片都是一个独立的块，可以自由拖拽排序。","styles":{}}]`, p, 13},
		{"00000000-0000-0000-0001-000000000014", "heading", `[{"type":"text","text":"插入块","styles":{}}]`, h3, 14},
		{"00000000-0000-0000-0001-000000000015", "bulletListItem", `[{"type":"text","text":"在任意位置输入 ","styles":{}},{"type":"text","text":"/","styles":{"bold":true}},{"type":"text","text":" 打开块菜单，选择要插入的块类型。","styles":{}}]`, p, 15},
		{"00000000-0000-0000-0001-000000000016", "bulletListItem", `[{"type":"text","text":"块类型包括：标题（H1/H2/H3）、段落、有序列表、无序列表、引用、标注、分割线、代码块、数据库、子页面等。","styles":{}}]`, p, 16},
		{"00000000-0000-0000-0001-000000000017", "bulletListItem", `[{"type":"text","text":"每个块左侧有 ","styles":{}},{"type":"text","text":"⠿ 拖拽手柄","styles":{"bold":true}},{"type":"text","text":"，鼠标悬停后可拖动调整顺序，点击可以进行删除、复制、转换块类型等操作。","styles":{}}]`, p, 17},
		{"00000000-0000-0000-0001-000000000018", "heading", `[{"type":"text","text":"文字格式化","styles":{}}]`, h3, 18},
		{"00000000-0000-0000-0001-000000000019", "bulletListItem", `[{"type":"text","text":"选中文字后会弹出格式工具栏，支持 ","styles":{}},{"type":"text","text":"加粗","styles":{"bold":true}},{"type":"text","text":"、","styles":{}},{"type":"text","text":"斜体","styles":{"italic":true}},{"type":"text","text":"、","styles":{}},{"type":"text","text":"下划线","styles":{"underline":true}},{"type":"text","text":"、","styles":{}},{"type":"text","text":"删除线","styles":{"strike":true}},{"type":"text","text":"、设置文字颜色与背景色。","styles":{}}]`, p, 19},
		{"00000000-0000-0000-0001-000000000020", "bulletListItem", "[{\"type\":\"text\",\"text\":\"也可以直接用 Markdown 快捷语法：\",\"styles\":{}},{\"type\":\"text\",\"text\":\"**粗体**  *斜体*  ~~删除线~~  `代码`\",\"styles\":{\"code\":true}}]", p, 20},
		{"00000000-0000-0000-0001-000000000021", "heading", `[{"type":"text","text":"🗃️ 数据库","styles":{}}]`, h2, 21},
		{"00000000-0000-0000-0001-000000000022", "paragraph", `[{"type":"text","text":"数据库块可以将结构化数据嵌入到任意页面中，适合管理任务、书单、项目等有规律的信息。","styles":{}}]`, p, 22},
		{"00000000-0000-0000-0001-000000000023", "numberedListItem", `[{"type":"text","text":"在编辑区输入 ","styles":{}},{"type":"text","text":"/","styles":{"bold":true}},{"type":"text","text":" 选择「数据库」，即可在当前页面内嵌入一个表格。","styles":{}}]`, p, 23},
		{"00000000-0000-0000-0001-000000000024", "numberedListItem", `[{"type":"text","text":"点击列标题可以修改字段名称；点击 ","styles":{}},{"type":"text","text":"「+ 添加列」","styles":{"bold":true}},{"type":"text","text":" 新增字段，支持文本、数字、日期、勾选框、选项等类型。","styles":{}}]`, p, 24},
		{"00000000-0000-0000-0001-000000000025", "numberedListItem", `[{"type":"text","text":"点击底部 ","styles":{}},{"type":"text","text":"「+ 新建行」","styles":{"bold":true}},{"type":"text","text":" 添加数据行，直接在单元格内编辑内容。","styles":{}}]`, p, 25},
		{"00000000-0000-0000-0001-000000000026", "callout", `[{"type":"text","text":"数据库的数据与页面内容一样保存在本地数据库中，重启后依然存在。","styles":{}}]`, `{"icon":"💾"}`, 26},
		{"00000000-0000-0000-0001-000000000035", "heading", `[{"type":"text","text":"🎨 页面装饰","styles":{}}]`, h2, 27},
		{"00000000-0000-0000-0001-000000000036", "paragraph", `[{"type":"text","text":"每个页面可以设置封面图和图标，让笔记更有辨识度。","styles":{}}]`, p, 28},
		{"00000000-0000-0000-0001-000000000037", "bulletListItem", `[{"type":"text","text":"点击页面标题上方的「添加封面」按钮，可以选择渐变色或上传图片作为封面。","styles":{}}]`, p, 29},
		{"00000000-0000-0000-0001-000000000038", "bulletListItem", `[{"type":"text","text":"点击页面标题前的图标区域，可以选择 emoji 作为页面图标。","styles":{}}]`, p, 30},
		{"00000000-0000-0000-0001-000000000039", "bulletListItem", `[{"type":"text","text":"封面和图标会在侧边栏和搜索结果中显示，方便快速识别页面。","styles":{}}]`, p, 31},
		{"00000000-0000-0000-0001-000000000040", "heading", `[{"type":"text","text":"📐 并排布局","styles":{}}]`, h2, 32},
		{"00000000-0000-0000-0001-000000000041", "paragraph", `[{"type":"text","text":"noteyard 支持将块拖动成左右并排的多列布局。","styles":{}}]`, p, 33},
		{"00000000-0000-0000-0001-000000000042", "numberedListItem", `[{"type":"text","text":"创建两个或多个段落块。","styles":{}}]`, p, 34},
		{"00000000-0000-0000-0001-000000000043", "numberedListItem", `[{"type":"text","text":"拖动其中一个块到另一个块的左侧或右侧边缘，出现蓝色分栏指示线时释放鼠标。","styles":{}}]`, p, 35},
		{"00000000-0000-0000-0001-000000000044", "numberedListItem", `[{"type":"text","text":"两个块会自动合并为左右并排的双列布局。","styles":{}}]`, p, 36},
		{"00000000-0000-0000-0001-000000000045", "callout", `[{"type":"text","text":"可以继续向列中拖入更多块，也可以拖出列来恢复单列排列。","styles":{}}]`, `{"icon":"💡"}`, 37},
		{"00000000-0000-0000-0001-000000000027", "heading", `[{"type":"text","text":"⌨️ 常用快捷键","styles":{}}]`, h2, 38},
		{"00000000-0000-0000-0001-000000000028", "bulletListItem", `[{"type":"text","text":"⌘K","styles":{"bold":true,"code":true}},{"type":"text","text":" — 全局搜索页面","styles":{}}]`, p, 39},
		{"00000000-0000-0000-0001-000000000029", "bulletListItem", `[{"type":"text","text":"/","styles":{"bold":true,"code":true}},{"type":"text","text":" — 打开块插入菜单","styles":{}}]`, p, 40},
		{"00000000-0000-0000-0001-000000000030", "bulletListItem", `[{"type":"text","text":"⌘Z / ⌘⇧Z","styles":{"bold":true,"code":true}},{"type":"text","text":" — 撤销 / 重做","styles":{}}]`, p, 41},
		{"00000000-0000-0000-0001-000000000031", "bulletListItem", `[{"type":"text","text":"Tab / ⇧Tab","styles":{"bold":true,"code":true}},{"type":"text","text":" — 列表缩进 / 取消缩进","styles":{}}]`, p, 42},
		{"00000000-0000-0000-0001-000000000032", "bulletListItem", `[{"type":"text","text":"Enter","styles":{"bold":true,"code":true}},{"type":"text","text":" — 新建块；","styles":{}},{"type":"text","text":"⇧Enter","styles":{"bold":true,"code":true}},{"type":"text","text":" — 块内换行","styles":{}}]`, p, 43},
		{"00000000-0000-0000-0001-000000000033", "horizontalRule", `[]`, `{}`, 44},
		{"00000000-0000-0000-0001-000000000034", "quote", `[{"type":"text","text":"这是你的起点，也是你的空白画布。删掉这个页面，或者就从这里开始写第一篇笔记吧。","styles":{"italic":true}}]`, p, 45},
	}
	for _, b := range blocks {
		_, err := tx.Exec(
			`INSERT INTO blocks(id, page_id, parent_block_id, type, content, content_version, props, order_index, created_at, updated_at)
			 VALUES(?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
			b.id, pageID, b.blockType, b.content, CurrentContentVersion, b.props, b.orderIndex, now, now,
		)
		if err != nil {
			return fmt.Errorf("clean welcome blocks: insert %s: %w", b.id, err)
		}
	}
	return nil
}

// welcomeSeedV4 is migration v4: insert the welcome page from the embedded
// welcome.json seed file. Idempotent — skipped if the page already exists.
func welcomeSeedV4(tx *sql.Tx) error {
	page, blocks, err := seeds.ParseSeed(seeds.WelcomeJSON)
	if err != nil {
		return fmt.Errorf("welcome seed v4: parse seed: %w", err)
	}
	return seeds.ApplySeed(tx, page, blocks)
}

// fts5Migration creates FTS5 virtual tables for full-text search on pages and
// blocks, installs triggers to keep the indexes in sync, and performs an
// initial bulk-fill of any existing rows.
func fts5Migration(tx *sql.Tx) error {
	stmts := []string{
		// Virtual tables (external content mode)
		`CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  title,
  content='pages',
  content_rowid='rowid'
)`,
		`CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
  content,
  content='blocks',
  content_rowid='rowid'
)`,
		// pages triggers
		`CREATE TRIGGER pages_fts_insert AFTER INSERT ON pages BEGIN
  INSERT INTO pages_fts(rowid, title) VALUES (new.rowid, new.title);
END`,
		`CREATE TRIGGER pages_fts_update AFTER UPDATE ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, title) VALUES ('delete', old.rowid, old.title);
  INSERT INTO pages_fts(rowid, title) VALUES (new.rowid, new.title);
END`,
		`CREATE TRIGGER pages_fts_delete AFTER DELETE ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, title) VALUES ('delete', old.rowid, old.title);
END`,
		// blocks triggers (text-bearing block types only)
		`CREATE TRIGGER blocks_fts_insert AFTER INSERT ON blocks
WHEN new.type NOT IN ('database','subpage','fileAttach','bookmark','embed','pdf','button','columnList','column')
BEGIN
  INSERT INTO blocks_fts(rowid, content) VALUES (new.rowid, new.content);
END`,
		`CREATE TRIGGER blocks_fts_update AFTER UPDATE ON blocks
WHEN old.type NOT IN ('database','subpage','fileAttach','bookmark','embed','pdf','button','columnList','column')
   OR new.type NOT IN ('database','subpage','fileAttach','bookmark','embed','pdf','button','columnList','column')
BEGIN
  INSERT INTO blocks_fts(blocks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO blocks_fts(rowid, content) VALUES (new.rowid, new.content);
END`,
		`CREATE TRIGGER blocks_fts_delete AFTER DELETE ON blocks
WHEN old.type NOT IN ('database','subpage','fileAttach','bookmark','embed','pdf','button','columnList','column')
BEGIN
  INSERT INTO blocks_fts(blocks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END`,
		// Initial population of existing data
		`INSERT INTO pages_fts(rowid, title) SELECT rowid, title FROM pages`,
		`INSERT INTO blocks_fts(rowid, content) SELECT rowid, content FROM blocks
  WHERE type NOT IN ('database','subpage','fileAttach','bookmark','embed','pdf','button','columnList','column')`,
	}

	for _, s := range stmts {
		if _, err := tx.Exec(s); err != nil {
			return fmt.Errorf("fts5 migration: %w", err)
		}
	}
	return nil
}

func init() {
	Migrations = append(Migrations, Migration{
		Version: 2,
		Up:      WelcomeSeedMigration,
	})
	Migrations = append(Migrations, Migration{
		Version: 3,
		Up:      cleanWelcomeBlocks,
	})
	Migrations = append(Migrations, Migration{
		Version: 4,
		Up:      welcomeSeedV4,
	})
	Migrations = append(Migrations, Migration{
		Version: 5,
		Up:      fts5Migration,
	})
}
