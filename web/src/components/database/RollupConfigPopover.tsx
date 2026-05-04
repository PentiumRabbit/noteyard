import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { DBColumn, RollupAggregation, RollupColumnOptions } from "../../types";
import CustomSelect from "../common/CustomSelect";

interface Props {
  /** All columns in the current database */
  allColumns: DBColumn[];
  /** The rollup column being configured */
  col: DBColumn;
  /** Popover position */
  x: number;
  y: number;
  onSave: () => void;
  onCancel: () => void;
  databaseId: string;
}

const AGGREGATION_LABELS: Record<RollupAggregation, string> = {
  count: "计数（所有）",
  count_not_empty: "计数（非空）",
  sum: "求和",
  avg: "平均值",
  max: "最大值",
  min: "最小值",
  show_original: "显示原始值",
};

const ALL_AGGREGATIONS: RollupAggregation[] = [
  "count",
  "count_not_empty",
  "sum",
  "avg",
  "max",
  "min",
  "show_original",
];

function parseRollupOptions(raw: string): RollupColumnOptions | null {
  try {
    const opts = JSON.parse(raw);
    if (
      opts &&
      typeof opts === "object" &&
      "relation_column_id" in opts &&
      "target_column_id" in opts &&
      "aggregation" in opts
    ) {
      return opts as RollupColumnOptions;
    }
    return null;
  } catch {
    return null;
  }
}

export function RollupConfigPopover({
  allColumns,
  col,
  x,
  y,
  onSave,
  onCancel,
  databaseId,
}: Props) {
  const existingOpts = parseRollupOptions(col.options);

  const [relationColId, setRelationColId] = useState<string>(
    existingOpts?.relation_column_id ?? ""
  );
  const [targetColId, setTargetColId] = useState<string>(
    existingOpts?.target_column_id ?? ""
  );
  const [aggregation, setAggregation] = useState<RollupAggregation>(
    existingOpts?.aggregation ?? "count"
  );
  const [targetCols, setTargetCols] = useState<DBColumn[]>([]);
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Relation columns in the current database
  const relationCols = allColumns.filter((c) => c.type === "relation");

  // When relation column changes, load target database columns
  useEffect(() => {
    if (!relationColId) {
      setTargetCols([]);
      return;
    }
    const relCol = allColumns.find((c) => c.id === relationColId);
    if (!relCol) {
      setTargetCols([]);
      return;
    }
    let targetDbId: string | null = null;
    try {
      const opts = JSON.parse(relCol.options);
      if (opts && typeof opts === "object" && "target_database_id" in opts) {
        targetDbId = opts.target_database_id as string;
      }
    } catch {
      // ignore
    }
    if (!targetDbId) {
      setTargetCols([]);
      return;
    }
    setLoading(true);
    void api.databases
      .get(targetDbId)
      .then((db) => {
        setTargetCols(db.columns ?? []);
      })
      .catch(() => {
        setTargetCols([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [relationColId, allColumns]);

  // Reset target column when relation changes
  useEffect(() => {
    if (existingOpts?.relation_column_id !== relationColId) {
      setTargetColId("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relationColId]);

  const handleSave = async () => {
    setSaveError(null);
    if (!relationColId) {
      setSaveError("请选择关联列");
      return;
    }
    const opts: RollupColumnOptions = {
      relation_column_id: relationColId,
      target_column_id: targetColId,
      aggregation,
    };
    try {
      await api.databases.updateColumn(databaseId, col.id, {
        ...col,
        options: JSON.stringify(opts),
      });
      onSave();
    } catch (e) {
      setSaveError((e as Error).message);
    }
  };

  const adaptiveY =
    y + 320 + 4 > window.innerHeight ? y - 320 - 4 : y;

  return (
    <>
      <div className="formula-overlay" onClick={onCancel} />
      <div className="rollup-popover" style={{ top: adaptiveY, left: x }}>
        <div className="formula-popover-title">配置汇总列</div>

        {/* Step 1: relation column */}
        <div className="rollup-field-label">关联列</div>
        <CustomSelect
          value={relationColId}
          onChange={(v) => setRelationColId(v)}
          placeholder="请选择关联列…"
          options={[
            ...relationCols.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        {relationCols.length === 0 && (
          <div className="rollup-hint">当前数据库无关联列，请先添加关联列</div>
        )}

        {/* Step 2: target property */}
        <div className="rollup-field-label">目标属性</div>
        {loading ? (
          <div className="rollup-hint">加载中…</div>
        ) : (
          <CustomSelect
            value={targetColId}
            onChange={(v) => setTargetColId(v)}
            placeholder="请选择目标属性…"
            disabled={!relationColId || targetCols.length === 0}
            options={[
              ...targetCols.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        )}

        {/* Step 3: aggregation */}
        <div className="rollup-field-label">聚合函数</div>
        <CustomSelect
          value={aggregation}
          onChange={(v) => setAggregation(v as RollupAggregation)}
          options={ALL_AGGREGATIONS.map((a) => ({ value: a, label: AGGREGATION_LABELS[a] }))}
        />

        {saveError && <div className="rollup-error">{saveError}</div>}

        <div className="formula-actions">
          <button className="formula-save-btn" onClick={() => void handleSave()}>
            保存
          </button>
          <button className="formula-cancel-btn" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </>
  );
}
