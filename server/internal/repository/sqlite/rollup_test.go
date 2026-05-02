package sqlite

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"noteyard/server/internal/model"
)

// ---------------------------------------------------------------------------
// Unit tests for computeRollup
// ---------------------------------------------------------------------------

func TestComputeRollup_Count(t *testing.T) {
	// count: correct count including rows with empty target values
	ids := []string{"r1", "r2", "r3"}
	cells := map[string]string{
		"r1": "hello",
		"r2": "", // empty value row
		"r3": "42",
	}
	got := computeRollup("count", ids, cells)
	if got != "3" {
		t.Errorf("count: got %q, want %q", got, "3")
	}
}

func TestComputeRollup_CountWithEmptyRelated(t *testing.T) {
	// count with zero related IDs returns "0"
	got := computeRollup("count", []string{}, map[string]string{})
	if got != "0" {
		t.Errorf("count empty: got %q, want %q", got, "0")
	}
}

func TestComputeRollup_CountNotEmpty(t *testing.T) {
	// count_not_empty: only count rows whose target cell is non-empty
	ids := []string{"r1", "r2", "r3", "r4"}
	cells := map[string]string{
		"r1": "hello",
		"r2": "", // empty — should not count
		"r3": "world",
		// r4 not in cells — should not count
	}
	got := computeRollup("count_not_empty", ids, cells)
	if got != "2" {
		t.Errorf("count_not_empty: got %q, want %q", got, "2")
	}
}

func TestComputeRollup_Sum(t *testing.T) {
	// sum: numeric sum; non-parseable values treated as 0
	ids := []string{"r1", "r2", "r3"}
	cells := map[string]string{
		"r1": "10",
		"r2": "abc", // cannot parse → 0
		"r3": "5.5",
	}
	got := computeRollup("sum", ids, cells)
	if got != "15.5" {
		t.Errorf("sum: got %q, want %q", got, "15.5")
	}
}

func TestComputeRollup_SumIntegerResult(t *testing.T) {
	// sum of integers returns an integer string (no decimal point)
	ids := []string{"r1", "r2"}
	cells := map[string]string{"r1": "3", "r2": "7"}
	got := computeRollup("sum", ids, cells)
	if got != "10" {
		t.Errorf("sum int: got %q, want %q", got, "10")
	}
}

func TestComputeRollup_Avg(t *testing.T) {
	// avg: average rounded to 2 decimal places
	ids := []string{"r1", "r2", "r3"}
	cells := map[string]string{"r1": "10", "r2": "20", "r3": "15"}
	got := computeRollup("avg", ids, cells)
	if got != "15.00" {
		t.Errorf("avg: got %q, want %q", got, "15.00")
	}
}

func TestComputeRollup_AvgNonInteger(t *testing.T) {
	// avg preserves 2 decimal places even for non-round results
	ids := []string{"r1", "r2", "r3"}
	cells := map[string]string{"r1": "1", "r2": "2", "r3": "3"}
	got := computeRollup("avg", ids, cells)
	// (1+2+3)/3 = 2.00
	if got != "2.00" {
		t.Errorf("avg non-integer: got %q, want %q", got, "2.00")
	}
}

func TestComputeRollup_AvgWithUnparseable(t *testing.T) {
	// avg: non-parseable values treated as 0
	ids := []string{"r1", "r2"}
	cells := map[string]string{"r1": "bad", "r2": "10"}
	got := computeRollup("avg", ids, cells)
	// (0 + 10) / 2 = 5.00
	if got != "5.00" {
		t.Errorf("avg with unparseable: got %q, want %q", got, "5.00")
	}
}

func TestComputeRollup_Max(t *testing.T) {
	ids := []string{"r1", "r2", "r3"}
	cells := map[string]string{"r1": "3", "r2": "7", "r3": "1"}
	got := computeRollup("max", ids, cells)
	if got != "7" {
		t.Errorf("max: got %q, want %q", got, "7")
	}
}

