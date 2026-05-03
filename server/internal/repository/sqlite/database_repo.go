package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"noteyard/server/internal/model"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

type DatabaseRepo struct{ db *sql.DB }

func NewDatabaseRepo(db *sql.DB) *DatabaseRepo { return &DatabaseRepo{db: db} }

func (r *DatabaseRepo) Create(ctx context.Context, db *model.Database) error {
	if db.ID == "" {
		db.ID = uuid.NewString()
	}
	now := time.Now().Unix()
	db.CreatedAt = now
	db.UpdatedAt = now
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO databases(id,page_id,title,created_at,updated_at) VALUES(?,?,?,?,?)`,
		db.ID, db.PageID, db.Title, now, now)
	return err
}

func (r *DatabaseRepo) GetByID(ctx context.Context, id string) (*model.Database, error) {
	db := &model.Database{}
	err := r.db.QueryRowContext(ctx,
		`SELECT id,page_id,title,created_at,updated_at FROM databases WHERE id=?`, id,
	).Scan(&db.ID, &db.PageID, &db.Title, &db.CreatedAt, &db.UpdatedAt)
	if err != nil {
		return nil, err
	}
	cols, err := r.listColumns(ctx, id)
	if err != nil {
		return nil, err
	}
	db.Columns = cols
	return db, nil
}

func (r *DatabaseRepo) UpdateTitle(ctx context.Context, id, title string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE databases SET title=?,updated_at=? WHERE id=?`,
		title, time.Now().Unix(), id)
	return err
}

func (r *DatabaseRepo) Delete(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM databases WHERE id=?`, id)
	return err
}

func (r *DatabaseRepo) listColumns(ctx context.Context, dbID string) ([]*model.DBColumn, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id,database_id,name,type,options,formula,is_hidden,order_index,created_at,updated_at
		 FROM database_columns WHERE database_id=? ORDER BY order_index`, dbID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols := make([]*model.DBColumn, 0)
	for rows.Next() {
		c := &model.DBColumn{}
		var isHidden int
		if err := rows.Scan(&c.ID, &c.DatabaseID, &c.Name, &c.Type, &c.Options, &c.Formula,
			&isHidden, &c.OrderIndex, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		c.IsHidden = isHidden != 0
		cols = append(cols, c)
	}
	return cols, rows.Err()
}

func (r *DatabaseRepo) AddColumn(ctx context.Context, col *model.DBColumn) error {
	if col.ID == "" {
		col.ID = uuid.NewString()
	}
	if col.Type == "formula" {
		if err := r.checkFormulaLoop(ctx, col.DatabaseID, col.ID, col.Name, col.Formula); err != nil {
			return err
		}
	}
	now := time.Now().Unix()
	col.CreatedAt = now
	col.UpdatedAt = now
	isHidden := 0
	if col.IsHidden {
		isHidden = 1
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO database_columns(id,database_id,name,type,options,formula,is_hidden,order_index,created_at,updated_at)
		 VALUES(?,?,?,?,?,?,?,?,?,?)`,
		col.ID, col.DatabaseID, col.Name, col.Type, col.Options, col.Formula,
		isHidden, col.OrderIndex, now, now)
	return err
}

func (r *DatabaseRepo) UpdateColumn(ctx context.Context, col *model.DBColumn) error {
	if col.Type == "formula" {
		if err := r.checkFormulaLoop(ctx, col.DatabaseID, col.ID, col.Name, col.Formula); err != nil {
			return err
		}
	}
	col.UpdatedAt = time.Now().Unix()
	isHidden := 0
	if col.IsHidden {
		isHidden = 1
	}
	_, err := r.db.ExecContext(ctx,
		`UPDATE database_columns SET name=?,type=?,options=?,formula=?,is_hidden=?,order_index=?,updated_at=? WHERE id=?`,
		col.Name, col.Type, col.Options, col.Formula, isHidden, col.OrderIndex, col.UpdatedAt, col.ID)
	return err
}

func (r *DatabaseRepo) DeleteColumn(ctx context.Context, colID string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM database_columns WHERE id=?`, colID)
	return err
}

func (r *DatabaseRepo) AddRow(ctx context.Context, row *model.DBRow) error {
	if row.ID == "" {
		row.ID = uuid.NewString()
	}
	now := time.Now().Unix()
	row.CreatedAt = now
	row.UpdatedAt = now
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO database_rows(id,database_id,content,order_index,created_at,updated_at) VALUES(?,?,?,?,?,?)`,
		row.ID, row.DatabaseID, row.Content, row.OrderIndex, now, now)
	return err
}

func (r *DatabaseRepo) UpdateRow(ctx context.Context, row *model.DBRow) error {
	row.UpdatedAt = time.Now().Unix()
	_, err := r.db.ExecContext(ctx,
		`UPDATE database_rows SET content=?,updated_at=? WHERE id=? AND database_id=?`,
		row.Content, row.UpdatedAt, row.ID, row.DatabaseID)
	return err
}

func (r *DatabaseRepo) DeleteRow(ctx context.Context, rowID string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM database_rows WHERE id=?`, rowID)
	return err
}

