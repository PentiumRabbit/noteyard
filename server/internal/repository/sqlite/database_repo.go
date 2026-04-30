package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"noteyard/server/internal/model"
	"regexp"
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
		`INSERT INTO database_rows(id,database_id,order_index,created_at,updated_at) VALUES(?,?,?,?,?)`,
		row.ID, row.DatabaseID, row.OrderIndex, now, now)
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
		`SELECT id,database_id,order_index,created_at,updated_at FROM database_rows
		 WHERE database_id=? ORDER BY order_index`, dbID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*model.DBRow
	for rows.Next() {
		row := &model.DBRow{}
		if err := rows.Scan(&row.ID, &row.DatabaseID, &row.OrderIndex,
			&row.CreatedAt, &row.UpdatedAt); err != nil {
			return nil, err
		}
		row.Cells = make(map[string]string)
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for _, row := range result {
		cells, err := r.db.QueryContext(ctx,
			`SELECT column_id,value FROM database_cells WHERE row_id=?`, row.ID)
		if err != nil {
			return nil, err
		}
		for cells.Next() {
			var colID, val string
			if err := cells.Scan(&colID, &val); err != nil {
				cells.Close()
				return nil, err
			}
			row.Cells[colID] = val
		}
		cells.Close()

		// 计算 formula 列
		for _, col := range cols {
			if col.Type != "formula" {
				continue
			}
			row.Cells[col.ID] = evalFormula(col.Formula, row.Cells, colByName)
		}
	}
	return result, nil
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
