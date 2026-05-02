// migrate_columns 是一次性数据迁移工具，将 blocks 表中 type='columns' 的旧格式记录
// 迁移为 columnList → column[] → 列内块 的新格式（parent_block_id 树形结构）。
//
// 用法：
//
//	go run ./server/cmd/migrate_columns --db <path>            # dry-run 模式（默认）
//	go run ./server/cmd/migrate_columns --db <path> --dry-run=false  # 正式执行迁移
//	go run ./server/cmd/migrate_columns --db <path> --rollback       # 回滚到备份
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

// oldBlock 表示从数据库读取的旧 columns 记录
type oldBlock struct {
	ID         string
	PageID     string
	Content    string
	OrderIndex float64
}

// oldContent 是 columns 块 content 字段的 JSON 结构
type oldContent struct {
	ColumnsData [][]json.RawMessage `json:"columnsData"`
	Widths      []float64           `json:"widths"`
}

// innerBlock 是列内块的 JSON 结构（与 BlockNote 序列化格式对齐）
type innerBlock struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	Content json.RawMessage `json:"content"`
	Props   json.RawMessage `json:"props"`
	// 嵌套 columns 检测
	ColumnsData json.RawMessage `json:"columnsData,omitempty"`
}

func main() {
	dbPath := flag.String("db", defaultDBPath(), "SQLite 数据库路径")
	dryRun := flag.Bool("dry-run", true, "dry-run 模式：仅输出受影响记录数，不修改数据")
	rollback := flag.Bool("rollback", false, "回滚：从 blocks_migration_backup 恢复旧记录")
	flag.Parse()

	db, err := openDB(*dbPath)
	if err != nil {
		log.Fatalf("[ERROR] 打开数据库失败: %v", err)
	}
	defer db.Close()

	ctx := context.Background()

	if *rollback {
		if err := doRollback(ctx, db); err != nil {
			log.Fatalf("[ERROR] 回滚失败: %v", err)
		}
		log.Println("[INFO] 回滚完成")
		return
	}

	rows, err := scanOldBlocks(ctx, db)
	if err != nil {
		log.Fatalf("[ERROR] 扫描旧记录失败: %v", err)
	}

	log.Printf("[INFO] 发现 %d 条待迁移记录（type=columns，尚未生成子块）", len(rows))

	if *dryRun {
		fmt.Printf("dry-run: 受影响记录数 = %d\n", len(rows))
		os.Exit(0)
	}

	if len(rows) == 0 {
		log.Println("[INFO] 无需迁移，退出")
		return
	}

	// 确保备份表存在（006_migrate_columns.sql 已在迁移时创建，此处幂等补充）
	if err := ensureBackup(ctx, db); err != nil {
		log.Fatalf("[ERROR] 备份失败: %v", err)
	}

	successCount := 0
	for _, row := range rows {
		if err := migrateRow(ctx, db, row); err != nil {
			log.Printf("[ERROR] 迁移记录 %s 失败: %v", row.ID, err)
		} else {
			successCount++
		}
	}

	log.Printf("[INFO] 迁移完成：成功 %d / %d 条", successCount, len(rows))
}

// openDB 打开 SQLite 数据库（不执行 schema 迁移，仅供迁移脚本直连使用）
func openDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path+"?_foreign_keys=on&_journal_mode=WAL")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return db, db.Ping()
}

// scanOldBlocks 扫描所有符合迁移条件的旧记录（幂等：已有子块的跳过）
func scanOldBlocks(ctx context.Context, db *sql.DB) ([]oldBlock, error) {
	q := `
		SELECT id, page_id, content, order_index
		FROM blocks
		WHERE type = 'columns'
		  AND content LIKE '%columnsData%'
		  AND NOT EXISTS (
		    SELECT 1 FROM blocks child WHERE child.parent_block_id = blocks.id
		  )`
	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []oldBlock
	for rows.Next() {
		var b oldBlock
		if err := rows.Scan(&b.ID, &b.PageID, &b.Content, &b.OrderIndex); err != nil {
			return nil, err
		}
		result = append(result, b)
	}
	return result, rows.Err()
}

// ensureBackup 确保备份表包含所有 type='columns' 记录（幂等）
func ensureBackup(ctx context.Context, db *sql.DB) error {
	// 备份表由 006_migrate_columns.sql 在数据库迁移时创建
	// 此处检查是否已存在，防止脱离正常启动流程时直接运行迁移工具
	var count int
	err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='blocks_migration_backup'`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		log.Println("[WARN] 备份表 blocks_migration_backup 不存在，正在创建...")
		_, err = db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS blocks_migration_backup AS SELECT * FROM blocks WHERE type = 'columns'`)
		return err
	}
	return nil
}

// migrateRow 对单条旧 columns 记录执行阶段 2 转换，在独立事务中完成
func migrateRow(ctx context.Context, db *sql.DB, row oldBlock) error {
	var parsed oldContent
	if err := json.Unmarshal([]byte(row.Content), &parsed); err != nil {
		log.Printf("[ERROR] 解析 content 失败 (id=%s): %v — 降级为空列结构", row.ID, err)
		return migrateRowFallback(ctx, db, row, nil, nil)
	}

	columnsData := parsed.ColumnsData
	widths := parsed.Widths

	// widths 长度不足时均分
	colCount := len(columnsData)
	if colCount == 0 {
		log.Printf("[WARN] columns 记录 %s 无列数据，跳过", row.ID)
		return nil
	}
	if len(widths) < colCount {
		defaultWidth := 1.0 / float64(colCount)
		widths = make([]float64, colCount)
		for i := range widths {
			widths[i] = defaultWidth
		}
		log.Printf("[WARN] columns 记录 %s widths 长度不足，已均分为 %.4f", row.ID, defaultWidth)
	}

	return migrateRowFallback(ctx, db, row, columnsData, widths)
}