func TestComputeRollup_Min(t *testing.T) {
	ids := []string{"r1", "r2", "r3"}
	cells := map[string]string{"r1": "3", "r2": "7", "r3": "1"}
	got := computeRollup("min", ids, cells)
	if got != "1" {
		t.Errorf("min: got %q, want %q", got, "1")
	}
}

func TestComputeRollup_ShowOriginal(t *testing.T) {
	// show_original: comma-join values in relatedIDs order
	ids := []string{"r1", "r2", "r3"}
	cells := map[string]string{"r1": "apple", "r2": "banana", "r3": "cherry"}
	got := computeRollup("show_original", ids, cells)
	if got != "apple,banana,cherry" {
		t.Errorf("show_original: got %q, want %q", got, "apple,banana,cherry")
	}
}

// ---------------------------------------------------------------------------
// Case 7: empty relatedIDs
// ---------------------------------------------------------------------------

func TestComputeRollup_EmptyRelatedIDs_NumericReturnsZero(t *testing.T) {
	cells := map[string]string{}
	for _, agg := range []string{"sum", "avg"} {
		got := computeRollup(agg, []string{}, cells)
		if got != "0" {
			t.Errorf("%s with empty relatedIDs: got %q, want %q", agg, got, "0")
		}
	}
}

func TestComputeRollup_EmptyRelatedIDs_MaxMinReturnsEmpty(t *testing.T) {
	// max/min with empty relatedIDs returns ""
	for _, agg := range []string{"max", "min"} {
		got := computeRollup(agg, []string{}, map[string]string{})
		if got != "" {
			t.Errorf("%s with empty relatedIDs: got %q, want empty string", agg, got)
		}
	}
}

func TestComputeRollup_EmptyRelatedIDs_ShowOriginalReturnsEmpty(t *testing.T) {
	got := computeRollup("show_original", []string{}, map[string]string{})
	if got != "" {
		t.Errorf("show_original empty relatedIDs: got %q, want empty string", got)
	}
}

// ---------------------------------------------------------------------------
// Integration helpers
// ---------------------------------------------------------------------------

// newTestDatabaseRepo returns a DatabaseRepo backed by an in-memory SQLite DB.
func newTestDatabaseRepo(t *testing.T) *DatabaseRepo {
	t.Helper()
	db, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open in-memory db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return NewDatabaseRepo(db)
}

// seedDatabaseWithFixtures sets up:
//
//	page → block (type=database) → database + columns + rows + cells
//
// It returns the DatabaseRepo, the database ID, the relation column ID, and
// the target column ID so callers can build rollup columns.
type fixtureDB struct {
	repo        *DatabaseRepo
	dbID        string
	relColID    string
	targetColID string
	row1ID      string
	row2ID      string
	// target rows (in the "related" database, simulated via same DB for simplicity)
	targetRow1ID string
	targetRow2ID string
}

