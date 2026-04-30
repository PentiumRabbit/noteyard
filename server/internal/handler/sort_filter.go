package handler

import (
	"sort"
	"strconv"
	"strings"

	"noteyard/server/internal/model"
)

func applyFilter(rows []*model.DBRow, colID, op, val string) []*model.DBRow {
	result := rows[:0]
	for _, row := range rows {
		cellVal := row.Cells[colID]
		if matchFilter(cellVal, op, val) {
			result = append(result, row)
		}
	}
	return result
}

func matchFilter(cellVal, op, val string) bool {
	switch op {
	case "contains":
		return strings.Contains(strings.ToLower(cellVal), strings.ToLower(val))
	case "not_contains":
		return !strings.Contains(strings.ToLower(cellVal), strings.ToLower(val))
	case "equals":
		return cellVal == val
	case "not_equals":
		return cellVal != val
	case "is_empty":
		return cellVal == ""
	case "is_not_empty":
		return cellVal != ""
	case "gt":
		a, err1 := strconv.ParseFloat(cellVal, 64)
		b, err2 := strconv.ParseFloat(val, 64)
		return err1 == nil && err2 == nil && a > b
	case "lt":
		a, err1 := strconv.ParseFloat(cellVal, 64)
		b, err2 := strconv.ParseFloat(val, 64)
		return err1 == nil && err2 == nil && a < b
	default:
		return true
	}
}

func applySort(rows []*model.DBRow, colID, order string) {
	sort.SliceStable(rows, func(i, j int) bool {
		a := rows[i].Cells[colID]
		b := rows[j].Cells[colID]
		af, aerr := strconv.ParseFloat(a, 64)
		bf, berr := strconv.ParseFloat(b, 64)
		var less bool
		if aerr == nil && berr == nil {
			less = af < bf
		} else {
			less = strings.ToLower(a) < strings.ToLower(b)
		}
		if order == "desc" {
			return !less
		}
		return less
	})
}
