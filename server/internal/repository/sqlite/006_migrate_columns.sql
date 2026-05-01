-- 阶段 0：备份所有 type='columns' 旧记录
-- IF NOT EXISTS 确保幂等：重复执行不会失败
CREATE TABLE IF NOT EXISTS blocks_migration_backup AS
  SELECT * FROM blocks WHERE type = 'columns';

-- 阶段 1：幂等扫描查询（只读，供 Go 迁移脚本使用）
-- 筛选条件：type=columns + content 含 columnsData + 尚未生成子块（幂等）
-- SELECT id, page_id, content, order_index
-- FROM blocks
-- WHERE type = 'columns'
--   AND content LIKE '%columnsData%'
--   AND NOT EXISTS (
--     SELECT 1 FROM blocks child WHERE child.parent_block_id = blocks.id
--   );