// seedMinimalDB creates a bare database with a relation column and target column.
// It returns a fixtureDB. The caller may add rollup columns and rows as needed.
//
// Schema constraints:
//
//	databases.id → blocks(id) → pages(id)
//	database_columns.database_id → databases(id)
//	database_rows.database_id    → databases(id)
//	database_cells.row_id        → database_rows(id)
//	database_cells.column_id     → database_columns(id)
func seedMinimalDB(t *testing.T) *fixtureDB {
	t.Helper()
	repo := newTestDatabaseRepo(t)
	ctx := context.Background()

	now := time.Now().Unix()
	sqlDB := repo.db

	// 1. page
	pageID := "page-1"
	if _, err := sqlDB.ExecContext(ctx, `INSERT INTO pages(id,title,order_index,created_at,updated_at) VALUES(?,?,?,?,?)`,
		pageID, "Test Page", 0, now, now); err != nil {
		t.Fatalf("insert page: %v", err)
	}

	// 2. block that will serve as the database's ID
	dbID := "db-block-1"
	if _, err := sqlDB.ExecContext(ctx, `INSERT INTO blocks(id,page_id,type,content,order_index,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`,
		dbID, pageID, "database", "{}", 0, now, now); err != nil {
		t.Fatalf("insert block: %v", err)
	}

	// 3. database (id = block id, satisfying FK)
	if _, err := sqlDB.ExecContext(ctx, `INSERT INTO databases(id,page_id,title,created_at,updated_at) VALUES(?,?,?,?,?)`,
		dbID, pageID, "Test DB", now, now); err != nil {
		t.Fatalf("insert database: %v", err)
	}

	// 4. relation column
	relColID := "col-relation"
	if _, err := sqlDB.ExecContext(ctx, `INSERT INTO database_columns(id,database_id,name,type,options,formula,is_hidden,order_index,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
		relColID, dbID, "Related", "relation", "[]", "", 0, 0, now, now); err != nil {
		t.Fatalf("insert relation col: %v", err)
	}

	// 5. target column (text)
	targetColID := "col-target"
	if _, err := sqlDB.ExecContext(ctx, `INSERT INTO database_columns(id,database_id,name,type,options,formula,is_hidden,order_index,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
		targetColID, dbID, "Value", "text", "[]", "", 0, 1, now, now); err != nil {
		t.Fatalf("insert target col: %v", err)
	}

	// 6. two "source" rows that hold relations
	row1ID := "row-src-1"
	row2ID := "row-src-2"
	for _, rid := range []string{row1ID, row2ID} {
		if _, err := sqlDB.ExecContext(ctx, `INSERT INTO database_rows(id,database_id,order_index,created_at,updated_at) VALUES(?,?,?,?,?)`,
			rid, dbID, 0, now, now); err != nil {
			t.Fatalf("insert source row %s: %v", rid, err)
		}
	}

	// 7. two "target" rows referenced by the relation column
	targetRow1ID := "row-tgt-1"
	targetRow2ID := "row-tgt-2"
	for _, rid := range []string{targetRow1ID, targetRow2ID} {
		if _, err := sqlDB.ExecContext(ctx, `INSERT INTO database_rows(id,database_id,order_index,created_at,updated_at) VALUES(?,?,?,?,?)`,
			rid, dbID, 0, now, now); err != nil {
			t.Fatalf("insert target row %s: %v", rid, err)
		}
	}

	return &fixtureDB{
		repo:         repo,
		dbID:         dbID,
		relColID:     relColID,
		targetColID:  targetColID,
		row1ID:       row1ID,
		row2ID:       row2ID,
		targetRow1ID: targetRow1ID,
		targetRow2ID: targetRow2ID,
	}
}

// setCell upserts a cell value.
func setCell(t *testing.T, repo *DatabaseRepo, rowID, colID, value string) {
	t.Helper()
	now := time.Now().Unix()
	_, err := repo.db.ExecContext(context.Background(),
		`INSERT INTO database_cells(row_id,column_id,value,updated_at) VALUES(?,?,?,?)
		 ON CONFLICT(row_id,column_id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
		rowID, colID, value, now)
	if err != nil {
		t.Fatalf("setCell: %v", err)
	}
}

// addRollupCol inserts a rollup column with the given aggregation.
func addRollupCol(t *testing.T, repo *DatabaseRepo, id, dbID, relColID, targetColID, aggregation string) {
	t.Helper()
	opts, _ := json.Marshal(map[string]string{
		"relation_column_id": relColID,
		"target_column_id":   targetColID,
		"aggregation":        aggregation,
	})
	now := time.Now().Unix()
	_, err := repo.db.ExecContext(context.Background(),
		`INSERT INTO database_columns(id,database_id,name,type,options,formula,is_hidden,order_index,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
		id, dbID, "Rollup_"+aggregation, "rollup", string(opts), "", 0, 99, now, now)
	if err != nil {
		t.Fatalf("addRollupCol: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Case 8: options JSON corrupted — column skipped, others still return
// ---------------------------------------------------------------------------

func TestListRows_CorruptedOptions_ColumnSkipped(t *testing.T) {
	f := seedMinimalDB(t)
	ctx := context.Background()
	now := time.Now().Unix()

	// Add a rollup column with broken JSON options
	_, err := f.repo.db.ExecContext(ctx,
		`INSERT INTO database_columns(id,database_id,name,type,options,formula,is_hidden,order_index,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
		"col-rollup-bad", f.dbID, "BadRollup", "rollup", "NOT_JSON{{{", "", 0, 10, now, now)
	if err != nil {
		t.Fatalf("insert bad rollup col: %v", err)
	}

	// Also add a valid rollup column (count) to verify it still works
	addRollupCol(t, f.repo, "col-rollup-ok", f.dbID, f.relColID, f.targetColID, "count")

	// Set relation on row1 pointing to target rows
	relVal, _ := json.Marshal([]string{f.targetRow1ID, f.targetRow2ID})
	setCell(t, f.repo, f.row1ID, f.relColID, string(relVal))

	rows, err := f.repo.ListRows(ctx, f.dbID)
	if err != nil {
		t.Fatalf("ListRows: %v", err)
	}

	// Find row1
	var row1 *model.DBRow
	for _, r := range rows {
		if r.ID == f.row1ID {
			row1 = r
		}
	}
	if row1 == nil {
		t.Fatal("row1 not found in ListRows result")
	}

	// The valid rollup column should return "2" (count of 2 related rows)
	if got := row1.Cells["col-rollup-ok"]; got != "2" {
		t.Errorf("valid rollup col after corrupted options: got %q, want %q", got, "2")
	}

	// The broken column should either be absent or empty string
	if got, exists := row1.Cells["col-rollup-bad"]; exists && got != "" {
		t.Errorf("broken rollup col: expected absent or empty, got %q", got)
	}
}

// ---------------------------------------------------------------------------
// Case 9: relation column does not exist — result is empty string
// ---------------------------------------------------------------------------

func TestListRows_RelationColumnNotExist(t *testing.T) {
	f := seedMinimalDB(t)
	ctx := context.Background()
	now := time.Now().Unix()

	// Add rollup column pointing to a non-existent relation column
	opts, _ := json.Marshal(map[string]string{
		"relation_column_id": "col-nonexistent",
		"target_column_id":   f.targetColID,
		"aggregation":        "count",
	})
	_, err := f.repo.db.ExecContext(ctx,
		`INSERT INTO database_columns(id,database_id,name,type,options,formula,is_hidden,order_index,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
		"col-rollup-norel", f.dbID, "NoRelRollup", "rollup", string(opts), "", 0, 11, now, now)
	if err != nil {
		t.Fatalf("insert rollup col: %v", err)
	}

	rows, err := f.repo.ListRows(ctx, f.dbID)
	if err != nil {
		t.Fatalf("ListRows: %v", err)
	}

	for _, row := range rows {
		if got := row.Cells["col-rollup-norel"]; got != "" {
			t.Errorf("row %s: relation col not exist, expected empty string, got %q", row.ID, got)
		}
	}
}

// ---------------------------------------------------------------------------
// Case 10: target column does not exist (batchFetchCells returns empty map)
//          → numeric aggregations return "0"
// ---------------------------------------------------------------------------

func TestListRows_TargetColumnNotExist_NumericReturnsZero(t *testing.T) {
	f := seedMinimalDB(t)
	ctx := context.Background()

	// Set relation on row1 pointing to target rows
	relVal, _ := json.Marshal([]string{f.targetRow1ID, f.targetRow2ID})
	setCell(t, f.repo, f.row1ID, f.relColID, string(relVal))

	// Rollup with sum but target column ID is non-existent
	now := time.Now().Unix()
	opts, _ := json.Marshal(map[string]string{
		"relation_column_id": f.relColID,
		"target_column_id":   "col-no-such-target",
		"aggregation":        "sum",
	})
	_, err := f.repo.db.ExecContext(ctx,
		`INSERT INTO database_columns(id,database_id,name,type,options,formula,is_hidden,order_index,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
		"col-rollup-notgt", f.dbID, "NoTgtRollup", "rollup", string(opts), "", 0, 12, now, now)
	if err != nil {
		t.Fatalf("insert rollup col: %v", err)
	}

	rows, err := f.repo.ListRows(ctx, f.dbID)
	if err != nil {
		t.Fatalf("ListRows: %v", err)
	}

	var row1 *model.DBRow
	for _, r := range rows {
		if r.ID == f.row1ID {
			row1 = r
		}
	}
	if row1 == nil {
		t.Fatal("row1 not found")
	}

	// sum with empty targetCells: all parse as 0, sum = 0
	if got := row1.Cells["col-rollup-notgt"]; got != "0" {
		t.Errorf("sum with missing target col: got %q, want %q", got, "0")
	}
}

// ---------------------------------------------------------------------------
// batchFetchCells unit tests (via in-memory DB)
// ---------------------------------------------------------------------------

func TestBatchFetchCells_EmptyRowIDs(t *testing.T) {
	repo := newTestDatabaseRepo(t)
	ctx := context.Background()

	result, err := repo.batchFetchCells(ctx, map[string]struct{}{}, "col-1")
	if err != nil {
		t.Fatalf("batchFetchCells: %v", err)
	}
	if len(result) != 0 {
		t.Errorf("expected empty map, got %v", result)
	}
}

func TestBatchFetchCells_EmptyTargetColumnID(t *testing.T) {
	repo := newTestDatabaseRepo(t)
	ctx := context.Background()

	ids := map[string]struct{}{"row-1": {}}
	result, err := repo.batchFetchCells(ctx, ids, "")
	if err != nil {
		t.Fatalf("batchFetchCells: %v", err)
	}
	if len(result) != 0 {
		t.Errorf("expected empty map, got %v", result)
	}
}

func TestBatchFetchCells_ReturnsCorrectValues(t *testing.T) {
	f := seedMinimalDB(t)
	ctx := context.Background()

	// seed target cells
	setCell(t, f.repo, f.targetRow1ID, f.targetColID, "100")
	setCell(t, f.repo, f.targetRow2ID, f.targetColID, "200")

	ids := map[string]struct{}{
		f.targetRow1ID: {},
		f.targetRow2ID: {},
	}
	result, err := f.repo.batchFetchCells(ctx, ids, f.targetColID)
	if err != nil {
		t.Fatalf("batchFetchCells: %v", err)
	}
	if result[f.targetRow1ID] != "100" {
		t.Errorf("row1: got %q, want %q", result[f.targetRow1ID], "100")
	}
	if result[f.targetRow2ID] != "200" {
		t.Errorf("row2: got %q, want %q", result[f.targetRow2ID], "200")
	}
}

// ---------------------------------------------------------------------------
// Full ListRows rollup injection tests
// ---------------------------------------------------------------------------

func TestListRows_Rollup_Count(t *testing.T) {
	f := seedMinimalDB(t)
	ctx := context.Background()
	addRollupCol(t, f.repo, "col-count", f.dbID, f.relColID, f.targetColID, "count")

	// row1 references 2 target rows; row2 has no relations
	relVal, _ := json.Marshal([]string{f.targetRow1ID, f.targetRow2ID})
	setCell(t, f.repo, f.row1ID, f.relColID, string(relVal))

	rows, err := f.repo.ListRows(ctx, f.dbID)
	if err != nil {
		t.Fatalf("ListRows: %v", err)
	}

	rowMap := rowsByID(rows)
	if got := rowMap[f.row1ID].Cells["col-count"]; got != "2" {
		t.Errorf("count row1: got %q, want %q", got, "2")
	}
	if got := rowMap[f.row2ID].Cells["col-count"]; got != "0" {
		t.Errorf("count row2 (no relations): got %q, want %q", got, "0")
	}
}

func TestListRows_Rollup_CountNotEmpty(t *testing.T) {
	f := seedMinimalDB(t)
	ctx := context.Background()
	addRollupCol(t, f.repo, "col-cne", f.dbID, f.relColID, f.targetColID, "count_not_empty")

	// target row1 has value, target row2 has empty value
	setCell(t, f.repo, f.targetRow1ID, f.targetColID, "hello")
	setCell(t, f.repo, f.targetRow2ID, f.targetColID, "")

	relVal, _ := json.Marshal([]string{f.targetRow1ID, f.targetRow2ID})
	setCell(t, f.repo, f.row1ID, f.relColID, string(relVal))

	rows, err := f.repo.ListRows(ctx, f.dbID)
	if err != nil {
		t.Fatalf("ListRows: %v", err)
	}
	rowMap := rowsByID(rows)
	if got := rowMap[f.row1ID].Cells["col-cne"]; got != "1" {
		t.Errorf("count_not_empty: got %q, want %q", got, "1")
	}
}

func TestListRows_Rollup_Sum(t *testing.T) {
	f := seedMinimalDB(t)
	ctx := context.Background()
	addRollupCol(t, f.repo, "col-sum", f.dbID, f.relColID, f.targetColID, "sum")

	setCell(t, f.repo, f.targetRow1ID, f.targetColID, "3")
	setCell(t, f.repo, f.targetRow2ID, f.targetColID, "7")

	relVal, _ := json.Marshal([]string{f.targetRow1ID, f.targetRow2ID})
	setCell(t, f.repo, f.row1ID, f.relColID, string(relVal))

	rows, err := f.repo.ListRows(ctx, f.dbID)
	if err != nil {
		t.Fatalf("ListRows: %v", err)
	}
	rowMap := rowsByID(rows)
	if got := rowMap[f.row1ID].Cells["col-sum"]; got != "10" {
		t.Errorf("sum: got %q, want %q", got, "10")
	}
}

func TestListRows_Rollup_Avg(t *testing.T) {
	f := seedMinimalDB(t)
	ctx := context.Background()
	addRollupCol(t, f.repo, "col-avg", f.dbID, f.relColID, f.targetColID, "avg")

	setCell(t, f.repo, f.targetRow1ID, f.targetColID, "10")
	setCell(t, f.repo, f.targetRow2ID, f.targetColID, "20")

	relVal, _ := json.Marshal([]string{f.targetRow1ID, f.targetRow2ID})
	setCell(t, f.repo, f.row1ID, f.relColID, string(relVal))

	rows, err := f.repo.ListRows(ctx, f.dbID)
	if err != nil {
		t.Fatalf("ListRows: %v", err)
	}
	rowMap := rowsByID(rows)
	if got := rowMap[f.row1ID].Cells["col-avg"]; got != "15.00" {
		t.Errorf("avg: got %q, want %q", got, "15.00")
	}
}

func TestListRows_Rollup_Max(t *testing.T) {
	f := seedMinimalDB(t)
	ctx := context.Background()
	addRollupCol(t, f.repo, "col-max", f.dbID, f.relColID, f.targetColID, "max")

	setCell(t, f.repo, f.targetRow1ID, f.targetColID, "5")
	setCell(t, f.repo, f.targetRow2ID, f.targetColID, "99")

	relVal, _ := json.Marshal([]string{f.targetRow1ID, f.targetRow2ID})
	setCell(t, f.repo, f.row1ID, f.relColID, string(relVal))

	rows, err := f.repo.ListRows(ctx, f.dbID)
	if err != nil {
		t.Fatalf("ListRows: %v", err)
	}
	rowMap := rowsByID(rows)
	if got := rowMap[f.row1ID].Cells["col-max"]; got != "99" {
		t.Errorf("max: got %q, want %q", got, "99")
	}
}

func TestListRows_Rollup_Min(t *testing.T) {
	f := seedMinimalDB(t)
	ctx := context.Background()
	addRollupCol(t, f.repo, "col-min", f.dbID, f.relColID, f.targetColID, "min")

	setCell(t, f.repo, f.targetRow1ID, f.targetColID, "5")
	setCell(t, f.repo, f.targetRow2ID, f.targetColID, "99")

	relVal, _ := json.Marshal([]string{f.targetRow1ID, f.targetRow2ID})
	setCell(t, f.repo, f.row1ID, f.relColID, string(relVal))

	rows, err := f.repo.ListRows(ctx, f.dbID)
	if err != nil {
		t.Fatalf("ListRows: %v", err)
	}
	rowMap := rowsByID(rows)
	if got := rowMap[f.row1ID].Cells["col-min"]; got != "5" {
		t.Errorf("min: got %q, want %q", got, "5")
	}
}

func TestListRows_Rollup_ShowOriginal(t *testing.T) {
	f := seedMinimalDB(t)
	ctx := context.Background()
	addRollupCol(t, f.repo, "col-show", f.dbID, f.relColID, f.targetColID, "show_original")

	setCell(t, f.repo, f.targetRow1ID, f.targetColID, "apple")
	setCell(t, f.repo, f.targetRow2ID, f.targetColID, "banana")

	relVal, _ := json.Marshal([]string{f.targetRow1ID, f.targetRow2ID})
	setCell(t, f.repo, f.row1ID, f.relColID, string(relVal))

	rows, err := f.repo.ListRows(ctx, f.dbID)
	if err != nil {
		t.Fatalf("ListRows: %v", err)
	}
	rowMap := rowsByID(rows)
	if got := rowMap[f.row1ID].Cells["col-show"]; got != "apple,banana" {
		t.Errorf("show_original: got %q, want %q", got, "apple,banana")
	}
}

func TestListRows_Rollup_EmptyRelatedIDs_NumericReturnsZero(t *testing.T) {
	f := seedMinimalDB(t)
	ctx := context.Background()
	addRollupCol(t, f.repo, "col-sum-empty", f.dbID, f.relColID, f.targetColID, "sum")

	// row1 has no relation cell set at all → empty relatedIDs
	rows, err := f.repo.ListRows(ctx, f.dbID)
	if err != nil {
		t.Fatalf("ListRows: %v", err)
	}
	rowMap := rowsByID(rows)
	if got := rowMap[f.row1ID].Cells["col-sum-empty"]; got != "0" {
		t.Errorf("sum with empty relatedIDs: got %q, want %q", got, "0")
	}
}

func TestListRows_Rollup_EmptyRelatedIDs_ShowOriginalReturnsEmpty(t *testing.T) {
	f := seedMinimalDB(t)
	ctx := context.Background()
	addRollupCol(t, f.repo, "col-show-empty", f.dbID, f.relColID, f.targetColID, "show_original")

	// row1 has no relation cell → empty relatedIDs
	rows, err := f.repo.ListRows(ctx, f.dbID)
	if err != nil {
		t.Fatalf("ListRows: %v", err)
	}
	rowMap := rowsByID(rows)
	if got := rowMap[f.row1ID].Cells["col-show-empty"]; got != "" {
		t.Errorf("show_original with empty relatedIDs: got %q, want empty string", got)
	}
}

// rowsByID converts a slice of rows to a map keyed by row ID.
func rowsByID(rows []*model.DBRow) map[string]*model.DBRow {
	m := make(map[string]*model.DBRow, len(rows))
	for _, r := range rows {
		m[r.ID] = r
	}
	return m
}
