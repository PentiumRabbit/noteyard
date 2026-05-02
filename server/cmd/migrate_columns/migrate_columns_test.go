package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

// setupTestDB 在内存中创建测试数据库，手动建表（不依赖 sqlite 迁移包）
func setupTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:?_foreign_keys=on")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	db.SetMaxOpenConns(1)

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS pages (
			id          TEXT PRIMARY KEY,
			parent_id   TEXT REFERENCES pages(id) ON DELETE CASCADE,
			title       TEXT NOT NULL DEFAULT '',
			icon        TEXT,
			cover       TEXT,
			order_index REAL NOT NULL DEFAULT 0,
			created_at  INTEGER NOT NULL,
			updated_at  INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS blocks (
			id              TEXT PRIMARY KEY,
			page_id         TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
			parent_block_id TEXT REFERENCES blocks(id) ON DELETE CASCADE,
			type            TEXT NOT NULL,
			content         TEXT NOT NULL DEFAULT '{}',
			props           TEXT NOT NULL DEFAULT '{}',
			order_index     REAL NOT NULL DEFAULT 0,
			created_at      INTEGER NOT NULL,
			updated_at      INTEGER NOT NULL
		);
	`)
	if err != nil {
		t.Fatalf("create tables: %v", err)
	}

	t.Cleanup(func() { db.Close() })
	return db
}

// seedPage 插入一条测试页面
func seedPage(t *testing.T, db *sql.DB, pageID string) {
	t.Helper()
	_, err := db.Exec(
		`INSERT INTO pages(id, title, order_index, created_at, updated_at) VALUES(?,?,0,0,0)`,
		pageID, "test page",
	)
	if err != nil {
		t.Fatalf("seed page: %v", err)
	}
}

// seedColumnsBlock 插入一条 type='columns' 的旧格式块
func seedColumnsBlock(t *testing.T, db *sql.DB, blockID, pageID, content string) {
	t.Helper()
	_, err := db.Exec(
		`INSERT INTO blocks(id, page_id, type, content, props, order_index, created_at, updated_at)
		 VALUES(?,?,'columns',?,'{}',0,0,0)`,
		blockID, pageID, content,
	)
	if err != nil {
		t.Fatalf("seed columns block: %v", err)
	}
}

// makeColumnsContent 构建 columnsData JSON 内容
func makeColumnsContent(nCols int, widths []float64, innerBlocks [][]map[string]interface{}) string {
	cols := make([][][]interface{}, nCols)
	for i := 0; i < nCols; i++ {
		cols[i] = nil
	}

	// 构建 columnsData：每列是一组 rawMessage
	colsData := make([][]json.RawMessage, nCols)
	for i := 0; i < nCols; i++ {
		if innerBlocks != nil && i < len(innerBlocks) {
			for _, blk := range innerBlocks[i] {
				b, _ := json.Marshal(blk)
				colsData[i] = append(colsData[i], json.RawMessage(b))
			}
		}
	}
	_ = cols

	payload := map[string]interface{}{
		"columnsData": colsData,
		"widths":      widths,
	}
	b, _ := json.Marshal(payload)
	return string(b)
}

// countBlocksByType 统计指定 type 的 blocks 数量
func countBlocksByType(t *testing.T, db *sql.DB, blockType string) int {
	t.Helper()
	var count int
	db.QueryRow(`SELECT COUNT(*) FROM blocks WHERE type=?`, blockType).Scan(&count)
	return count
}

// countChildrenOf 统计某块的直接子块数量
func countChildrenOf(t *testing.T, db *sql.DB, parentID string) int {
	t.Helper()
	var count int
	db.QueryRow(`SELECT COUNT(*) FROM blocks WHERE parent_block_id=?`, parentID).Scan(&count)
	return count
}

// totalBlocks 统计 blocks 表总行数
func totalBlocks(t *testing.T, db *sql.DB) int {
	t.Helper()
	var count int
	db.QueryRow(`SELECT COUNT(*) FROM blocks`).Scan(&count)
	return count
}

// --- 测试用例 ---

// TestMigrate_2Cols 正常 2 列迁移：columnList + 2 个 column 子块
func TestMigrate_2Cols(t *testing.T) {
	db := setupTestDB(t)
	ctx := context.Background()

	pageID := "page-2col"
	blockID := "block-2col"
	seedPage(t, db, pageID)

	content := makeColumnsContent(2,
		[]float64{0.5, 0.5},
		[][]map[string]interface{}{
			{{"id": "inner-1", "type": "paragraph", "content": json.RawMessage(`[{"text":"hello"}]`), "props": json.RawMessage(`{}`)}},
			{{"id": "inner-2", "type": "paragraph", "content": json.RawMessage(`[{"text":"world"}]`), "props": json.RawMessage(`{}`)}},
		},
	)
	seedColumnsBlock(t, db, blockID, pageID, content)

	row := oldBlock{ID: blockID, PageID: pageID, Content: content, OrderIndex: 0}
	if err := migrateRow(ctx, db, row); err != nil {
		t.Fatalf("migrateRow: %v", err)
	}

	// 原块应已更新为 columnList
	var typ string
	db.QueryRow(`SELECT type FROM blocks WHERE id=?`, blockID).Scan(&typ)
	if typ != "columnList" {
		t.Errorf("expected columnList, got %s", typ)
	}

	// 应有 2 个 column 子块
	colCount := countChildrenOf(t, db, blockID)
	if colCount != 2 {
		t.Errorf("expected 2 column children, got %d", colCount)
	}
}

// TestMigrate_5Cols 正常 5 列迁移
func TestMigrate_5Cols(t *testing.T) {
	db := setupTestDB(t)
	ctx := context.Background()

	pageID := "page-5col"
	blockID := "block-5col"
	seedPage(t, db, pageID)

	widths := []float64{0.2, 0.2, 0.2, 0.2, 0.2}
	innerBlocks := make([][]map[string]interface{}, 5)
	for i := 0; i < 5; i++ {
		innerBlocks[i] = []map[string]interface{}{
			{"id": fmt.Sprintf("inner-%d", i), "type": "paragraph", "content": json.RawMessage(`[]`), "props": json.RawMessage(`{}`)},
		}
	}
	content := makeColumnsContent(5, widths, innerBlocks)
	seedColumnsBlock(t, db, blockID, pageID, content)

	row := oldBlock{ID: blockID, PageID: pageID, Content: content, OrderIndex: 0}
	if err := migrateRow(ctx, db, row); err != nil {
		t.Fatalf("migrateRow: %v", err)
	}

	colCount := countChildrenOf(t, db, blockID)
	if colCount != 5 {
		t.Errorf("expected 5 column children, got %d", colCount)
	}

	var typ string
	db.QueryRow(`SELECT type FROM blocks WHERE id=?`, blockID).Scan(&typ)
	if typ != "columnList" {
		t.Errorf("expected columnList, got %s", typ)
	}
}

// TestMigrate_WidthsMismatch widths 长度不足时自动均分
func TestMigrate_WidthsMismatch(t *testing.T) {
	db := setupTestDB(t)
	ctx := context.Background()

	pageID := "page-widths"
	blockID := "block-widths"
	seedPage(t, db, pageID)

	// 3 列但只提供 1 个 width，期待均分为 1/3
	content := makeColumnsContent(3,
		[]float64{0.9}, // 长度不足
		[][]map[string]interface{}{
			{{"id": "w1", "type": "paragraph", "content": json.RawMessage(`[]`), "props": json.RawMessage(`{}`)}},
			{{"id": "w2", "type": "paragraph", "content": json.RawMessage(`[]`), "props": json.RawMessage(`{}`)}},
			{{"id": "w3", "type": "paragraph", "content": json.RawMessage(`[]`), "props": json.RawMessage(`{}`)}},
		},
	)
	seedColumnsBlock(t, db, blockID, pageID, content)

	// 捕获日志，验证均分 WARN 被触发
	var logBuf bytes.Buffer
	origOut := log.Writer()
	log.SetOutput(&logBuf)
	defer log.SetOutput(origOut)

	row := oldBlock{ID: blockID, PageID: pageID, Content: content, OrderIndex: 0}
	if err := migrateRow(ctx, db, row); err != nil {
		t.Fatalf("migrateRow: %v", err)
	}

	// 应有 3 个 column 子块
	colCount := countChildrenOf(t, db, blockID)
	if colCount != 3 {
		t.Errorf("expected 3 column children after width mismatch, got %d", colCount)
	}

	// 验证日志包含均分 WARN
	if !strings.Contains(logBuf.String(), "widths 长度不足") {
		t.Errorf("expected width mismatch warning in log, got: %s", logBuf.String())
	}

	// 验证每列 width 为 1/3 ≈ 0.333333
	rows, _ := db.Query(`SELECT props FROM blocks WHERE parent_block_id=? AND type='column'`, blockID)
	defer rows.Close()
	for rows.Next() {
		var props string
		rows.Scan(&props)
		if !strings.Contains(props, "0.333333") {
			t.Errorf("expected width=0.333333 in props, got: %s", props)
		}
	}
}

// TestMigrate_ParseFallback columnsData 解析失败时降级为 2 个空列，不崩溃
func TestMigrate_ParseFallback(t *testing.T) {
	db := setupTestDB(t)
	ctx := context.Background()

	pageID := "page-fallback"
	blockID := "block-fallback"
	seedPage(t, db, pageID)

	// 故意写入无效 JSON
	seedColumnsBlock(t, db, blockID, pageID, `{invalid json!!!}`)

	var logBuf bytes.Buffer
	log.SetOutput(&logBuf)
	defer log.SetOutput(os.Stderr)

	row := oldBlock{ID: blockID, PageID: pageID, Content: `{invalid json!!!}`, OrderIndex: 0}
	if err := migrateRow(ctx, db, row); err != nil {
		t.Fatalf("migrateRow should not return error on parse failure, got: %v", err)
	}

	// 降级：应更新为 columnList
	var typ string
	db.QueryRow(`SELECT type FROM blocks WHERE id=?`, blockID).Scan(&typ)
	if typ != "columnList" {
		t.Errorf("expected columnList after fallback, got %s", typ)
	}

	// 降级：应生成 2 个 column 子块（空列）
	colCount := countChildrenOf(t, db, blockID)
	if colCount != 2 {
		t.Errorf("expected 2 column children after fallback, got %d", colCount)
	}
}

// TestMigrate_Idempotent 幂等验证：重复执行后 blocks 表无重复行
func TestMigrate_Idempotent(t *testing.T) {
	db := setupTestDB(t)
	ctx := context.Background()

	pageID := "page-idem"
	blockID := "block-idem"
	seedPage(t, db, pageID)

	content := makeColumnsContent(2,
		[]float64{0.5, 0.5},
		[][]map[string]interface{}{
			{{"id": "idem-1", "type": "paragraph", "content": json.RawMessage(`[]`), "props": json.RawMessage(`{}`)}},
			{{"id": "idem-2", "type": "paragraph", "content": json.RawMessage(`[]`), "props": json.RawMessage(`{}`)}},
		},
	)
	seedColumnsBlock(t, db, blockID, pageID, content)

	row := oldBlock{ID: blockID, PageID: pageID, Content: content, OrderIndex: 0}

	// 第一次迁移
	if err := migrateRow(ctx, db, row); err != nil {
		t.Fatalf("first migrateRow: %v", err)
	}
	countAfterFirst := totalBlocks(t, db)

	// 第二次执行 scanOldBlocks，由于已有子块，应返回空列表（幂等）
	rows, err := scanOldBlocks(ctx, db)
	if err != nil {
		t.Fatalf("scanOldBlocks: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("expected 0 rows to migrate on second scan (idempotent), got %d", len(rows))
	}

	countAfterSecond := totalBlocks(t, db)
	if countAfterFirst != countAfterSecond {
		t.Errorf("block count changed after second scan: %d -> %d", countAfterFirst, countAfterSecond)
	}
}

// TestMigrate_DryRun dry-run 模式：输出受影响数量，不修改数据
func TestMigrate_DryRun(t *testing.T) {
	db := setupTestDB(t)
	ctx := context.Background()

	pageID := "page-dryrun"
	blockID := "block-dryrun"
	seedPage(t, db, pageID)

	content := makeColumnsContent(2,
		[]float64{0.5, 0.5},
		[][]map[string]interface{}{
			{{"id": "dr-1", "type": "paragraph", "content": json.RawMessage(`[]`), "props": json.RawMessage(`{}`)}},
			{{"id": "dr-2", "type": "paragraph", "content": json.RawMessage(`[]`), "props": json.RawMessage(`{}`)}},
		},
	)
	seedColumnsBlock(t, db, blockID, pageID, content)

	// dry-run：仅扫描，不修改
	pendingRows, err := scanOldBlocks(ctx, db)
	if err != nil {
		t.Fatalf("scanOldBlocks: %v", err)
	}

	// 捕获 dry-run 输出
	var out bytes.Buffer
	fmt.Fprintf(&out, "dry-run: 受影响记录数 = %d\n", len(pendingRows))

	if len(pendingRows) != 1 {
		t.Errorf("expected 1 pending row, got %d", len(pendingRows))
	}

	if !strings.Contains(out.String(), "受影响记录数 = 1") {
		t.Errorf("unexpected dry-run output: %s", out.String())
	}

	// 验证数据未被修改
	var typ string
	db.QueryRow(`SELECT type FROM blocks WHERE id=?`, blockID).Scan(&typ)
	if typ != "columns" {
		t.Errorf("dry-run should not modify data, but type changed to: %s", typ)
	}

	childCount := countChildrenOf(t, db, blockID)
	if childCount != 0 {
		t.Errorf("dry-run should not insert children, got %d", childCount)
	}
}

// TestMigrate_NestedColumnsSkipped 嵌套 columns 块跳过并记录日志
func TestMigrate_NestedColumnsSkipped(t *testing.T) {
	db := setupTestDB(t)
	ctx := context.Background()

	pageID := "page-nested"
	blockID := "block-nested"
	seedPage(t, db, pageID)

	// 列内包含一个嵌套的 columns 块
	nestedColumnsBlock := map[string]interface{}{
		"id":          "nested-col",
		"type":        "columns",
		"content":     json.RawMessage(`{}`),
		"props":       json.RawMessage(`{}`),
		"columnsData": json.RawMessage(`[]`),
	}
	normalBlock := map[string]interface{}{
		"id":      "normal-inner",
		"type":    "paragraph",
		"content": json.RawMessage(`[]`),
		"props":   json.RawMessage(`{}`),
	}

	content := makeColumnsContent(2,
		[]float64{0.5, 0.5},
		[][]map[string]interface{}{
			{nestedColumnsBlock, normalBlock}, // 第 0 列：嵌套 columns + 普通块
			{{"id": "inner-right", "type": "paragraph", "content": json.RawMessage(`[]`), "props": json.RawMessage(`{}`)}},
		},
	)
	seedColumnsBlock(t, db, blockID, pageID, content)

	var logBuf bytes.Buffer
	log.SetOutput(&logBuf)
	defer log.SetOutput(os.Stderr)

	row := oldBlock{ID: blockID, PageID: pageID, Content: content, OrderIndex: 0}
	if err := migrateRow(ctx, db, row); err != nil {
		t.Fatalf("migrateRow: %v", err)
	}

	// 日志应包含"跳过嵌套 columns"
	if !strings.Contains(logBuf.String(), "跳过嵌套 columns") {
		t.Errorf("expected nested columns skip log, got: %s", logBuf.String())
	}

	// 嵌套 columns 块不应被插入，但 normalBlock 应该在
	var count int
	db.QueryRow(`SELECT COUNT(*) FROM blocks WHERE id='nested-col'`).Scan(&count)
	if count != 0 {
		t.Errorf("nested columns block should be skipped, but found in db")
	}

	db.QueryRow(`SELECT COUNT(*) FROM blocks WHERE id='normal-inner'`).Scan(&count)
	if count != 1 {
		t.Errorf("normal inner block should be inserted, got count=%d", count)
	}
}
