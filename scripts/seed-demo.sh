#!/usr/bin/env bash
# 演示数据初始化脚本 — REQ-029
# 创建「产品季度销售数据」页面，含 6 列 5 行，formula 列自动计算
set -e

BASE="http://localhost:8080/api"

echo "→ 创建演示页面"
PAGE=$(curl -sf -X POST $BASE/pages \
  -H "Content-Type: application/json" \
  -d '{"title":"📊 数据库演示","parent_id":null,"order_index":0}')
PAGE_ID=$(echo $PAGE | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  Page: $PAGE_ID"

echo "→ 创建 database block"
DB_BLOCK=$(curl -sf -X POST $BASE/pages/$PAGE_ID/blocks \
  -H "Content-Type: application/json" \
  -d '{"type":"database","content":"{}","order_index":1}')
DB_ID=$(echo $DB_BLOCK | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

echo "→ 创建 database (id=$DB_ID)"
curl -sf -X POST $BASE/databases \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"$DB_ID\",\"page_id\":\"$PAGE_ID\",\"title\":\"产品季度销售数据\"}" > /dev/null

curl -sf -X PUT $BASE/blocks/$DB_ID \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"{\\\"databaseId\\\":\\\"$DB_ID\\\"}\"}" > /dev/null

echo "→ 添加列"
add_col() {
  curl -sf -X POST $BASE/databases/$DB_ID/columns \
    -H "Content-Type: application/json" -d "$1" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4
}
COL_PRODUCT=$(add_col '{"name":"产品名称","type":"text","options":"[]","formula":"","order_index":0}')
COL_Q1=$(add_col '{"name":"Q1销售额","type":"number","options":"[]","formula":"","order_index":1}')
COL_Q2=$(add_col '{"name":"Q2销售额","type":"number","options":"[]","formula":"","order_index":2}')
COL_TOTAL=$(add_col '{"name":"上半年合计","type":"formula","options":"[]","formula":"{Q1销售额}+{Q2销售额}","order_index":3}')
COL_DATE=$(add_col '{"name":"统计日期","type":"date","options":"[]","formula":"","order_index":4}')
COL_DONE=$(add_col '{"name":"已审核","type":"checkbox","options":"[]","formula":"","order_index":5}')
echo "  $COL_PRODUCT $COL_Q1 $COL_Q2 $COL_TOTAL $COL_DATE $COL_DONE"

echo "→ 添加行数据"
add_row() {
  local ROW_ID=$(curl -sf -X POST $BASE/databases/$DB_ID/rows \
    -H "Content-Type: application/json" -d '{}' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  curl -sf -X PATCH $BASE/databases/$DB_ID/rows/$ROW_ID/cells \
    -H "Content-Type: application/json" -d "$1" > /dev/null
  echo "  Row: $ROW_ID"
}

add_row "[{\"column_id\":\"$COL_PRODUCT\",\"value\":\"智能手表 Pro\"},{\"column_id\":\"$COL_Q1\",\"value\":\"128000\"},{\"column_id\":\"$COL_Q2\",\"value\":\"156000\"},{\"column_id\":\"$COL_DATE\",\"value\":\"2026-06-30\"},{\"column_id\":\"$COL_DONE\",\"value\":\"true\"}]"
add_row "[{\"column_id\":\"$COL_PRODUCT\",\"value\":\"无线耳机 X3\"},{\"column_id\":\"$COL_Q1\",\"value\":\"89500\"},{\"column_id\":\"$COL_Q2\",\"value\":\"112300\"},{\"column_id\":\"$COL_DATE\",\"value\":\"2026-06-30\"},{\"column_id\":\"$COL_DONE\",\"value\":\"true\"}]"
add_row "[{\"column_id\":\"$COL_PRODUCT\",\"value\":\"便携投影仪\"},{\"column_id\":\"$COL_Q1\",\"value\":\"45200\"},{\"column_id\":\"$COL_Q2\",\"value\":\"67800\"},{\"column_id\":\"$COL_DATE\",\"value\":\"2026-06-30\"},{\"column_id\":\"$COL_DONE\",\"value\":\"false\"}]"
add_row "[{\"column_id\":\"$COL_PRODUCT\",\"value\":\"机械键盘 K80\"},{\"column_id\":\"$COL_Q1\",\"value\":\"203000\"},{\"column_id\":\"$COL_Q2\",\"value\":\"198500\"},{\"column_id\":\"$COL_DATE\",\"value\":\"2026-06-30\"},{\"column_id\":\"$COL_DONE\",\"value\":\"true\"}]"
add_row "[{\"column_id\":\"$COL_PRODUCT\",\"value\":\"4K 显示器\"},{\"column_id\":\"$COL_Q1\",\"value\":\"315000\"},{\"column_id\":\"$COL_Q2\",\"value\":\"287000\"},{\"column_id\":\"$COL_DATE\",\"value\":\"2026-06-30\"},{\"column_id\":\"$COL_DONE\",\"value\":\"false\"}]"

echo "✅ 演示数据就绪，打开 http://localhost:5173 → 选择「📊 数据库演示」页面"