func (r *DatabaseRepo) ListRows(ctx context.Context, dbID string) ([]*model.DBRow, error) {
	cols, err := r.listColumns(ctx, dbID)
	if err != nil {
		return nil, err
	}
	colByID := make(map[string]*model.DBColumn, len(cols))
	colByName := make(map[string]*model.DBColumn, len(cols))
	for _, c := range cols {
		colByID[c.ID] = c
		colByName[c.Name] = c
	}

	rows, err := r.db.QueryContext(ctx,
		`SELECT id,database_id,content,order_index,created_at,updated_at FROM database_rows
		 WHERE database_id=? ORDER BY order_index`, dbID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*model.DBRow
	for rows.Next() {
		row := &model.DBRow{}
		if err := rows.Scan(&row.ID, &row.DatabaseID, &row.Content, &row.OrderIndex,
			&row.CreatedAt, &row.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rowIDs := make([]string, 0, len(result))
	for _, row := range result {
		rowIDs = append(rowIDs, row.ID)
	}
	allCells, err := r.batchFetchAllCells(ctx, rowIDs)
	if err != nil {
		return nil, err
	}
	for _, row := range result {
		row.Cells = allCells[row.ID]
		if row.Cells == nil {
			row.Cells = make(map[string]string)
		}
		// 计算 formula 列
		for _, col := range cols {
			if col.Type != "formula" {
				continue
			}
			row.Cells[col.ID] = evalFormula(col.Formula, row.Cells, colByName)
		}
	}

	// 计算 rollup 列
	for _, col := range cols {
		if col.Type != "rollup" {
			continue
		}

		// 解析 options
		var opts struct {
			RelationColumnID string `json:"relation_column_id"`
			TargetColumnID   string `json:"target_column_id"`
			Aggregation      string `json:"aggregation"`
		}
		if err := json.Unmarshal([]byte(col.Options), &opts); err != nil {
			// options 损坏，跳过该列
			continue
		}

		// 检查关联列是否存在
		if _, ok := colByID[opts.RelationColumnID]; !ok {
			// 关联列不存在，结果为空字符串
			for _, row := range result {
				row.Cells[col.ID] = ""
			}
			continue
		}

		// 收集所有关联 rowID（去重）
		allRelatedIDs := make(map[string]struct{})
		// 记录每行对应的关联 rowID 列表
		rowRelated := make(map[string][]string, len(result))
		for _, row := range result {
			cellVal := row.Cells[opts.RelationColumnID]
			var ids []string
			if cellVal != "" {
				if err := json.Unmarshal([]byte(cellVal), &ids); err != nil {
					ids = nil
				}
			}
			rowRelated[row.ID] = ids
			for _, id := range ids {
				allRelatedIDs[id] = struct{}{}
			}
		}

		// 批量查询目标列的 cells
		targetCells, err := r.batchFetchCells(ctx, allRelatedIDs, opts.TargetColumnID)
		if err != nil {
			// 查询失败，置空
			for _, row := range result {
				row.Cells[col.ID] = ""
			}
			continue
		}

		// 按 aggregation 计算每行结果
		for _, row := range result {
			ids := rowRelated[row.ID]
			row.Cells[col.ID] = computeRollup(opts.Aggregation, ids, targetCells)
		}
	}

	return result, nil
}

// batchFetchAllCells 批量查询给定 rowIDs 的所有 cell 值。
// 返回 map[rowID]map[colID]value。若 rowIDs 为空，返回空 map。
func (r *DatabaseRepo) batchFetchAllCells(ctx context.Context, rowIDs []string) (map[string]map[string]string, error) {
	result := make(map[string]map[string]string)
	if len(rowIDs) == 0 {
		return result, nil
	}

	placeholders := make([]string, len(rowIDs))
	args := make([]interface{}, len(rowIDs))
	for i, id := range rowIDs {
		placeholders[i] = "?"
		args[i] = id
	}

	query := fmt.Sprintf(
		`SELECT row_id, column_id, value FROM database_cells WHERE row_id IN (%s)`,
		strings.Join(placeholders, ","),
	)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var rowID, colID, val string
		if err := rows.Scan(&rowID, &colID, &val); err != nil {
			return nil, err
		}
		if result[rowID] == nil {
			result[rowID] = make(map[string]string)
		}
		result[rowID][colID] = val
	}
	return result, rows.Err()
}

// batchFetchCells 批量查询给定 rowID 集合中指定 columnID 的 cell 值。
// 返回 map[rowID]value。若 rowID 集合为空或 targetColumnID 为空，返回空 map。
func (r *DatabaseRepo) batchFetchCells(ctx context.Context, rowIDs map[string]struct{}, targetColumnID string) (map[string]string, error) {
	result := make(map[string]string)
	if len(rowIDs) == 0 || targetColumnID == "" {
		return result, nil
	}

	// 构建 IN 子句
	ids := make([]string, 0, len(rowIDs))
	args := make([]interface{}, 0, len(rowIDs)+1)
	for id := range rowIDs {
		ids = append(ids, "?")
		args = append(args, id)
	}
	args = append(args, targetColumnID)

	query := fmt.Sprintf(
		`SELECT row_id, value FROM database_cells WHERE row_id IN (%s) AND column_id=?`,
		strings.Join(ids, ","),
	)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var rowID, val string
		if err := rows.Scan(&rowID, &val); err != nil {
			return nil, err
		}
		result[rowID] = val
	}
	return result, rows.Err()
}

// computeRollup 根据 aggregation 类型，对 relatedIDs 中的行在 targetCells 里取值聚合。
func computeRollup(aggregation string, relatedIDs []string, targetCells map[string]string) string {
	switch aggregation {
	case "count":
		return strconv.Itoa(len(relatedIDs))

	case "count_not_empty":
		n := 0
		for _, id := range relatedIDs {
			if v, ok := targetCells[id]; ok && v != "" {
				n++
			}
		}
		return strconv.Itoa(n)

	case "sum":
		var sum float64
		for _, id := range relatedIDs {
			v, _ := strconv.ParseFloat(targetCells[id], 64)
			sum += v
		}
		return formatFloat(sum)

	case "avg":
		if len(relatedIDs) == 0 {
			return "0"
		}
		var sum float64
		for _, id := range relatedIDs {
			v, _ := strconv.ParseFloat(targetCells[id], 64)
			sum += v
		}
		avg := sum / float64(len(relatedIDs))
		return strconv.FormatFloat(math.Round(avg*100)/100, 'f', 2, 64)

	case "max":
		if len(relatedIDs) == 0 {
			return ""
		}
		max := math.Inf(-1)
		for _, id := range relatedIDs {
			v, _ := strconv.ParseFloat(targetCells[id], 64)
			if v > max {
				max = v
			}
		}
		return formatFloat(max)

	case "min":
		if len(relatedIDs) == 0 {
			return ""
		}
		min := math.Inf(1)
		for _, id := range relatedIDs {
			v, _ := strconv.ParseFloat(targetCells[id], 64)
			if v < min {
				min = v
			}
		}
		return formatFloat(min)

	case "show_original":
		vals := make([]string, 0, len(relatedIDs))
		for _, id := range relatedIDs {
			vals = append(vals, targetCells[id])
		}
		return strings.Join(vals, ",")

	default:
		return ""
	}
}

// formatFloat 将 float64 格式化为字符串：整数去掉小数点，否则保留原始精度。
func formatFloat(v float64) string {
	if v == float64(int64(v)) {
		return strconv.FormatInt(int64(v), 10)
	}
	return strconv.FormatFloat(v, 'f', -1, 64)
}

func (r *DatabaseRepo) GetRow(ctx context.Context, databaseID, rowID string) (*model.DBRow, error) {
	row := &model.DBRow{}
	err := r.db.QueryRowContext(ctx,
		`SELECT id,database_id,content,order_index,created_at,updated_at FROM database_rows WHERE id=? AND database_id=?`,
		rowID, databaseID,
	).Scan(&row.ID, &row.DatabaseID, &row.Content, &row.OrderIndex, &row.CreatedAt, &row.UpdatedAt)
	if err != nil {
		return nil, err
	}

	cols, err := r.listColumns(ctx, databaseID)
	if err != nil {
		return nil, err
	}
	colByName := make(map[string]*model.DBColumn, len(cols))
	for _, c := range cols {
		colByName[c.Name] = c
	}

	row.Cells = make(map[string]string)
	cells, err := r.db.QueryContext(ctx,
		`SELECT column_id,value FROM database_cells WHERE row_id=?`, row.ID)
	if err != nil {
		return nil, err
	}
	defer cells.Close()
	for cells.Next() {
		var colID, val string
		if err := cells.Scan(&colID, &val); err != nil {
			return nil, err
		}
		row.Cells[colID] = val
	}
	if err := cells.Err(); err != nil {
		return nil, err
	}

	for _, col := range cols {
		if col.Type != "formula" {
			continue
		}
		row.Cells[col.ID] = evalFormula(col.Formula, row.Cells, colByName)
	}

	// 计算 rollup 列
	colByID := make(map[string]*model.DBColumn, len(cols))
	for _, c := range cols {
		colByID[c.ID] = c
	}
	for _, col := range cols {
		if col.Type != "rollup" {
			continue
		}

		var opts struct {
			RelationColumnID string `json:"relation_column_id"`
			TargetColumnID   string `json:"target_column_id"`
			Aggregation      string `json:"aggregation"`
		}
		if err := json.Unmarshal([]byte(col.Options), &opts); err != nil {
			row.Cells[col.ID] = ""
			continue
		}

		if _, ok := colByID[opts.RelationColumnID]; !ok {
			row.Cells[col.ID] = ""
			continue
		}

		// 取该行 relation 列的关联行 ID 数组
		cellVal := row.Cells[opts.RelationColumnID]
		var relatedIDs []string
		if cellVal != "" {
			if err := json.Unmarshal([]byte(cellVal), &relatedIDs); err != nil {
				relatedIDs = nil
			}
		}

		// 查询目标列的 cells
		relatedIDSet := make(map[string]struct{}, len(relatedIDs))
		for _, id := range relatedIDs {
			relatedIDSet[id] = struct{}{}
		}
		targetCells, err := r.batchFetchCells(ctx, relatedIDSet, opts.TargetColumnID)
		if err != nil {
			row.Cells[col.ID] = ""
			continue
		}

		row.Cells[col.ID] = computeRollup(opts.Aggregation, relatedIDs, targetCells)
	}

	return row, nil
}

func (r *DatabaseRepo) BatchUpdateCells(ctx context.Context, rowID string, cells []*model.DBCell) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := time.Now().Unix()
	stmt, err := tx.PrepareContext(ctx,
		`INSERT INTO database_cells(row_id,column_id,value,updated_at) VALUES(?,?,?,?)
		 ON CONFLICT(row_id,column_id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, c := range cells {
		if _, err := stmt.ExecContext(ctx, rowID, c.ColumnID, c.Value, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ListAll returns a lightweight summary of all databases ordered by creation time.
func (r *DatabaseRepo) ListAll(ctx context.Context) ([]*model.DatabaseSummary, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, title, page_id FROM databases ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]*model.DatabaseSummary, 0)
	for rows.Next() {
		s := &model.DatabaseSummary{}
		if err := rows.Scan(&s.ID, &s.Name, &s.PageID); err != nil {
			return nil, err
		}
		result = append(result, s)
	}
	return result, rows.Err()
}

// checkFormulaLoop 检测公式列是否形成循环引用（有向图 DFS）
// colName 是当前列的名字，新建时尚未入库，需手动注入以检测自引用
func (r *DatabaseRepo) checkFormulaLoop(ctx context.Context, dbID, colID, colName, formula string) error {
	cols, err := r.listColumns(ctx, dbID)
	if err != nil {
		return err
	}
	colByName := make(map[string]string) // name → id
	formulaOf := make(map[string]string) // id → formula
	for _, c := range cols {
		colByName[c.Name] = c.ID
		formulaOf[c.ID] = c.Formula
	}
	// 注入当前列自身（新建时尚未入库）
	colByName[colName] = colID
	formulaOf[colID] = formula

	refs := extractRefs(formula)
	var dfs func(id string, visited map[string]bool) bool
	dfs = func(id string, visited map[string]bool) bool {
		if visited[id] {
			return true
		}
		visited[id] = true
		for _, ref := range extractRefs(formulaOf[id]) {
			rid, ok := colByName[ref]
			if !ok {
				continue
			}
			if dfs(rid, visited) {
				return true
			}
		}
		return false
	}

	visited := map[string]bool{colID: true}
	for _, ref := range refs {
		rid, ok := colByName[ref]
		if !ok {
			continue
		}
		if dfs(rid, visited) {
			return fmt.Errorf("formula creates circular reference")
		}
	}
	return nil
}

var refRe = regexp.MustCompile(`prop\(["']([^"']+)["']\)`)

func extractRefs(formula string) []string {
	matches := refRe.FindAllStringSubmatch(formula, -1)
	refs := make([]string, 0, len(matches))
	for _, m := range matches {
		refs = append(refs, m[1])
	}
	return refs
}

// evalFormula 计算公式值，prop("列名") 替换为同行对应列的值，支持基础四则运算
func evalFormula(formula string, cells map[string]string, colByName map[string]*model.DBColumn) string {
	expr := refRe.ReplaceAllStringFunc(formula, func(m string) string {
		// 提取 prop("列名") 或 prop('列名') 中的列名
		sub := refRe.FindStringSubmatch(m)
		if len(sub) < 2 {
			return "0"
		}
		name := sub[1]
		col, ok := colByName[name]
		if !ok {
			return "0"
		}
		v, ok := cells[col.ID]
		if !ok {
			return "0"
		}
		return v
	})
	result, err := evalExpr(expr)
	if err != nil {
		return expr
	}
	return result
}