// migrateRowFallback 执行实际的数据库写入：
// 将 columns 块转为 columnList，并插入 column 子块和列内块。
// columnsData/widths 为 nil 时退化为空列结构。
func migrateRowFallback(ctx context.Context, db *sql.DB, row oldBlock, columnsData [][]json.RawMessage, widths []float64) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now().Unix()

	// 1. 将原 columns 块更新为 columnList
	_, err = tx.ExecContext(ctx,
		`UPDATE blocks SET type='columnList', content='{}', props='{}', updated_at=? WHERE id=?`,
		now, row.ID)
	if err != nil {
		return fmt.Errorf("更新 columnList 失败: %w", err)
	}

	colCount := len(columnsData)
	if colCount == 0 {
		// 降级：至少创建 2 个空列
		colCount = 2
		columnsData = make([][]json.RawMessage, colCount)
		widths = []float64{0.5, 0.5}
	}

	// 2. 为每列插入 column 块及其内部块
	for i := 0; i < colCount; i++ {
		columnID := uuid.NewString()
		widthStr := fmt.Sprintf("%.6f", widths[i])
		propsJSON := fmt.Sprintf(`{"width":"%s"}`, widthStr)

		_, err = tx.ExecContext(ctx,
			`INSERT INTO blocks(id, page_id, parent_block_id, type, content, props, order_index, created_at, updated_at)
			 VALUES(?, ?, ?, 'column', '{}', ?, ?, ?, ?)`,
			columnID, row.PageID, row.ID, propsJSON, float64(i), now, now)
		if err != nil {
			return fmt.Errorf("插入 column[%d] 失败: %w", i, err)
		}

		innerBlocks := columnsData[i]
		if len(innerBlocks) == 0 {
			// 空列：插入一个空 paragraph
			if err := insertEmptyParagraph(ctx, tx, row.PageID, columnID, 0, now); err != nil {
				return fmt.Errorf("插入空 paragraph[%d] 失败: %w", i, err)
			}
			continue
		}

		for j, rawBlock := range innerBlocks {
			var inner innerBlock
			if err := json.Unmarshal(rawBlock, &inner); err != nil {
				log.Printf("[ERROR] 解析列内块失败 (columnList=%s, col=%d, idx=%d): %v — 插入空 paragraph", row.ID, i, j, err)
				if err2 := insertEmptyParagraph(ctx, tx, row.PageID, columnID, float64(j), now); err2 != nil {
					return err2
				}
				continue
			}

			// 跳过嵌套 columns 块
			if inner.Type == "columns" || inner.ColumnsData != nil {
				log.Printf("[WARN] 跳过嵌套 columns 块 (columnList=%s, col=%d, idx=%d, innerID=%s)", row.ID, i, j, inner.ID)
				continue
			}

			// 确保 ID
			if inner.ID == "" {
				inner.ID = uuid.NewString()
			}

			contentJSON := "{}"
			if inner.Content != nil && string(inner.Content) != "null" {
				contentJSON = string(inner.Content)
			}
			propsStr := "{}"
			if inner.Props != nil && string(inner.Props) != "null" {
				propsStr = string(inner.Props)
			}
			blockType := inner.Type
			if blockType == "" {
				blockType = "paragraph"
			}

			_, err = tx.ExecContext(ctx,
				`INSERT INTO blocks(id, page_id, parent_block_id, type, content, props, order_index, created_at, updated_at)
				 VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET
				   type=excluded.type,
				   content=excluded.content,
				   props=excluded.props,
				   order_index=excluded.order_index,
				   parent_block_id=excluded.parent_block_id,
				   updated_at=excluded.updated_at`,
				inner.ID, row.PageID, columnID, blockType, contentJSON, propsStr, float64(j), now, now)
			if err != nil {
				return fmt.Errorf("写入列内块失败 (col=%d, idx=%d): %w", i, j, err)
			}
		}
	}

	return tx.Commit()
}

// insertEmptyParagraph 向指定列插入一个空 paragraph 占位块
func insertEmptyParagraph(ctx context.Context, tx *sql.Tx, pageID, columnID string, orderIndex float64, now int64) error {
	_, err := tx.ExecContext(ctx,
		`INSERT INTO blocks(id, page_id, parent_block_id, type, content, props, order_index, created_at, updated_at)
		 VALUES(?, ?, ?, 'paragraph', '{}', '{}', ?, ?, ?)`,
		uuid.NewString(), pageID, columnID, orderIndex, now, now)
	return err
}

// doRollback 阶段 3：从备份表恢复旧 columns 记录
func doRollback(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 删除已迁移的 columnList/column/子块（通过备份表中的 id 定位原始 columns 记录）
	// 先删除 columnList 的所有子孙块（ON DELETE CASCADE 会级联删除）
	_, err = tx.ExecContext(ctx, `
		DELETE FROM blocks WHERE id IN (
		  SELECT id FROM blocks_migration_backup
		)`)
	if err != nil {
		return fmt.Errorf("删除已迁移记录失败: %w", err)
	}

	// 恢复旧 columns 记录
	_, err = tx.ExecContext(ctx, `INSERT INTO blocks SELECT * FROM blocks_migration_backup`)
	if err != nil {
		return fmt.Errorf("恢复备份记录失败: %w", err)
	}

	// 删除备份表
	_, err = tx.ExecContext(ctx, `DROP TABLE blocks_migration_backup`)
	if err != nil {
		return fmt.Errorf("删除备份表失败: %w", err)
	}

	return tx.Commit()
}

func defaultDBPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "noteyard.db"
	}
	return filepath.Join(home, ".local", "share", "noteyard", "noteyard.db")
}
