import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Table, Columns, LayoutGrid, List, CalendarDays, GanttChartSquare, Filter, ArrowUpDown, EyeOff, Rows, Plus, ExternalLink, Copy, Trash2, FileText } from "lucide-react";
import { api } from "../../api/client";
import type { DBCell, DBColumn, DBRow, Database, RelationColumnOptions, RollupColumnOptions, FilterState, SortState } from "../../types";
import { ToolbarPanelView } from "./ToolbarPanel";
import { KanbanView } from "./KanbanView";
import { GalleryView } from "./GalleryView";
import { CalendarView } from "./CalendarView";
import { TimelineView } from "./TimelineView";
import { RollupConfigPopover } from "./RollupConfigPopover";
import { Chip } from "./Chip";
import { getPopoverY } from "../../utils/popover";
import { TAG_COLORS, tagColor, parseOptions, serializeOptions } from "./shared";
import type { SelectOption } from "./shared";
import { ColIcon } from "./ColIcon";
import { COL_TYPES, COL_TYPE_LABELS, READONLY_COL_TYPES, FORMULA_FUNCTIONS } from "./databaseConstants";
import { ColumnHeaderMenu, FormulaPopoverPanel, SelectOptionsPopoverPanel } from "./ColumnHeader";
import type { ColMenu, FormulaPopover, SelectOptionsPopover } from "./ColumnHeader";
import { RowModal } from "./RowModal";
import { CellRenderer } from "./CellRenderer";
import { evalFormula } from "./formulaEngine";
import "./DatabaseView.css";

interface Props { databaseId: string }

interface AddColPopover { x: number; y: number }
interface RollupPopover { colId: string; x: number; y: number }
interface SelectDropdown { rowId: string; colId: string; x: number; y: number; options: SelectOption[] }
interface RowModalState { row: DBRow }
type ToolbarPanel = "sort" | "filter" | "hide" | "group" | null

function ListGroup({ label, col, rows, primaryCol, onOpen, onAdd }: {
  label: string;
  col: DBColumn;
  rows: DBRow[];
  primaryCol: DBColumn | null;
  onOpen: (row: DBRow) => void;
  onAdd: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const tc = col.type === "select" ? tagColor(label) : null;
  return (
    <div className="db-list-group">
      <button className="db-list-group-header" onClick={() => setCollapsed(v => !v)}>
        <span className="db-list-group-arrow">{collapsed ? "▸" : "▾"}</span>
        {tc ? (
          <span className="cell-tag" style={{ background: tc.bg, color: tc.color }}>{label}</span>
        ) : (
          <span className="db-list-group-label">{label}</span>
        )}
        <span className="db-list-group-count">{rows.length}</span>
      </button>
      {!collapsed && (
        <>
          {rows.map(row => (
            <div key={row.id} className="db-list-row db-list-row-grouped" onClick={() => onOpen(row)}>
              <span className="db-list-icon"><FileText size={14} /></span>
              <span className="db-list-title">{primaryCol ? (row.cells[primaryCol.id] || "未命名") : "未命名"}</span>
            </div>
          ))}
          <button className="db-list-add-inline" onClick={onAdd}><Plus size={12} /> 新建</button>
        </>
      )}
    </div>
  );
}

export function DatabaseView({ databaseId }: Props) {
  const [db, setDb] = useState<Database | null>(null);
  const [rows, setRows] = useState<DBRow[]>([]);
  const [editingCell, setEditingCell] = useState<{ rowId: string; colId: string } | null>(null);
  const [cellDraft, setCellDraft] = useState("");
  const [colMenu, setColMenu] = useState<ColMenu | null>(null);
  const [addColPopover, setAddColPopover] = useState<AddColPopover | null>(null);
  const [formulaPopover, setFormulaPopover] = useState<FormulaPopover | null>(null);
  const [rollupPopover, setRollupPopover] = useState<RollupPopover | null>(null);
  const [selectOptionsPopover, setSelectOptionsPopover] = useState<SelectOptionsPopover | null>(null);
  const [selectDropdown, setSelectDropdown] = useState<SelectDropdown | null>(null);
  const [rowModal, setRowModal] = useState<RowModalState | null>(null);
  const [rowModalDraft, setRowModalDraft] = useState<Record<string, string>>({});
  const [newColName, setNewColName] = useState("");
  const [newColType, setNewColType] = useState<DBColumn["type"]>("text");
  const [colTypeOpen, setColTypeOpen] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [resizingColId, setResizingColId] = useState<string | null>(null);
  const [newOptionName, setNewOptionName] = useState("");
  const [sortStates, setSortStates] = useState<SortState[]>([]);
  const [filterStates, setFilterStates] = useState<FilterState[]>([]);
  const [toolbarPanel, setToolbarPanel] = useState<ToolbarPanel>(null);
  const [viewMode, setViewMode] = useState<"table" | "kanban" | "gallery" | "list" | "calendar" | "timeline">("table");
  const [kanbanGroupColId, setKanbanGroupColId] = useState<string>("");
  const [groupByColId, setGroupByColId] = useState<string>("");
  const [multiSelectDropdown, setMultiSelectDropdown] = useState<{ rowId: string; colId: string; x: number; y: number; options: SelectOption[] } | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [batchPanel, setBatchPanel] = useState(false);
  const [batchColId, setBatchColId] = useState("");
  const [batchVal, setBatchVal] = useState("");
  const [newColRelationDbId, setNewColRelationDbId] = useState("");
  const [availableDatabases, setAvailableDatabases] = useState<Database[]>([]);
  const relationRowsCache = useRef<Map<string, Map<string, DBRow | null>>>(new Map());
  const [pendingRollupColId, setPendingRollupColId] = useState<string | null>(null);
  const [deletedTargetDbIds, setDeletedTargetDbIds] = useState<Set<string>>(new Set());

  const cellInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const newColInputRef = useRef<HTMLInputElement>(null);
  const formulaInputRef = useRef<HTMLTextAreaElement>(null);
  const resizingRef = useRef<{ colId: string; startX: number; startWidth: number } | null>(null);
  const rowContentSaveRef = useRef<(() => void) | null>(null);

  const parseRelationOpts = (col: DBColumn): RelationColumnOptions | null => {
    try {
      const opts = JSON.parse(col.options);
      if (opts && typeof opts === "object" && "target_database_id" in opts) {
        return opts as RelationColumnOptions;
      }
      return null;
    } catch {
      return null;
    }
  };

  const parseRollupOpts = (col: DBColumn): RollupColumnOptions | null => {
    try {
      const opts = JSON.parse(col.options);
      if (opts && typeof opts === "object" && "relation_column_id" in opts && "target_column_id" in opts && "aggregation" in opts) {
        return opts as RollupColumnOptions;
      }
      return null;
    } catch {
      return null;
    }
  };

  const rollupRelationMissing = (col: DBColumn, columns: DBColumn[]): boolean => {
    const opts = parseRollupOpts(col);
    if (!opts || !opts.relation_column_id) return false;
    return !columns.find(c => c.id === opts.relation_column_id);
  };

  const reload = useCallback(async () => {
    const [dbData, rowData] = await Promise.all([
      api.databases.get(databaseId),
      api.databases.listRows(databaseId, {}),
    ]);
    setDb(dbData);
    setRows(rowData ?? []);
  }, [databaseId]);

  useEffect(() => { void reload().catch(() => {}); }, [reload]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    if (!db) return;
    const relationCols = (db.columns ?? []).filter(c => c.type === "relation");
    if (relationCols.length === 0) return;

    let cancelled = false;

    void (async () => {
      const currentRows = rowsRef.current;
      if (currentRows.length === 0) return;

      let changed = false;

      for (const col of relationCols) {
        if (cancelled) return;
        const opts = parseRelationOpts(col);
        if (!opts?.target_database_id) continue;
        const targetDbId = opts.target_database_id;

        const allIds = new Set<string>();
        for (const row of currentRows) {
          const raw = row.cells[col.id] ?? "";
          if (!raw || raw === "[]") continue;
          try {
            const ids = JSON.parse(raw);
            if (Array.isArray(ids)) ids.forEach((id: unknown) => { if (typeof id === "string") allIds.add(id); });
          } catch { /* skip */ }
        }
        if (allIds.size === 0) continue;

        const colCache = relationRowsCache.current.get(targetDbId) ?? new Map<string, DBRow | null>();
        const missing = [...allIds].filter(id => !colCache.has(id));
        if (missing.length === 0) continue;

        await Promise.all(missing.map(async id => {
          try {
            const row = await api.databases.getRow(targetDbId, id);
            if (!cancelled) colCache.set(id, row);
          } catch {
            if (!cancelled) colCache.set(id, null);
          }
        }));
        if (cancelled) return;
        relationRowsCache.current.set(targetDbId, colCache);
        changed = true;
      }

      if (!cancelled && changed) setRows(r => [...r]);
    })();

    return () => { cancelled = true; };
  }, [db]);

  useEffect(() => { if (editingCell) cellInputRef.current?.focus(); }, [editingCell]);
  useEffect(() => { if (titleEditing) titleInputRef.current?.select(); }, [titleEditing]);
  useEffect(() => { if (colMenu?.renaming) renameInputRef.current?.select(); }, [colMenu?.renaming]);
  useEffect(() => { if (addColPopover) newColInputRef.current?.focus(); }, [addColPopover]);
  useEffect(() => { if (formulaPopover) formulaInputRef.current?.focus(); }, [formulaPopover]);

  const startTitleEdit = () => { setTitleDraft(db?.title ?? ""); setTitleEditing(true); };
  const commitTitle = async () => {
    setTitleEditing(false);
    if (!titleDraft.trim() || titleDraft === db?.title) return;
    await api.databases.updateTitle(databaseId, titleDraft.trim());
    void reload();
  };

  const startEdit = (rowId: string, colId: string, val: string) => {
    setEditingCell({ rowId, colId });
    setCellDraft(val);
  };

  const commitEdit = async (rowId: string, colId: string) => {
    const prevRows = rows;
    setRows(rs => rs.map(r =>
      r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: cellDraft } } : r
    ));
    setEditingCell(null);
    try {
      const cells: DBCell[] = [{ column_id: colId, value: cellDraft }];
      await api.databases.updateCells(databaseId, rowId, cells);
      void reload();
    } catch {
      setRows(prevRows);
    }
  };

  const toggleCheckbox = async (rowId: string, colId: string, val: string) => {
    await api.databases.updateCells(databaseId, rowId, [{ column_id: colId, value: val === "true" ? "false" : "true" }]);
    void reload();
  };

  const handleCellKeyDown = (e: React.KeyboardEvent, rowId: string, colId: string) => {
    if (!db) return;
    const cols = db.columns.slice().sort((a, b) => a.order_index - b.order_index).filter(c => !READONLY_COL_TYPES.has(c.type) && c.type !== "checkbox");
    const colIdx = cols.findIndex(c => c.id === colId);
    const rowIdx = rows.findIndex(r => r.id === rowId);

    if (e.key === "Tab") {
      e.preventDefault();
      void commitEdit(rowId, colId).then(() => {
        const nextColIdx = e.shiftKey ? colIdx - 1 : colIdx + 1;
        if (nextColIdx >= 0 && nextColIdx < cols.length) {
          const nextCol = cols[nextColIdx];
          const val = rows[rowIdx]?.cells[nextCol.id] ?? "";
          startEdit(rowId, nextCol.id, val);
        } else if (!e.shiftKey && rowIdx + 1 < rows.length) {
          const nextRow = rows[rowIdx + 1];
          const val = nextRow.cells[cols[0]?.id ?? ""] ?? "";
          startEdit(nextRow.id, cols[0]?.id ?? "", val);
        } else if (e.shiftKey && rowIdx > 0) {
          const prevRow = rows[rowIdx - 1];
          const lastCol = cols[cols.length - 1];
          const val = prevRow.cells[lastCol?.id ?? ""] ?? "";
          startEdit(prevRow.id, lastCol?.id ?? "", val);
        }
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      void commitEdit(rowId, colId).then(() => {
        if (rowIdx + 1 < rows.length) {
          const nextRow = rows[rowIdx + 1];
          const val = nextRow.cells[colId] ?? "";
          startEdit(nextRow.id, colId, val);
        }
      });
    } else if (e.key === "Escape") {
      setEditingCell(null);
    }
  };

  const addRow = async () => { await api.databases.addRow(databaseId); void reload(); };
  const deleteRow = async (rowId: string) => { await api.databases.deleteRow(databaseId, rowId); void reload(); };
  const batchDelete = async () => {
    if (selectedRowIds.size === 0) return;
    if (!confirm(`删除选中的 ${selectedRowIds.size} 行？`)) return;
    await Promise.all([...selectedRowIds].map(id => api.databases.deleteRow(databaseId, id)));
    setSelectedRowIds(new Set());
    void reload();
  };

  const batchUpdateCol = async () => {
    if (selectedRowIds.size === 0 || !batchColId) return;
    await Promise.all([...selectedRowIds].map(id =>
      api.databases.updateCells(databaseId, id, [{ column_id: batchColId, value: batchVal }])
    ));
    setSelectedRowIds(new Set());
    setBatchPanel(false);
    void reload();
  };

  const toggleSelectRow = (id: string) => {
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedRowIds.size === rows.length) setSelectedRowIds(new Set());
    else setSelectedRowIds(new Set(rows.map(r => r.id)));
  };

  const duplicateRow = async (row: DBRow) => {
    const newRow = await api.databases.addRow(databaseId);
    if (!newRow) return;
    const cells = Object.entries(row.cells ?? {}).map(([colId, value]) => ({ column_id: colId, value }));
    if (cells.length > 0) await api.databases.updateCells(databaseId, newRow.id, cells);
    void reload();
  };

  const openColMenu = (e: React.MouseEvent, col: DBColumn) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setColMenu({ colId: col.id, x: rect.left, y: getPopoverY(rect), renaming: false, draft: col.name, changingType: false });
  };
  const closeColMenu = () => setColMenu(null);

  const commitRename = async () => {
    if (!colMenu) return;
    const col = db?.columns.find(c => c.id === colMenu.colId);
    if (!col || !colMenu.draft.trim()) { closeColMenu(); return; }
    await api.databases.updateColumn(databaseId, col.id, { ...col, name: colMenu.draft.trim() });
    closeColMenu();
    void reload();
  };

  const changeColType = async (type: DBColumn["type"]) => {
    if (!colMenu) return;
    const col = db?.columns.find(c => c.id === colMenu.colId);
    if (!col) return;
    setError(null);
    try { await api.databases.updateColumn(databaseId, col.id, { ...col, type }); }
    catch (e) { setError((e as Error).message); }
    closeColMenu();
    void reload();
  };

  const deleteCol = async () => {
    if (!colMenu) return;
    if (!confirm("删除此列将同时删除所有该列数据，确认？")) return;
    await api.databases.deleteColumn(databaseId, colMenu.colId);
    closeColMenu();
    void reload();
  };

  const openAddCol = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setAddColPopover({ x: rect.left, y: getPopoverY(rect) });
    setNewColName("");
    setNewColType("text");
    setNewColRelationDbId("");
    setColTypeOpen(false);
    setAvailableDatabases([]);
  };

  const loadAvailableDatabases = async () => {
    try {
      const pages = await api.pages.listAll();
      const dbList: Database[] = [];
      await Promise.all(pages.map(async page => {
        try {
          const blocks = await api.blocks.listByPage(page.id);
          const dbBlocks = blocks.filter(b => b.type === "database");
          await Promise.all(dbBlocks.map(async b => {
            try {
              const dbData = await api.databases.get(b.id);
              dbList.push(dbData);
            } catch { /* skip */ }
          }));
        } catch { /* skip */ }
      }));
      setAvailableDatabases(dbList);
    } catch { /* ignore */ }
  };

  const STATUS_PRESETS: SelectOption[] = [
    { value: "未开始", colorIdx: 5 },
    { value: "进行中", colorIdx: 1 },
    { value: "已完成", colorIdx: 2 },
  ];

  const submitNewCol = async () => {
    if (!newColName.trim()) return;
    setError(null);
    try {
      let options = "[]";
      if (newColType === "relation") {
        if (!newColRelationDbId) { setError("请选择目标数据库"); return; }
        const opts: RelationColumnOptions = { target_database_id: newColRelationDbId };
        options = JSON.stringify(opts);
      } else if (newColType === "status") {
        options = serializeOptions(STATUS_PRESETS);
      }
      const newCol = await api.databases.addColumn(databaseId, {
        name: newColName.trim(), type: newColType,
        options, formula: "", order_index: db?.columns.length ?? 0,
      });
      setAddColPopover(null);
      await reload();
      if (newColType === "rollup" && newCol?.id) {
        setPendingRollupColId(newCol.id);
      }
    } catch (e) { setError((e as Error).message); }
  };

  const getAcItems = (draft: string, cursorPos: number): string[] => {
    const before = draft.slice(0, cursorPos);
    const match = before.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
    if (!match) return [];
    const prefix = match[1].toUpperCase();
    if (!prefix) return [];
    return FORMULA_FUNCTIONS.filter(f => f.startsWith(prefix) && f !== prefix);
  };

  const applyAcItem = (item: string) => {
    if (!formulaPopover) return;
    const ta = formulaInputRef.current;
    const cursorPos = ta?.selectionStart ?? formulaPopover.draft.length;
    const before = formulaPopover.draft.slice(0, cursorPos);
    const after = formulaPopover.draft.slice(cursorPos);
    const match = before.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
    const prefixLen = match ? match[1].length : 0;
    const newDraft = before.slice(0, before.length - prefixLen) + item + "(" + after;
    const newCursor = cursorPos - prefixLen + item.length + 1;
    updateFormulaPreview(newDraft, []);
    requestAnimationFrame(() => {
      ta?.setSelectionRange(newCursor, newCursor);
      ta?.focus();
    });
  };

  const openFormulaPopover = (e: React.MouseEvent, col: DBColumn) => {
    const menuEl = (e.currentTarget as HTMLElement).closest(".col-menu");
    const rect = menuEl?.getBoundingClientRect() ?? (e.currentTarget as HTMLElement).getBoundingClientRect();
    const firstRow = rows[0];
    const preview = firstRow ? evalFormula(col.formula, firstRow, db?.columns ?? []) : "";
    setColMenu(null);
    setFormulaPopover({ colId: col.id, x: rect.left, y: getPopoverY(rect), draft: col.formula, preview, acItems: [], acIndex: 0 });
  };

  const updateFormulaPreview = (draft: string, acItems?: string[]) => {
    if (!formulaPopover || !db) return;
    const col = db.columns.find(c => c.id === formulaPopover.colId);
    if (!col) return;
    const firstRow = rows[0];
    const preview = firstRow ? evalFormula(draft, firstRow, db.columns) : "";
    const items = acItems ?? getAcItems(draft, formulaInputRef.current?.selectionStart ?? draft.length);
    setFormulaPopover(p => p ? { ...p, draft, preview, acItems: items, acIndex: 0 } : p);
  };

  const saveFormula = async () => {
    if (!formulaPopover || !db) return;
    const col = db.columns.find(c => c.id === formulaPopover.colId);
    if (!col) return;
    await api.databases.updateColumn(databaseId, col.id, { ...col, formula: formulaPopover.draft });
    setFormulaPopover(null);
    void reload();
  };

  const openRollupPopover = (e: React.MouseEvent, col: DBColumn) => {
    const menuEl = (e.currentTarget as HTMLElement).closest(".col-menu");
    const rect = menuEl?.getBoundingClientRect() ?? (e.currentTarget as HTMLElement).getBoundingClientRect();
    setColMenu(null);
    setRollupPopover({ colId: col.id, x: rect.left, y: getPopoverY(rect) });
  };

  const openSelectOptions = (e: React.MouseEvent, col: DBColumn) => {
    const menuEl = (e.currentTarget as HTMLElement).closest(".col-menu");
    const rect = menuEl?.getBoundingClientRect() ?? (e.currentTarget as HTMLElement).getBoundingClientRect();
    const options = parseOptions(col.options);
    setColMenu(null);
    setNewOptionName("");
    setSelectOptionsPopover({ colId: col.id, x: rect.left, y: getPopoverY(rect), options });
  };

  const saveSelectOptions = async (colId: string, options: SelectOption[]) => {
    if (!db) return;
    const col = db.columns.find(c => c.id === colId);
    if (!col) return;
    await api.databases.updateColumn(databaseId, colId, { ...col, options: serializeOptions(options) });
    void reload();
  };

  const addSelectOption = async () => {
    if (!selectOptionsPopover || !newOptionName.trim()) return;
    const newOpt: SelectOption = { value: newOptionName.trim(), colorIdx: selectOptionsPopover.options.length % TAG_COLORS.length };
    const updated = [...selectOptionsPopover.options, newOpt];
    setSelectOptionsPopover(p => p ? { ...p, options: updated } : p);
    setNewOptionName("");
    await saveSelectOptions(selectOptionsPopover.colId, updated);
  };

  const removeSelectOption = async (idx: number) => {
    if (!selectOptionsPopover) return;
    const updated = selectOptionsPopover.options.filter((_, i) => i !== idx);
    setSelectOptionsPopover(p => p ? { ...p, options: updated } : p);
    await saveSelectOptions(selectOptionsPopover.colId, updated);
  };

  const openSelectDropdown = (e: React.MouseEvent, row: DBRow, col: DBColumn) => {
    e.stopPropagation();
    const options = parseOptions(col.options);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setSelectDropdown({ rowId: row.id, colId: col.id, x: rect.left, y: getPopoverY(rect, undefined, 2), options });
  };

  const selectOption = async (rowId: string, colId: string, value: string) => {
    setSelectDropdown(null);
    await api.databases.updateCells(databaseId, rowId, [{ column_id: colId, value }]);
    void reload();
  };

  const clearSelectCell = async (rowId: string, colId: string) => {
    setSelectDropdown(null);
    await api.databases.updateCells(databaseId, rowId, [{ column_id: colId, value: "" }]);
    void reload();
  };

  const toggleHideColumn = async (col: DBColumn) => {
    await api.databases.updateColumn(databaseId, col.id, { ...col, is_hidden: !col.is_hidden });
    void reload();
  };

  const openMultiSelectDropdown = (e: React.MouseEvent, row: DBRow, col: DBColumn) => {
    e.stopPropagation();
    const options = parseOptions(col.options);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMultiSelectDropdown({ rowId: row.id, colId: col.id, x: rect.left, y: getPopoverY(rect, undefined, 2), options });
  };

  const toggleMultiSelectValue = async (rowId: string, colId: string, optValue: string, currentVal: string) => {
    const selected = currentVal ? currentVal.split(",").map(s => s.trim()).filter(Boolean) : [];
    const idx = selected.indexOf(optValue);
    const next = idx >= 0 ? selected.filter(v => v !== optValue) : [...selected, optValue];
    await api.databases.updateCells(databaseId, rowId, [{ column_id: colId, value: next.join(",") }]);
    setRows(rs => rs.map(r => r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: next.join(",") } } : r));
    if (multiSelectDropdown) {
      setMultiSelectDropdown(d => d ? { ...d } : null);
    }
  };

  const startResize = (e: React.MouseEvent, colId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest("th") as HTMLElement;
    const startWidth = th.getBoundingClientRect().width;
    resizingRef.current = { colId, startX: e.clientX, startWidth };
    setResizingColId(colId);

    const onMove = (mv: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = mv.clientX - resizingRef.current.startX;
      const newWidth = Math.max(120, Math.min(400, resizingRef.current.startWidth + delta));
      setColWidths(prev => ({ ...prev, [resizingRef.current!.colId]: newWidth }));
    };
    const onUp = () => {
      resizingRef.current = null;
      setResizingColId(null);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const openRowModal = (row: DBRow) => {
    setRowModal({ row });
    setRowModalDraft({ ...row.cells });
  };

  const saveRowModal = async () => {
    if (!rowModal) return;
    rowContentSaveRef.current?.();
    const skipColIds = new Set(cols.filter(c => c.type === "files" || c.type === "relation" || READONLY_COL_TYPES.has(c.type)).map(c => c.id));
    const cells: DBCell[] = Object.entries(rowModalDraft)
      .filter(([colId]) => !skipColIds.has(colId))
      .map(([colId, value]) => ({ column_id: colId, value }));
    await api.databases.updateCells(databaseId, rowModal.row.id, cells);
    setRowModal(null);
    void reload();
  };

  if (!db) return <div className="db-loading">加载中…</div>;

  const allCols = (db.columns ?? []).slice().sort((a, b) => a.order_index - b.order_index);
  const cols = allCols.filter(c => !c.is_hidden);
  const menuCol = colMenu ? db.columns.find(c => c.id === colMenu.colId) : null;
  const hiddenCount = allCols.filter(c => c.is_hidden).length;
  const selectCols = allCols.filter(c => c.type === "select");
  const activeGroupColId = kanbanGroupColId || selectCols[0]?.id || "";

  const applyFilter = (row: DBRow, f: FilterState): boolean => {
    const val = (row.cells[f.colId] ?? "").toLowerCase();
    const fval = f.val.toLowerCase();
    switch (f.op) {
      case "contains": return val.includes(fval);
      case "not_contains": return !val.includes(fval);
      case "equals": return val === fval;
      case "not_equals": return val !== fval;
      case "is_empty": return val === "";
      case "is_not_empty": return val !== "";
      case "gt": return parseFloat(val) > parseFloat(fval);
      case "lt": return parseFloat(val) < parseFloat(fval);
      default: return true;
    }
  };

  const activeFilters = filterStates.filter(f => f.colId && (f.op === "is_empty" || f.op === "is_not_empty" || f.val !== ""));
  let displayedRows = activeFilters.length > 0
    ? rows.filter(row => activeFilters.every(f => applyFilter(row, f)))
    : rows;

  const activeSorts = sortStates.filter(s => s.colId);
  if (activeSorts.length > 0) {
    displayedRows = [...displayedRows].sort((a, b) => {
      for (const s of activeSorts) {
        const av = a.cells[s.colId] ?? "";
        const bv = b.cells[s.colId] ?? "";
        const cmp = av.localeCompare(bv, undefined, { numeric: true });
        if (cmp !== 0) return s.order === "asc" ? cmp : -cmp;
      }
      return 0;
    });
  }

  return (
    <div className="db-wrap" contentEditable={false}>
      {/* title */}
      <div className="db-title-wrap">
        {titleEditing ? (
          <input
            ref={titleInputRef}
            className="db-title-input"
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={() => void commitTitle()}
            onKeyDown={e => { if (e.key === "Enter") void commitTitle(); if (e.key === "Escape") setTitleEditing(false); }}
          />
        ) : (
          <span className="db-title" onClick={startTitleEdit}>{db.title}</span>
        )}
      </div>

      {error && <div className="db-error">{error}</div>}

      {/* view switcher */}
      <div className="db-view-switcher">
        <button className={`db-view-btn${viewMode === "table" ? " active" : ""}`} onClick={() => setViewMode("table")}><Table size={16} /><span>表格</span></button>
        <button className={`db-view-btn${viewMode === "kanban" ? " active" : ""}`} onClick={() => setViewMode("kanban")}><Columns size={16} /><span>看板</span></button>
        <button className={`db-view-btn${viewMode === "gallery" ? " active" : ""}`} onClick={() => setViewMode("gallery")}><LayoutGrid size={16} /><span>库</span></button>
        <button className={`db-view-btn${viewMode === "list" ? " active" : ""}`} onClick={() => setViewMode("list")}><List size={16} /><span>列表</span></button>
        <button className={`db-view-btn${viewMode === "calendar" ? " active" : ""}`} onClick={() => setViewMode("calendar")}><CalendarDays size={16} /><span>日历</span></button>
        <button className={`db-view-btn${viewMode === "timeline" ? " active" : ""}`} onClick={() => setViewMode("timeline")}><GanttChartSquare size={16} /><span>时间轴</span></button>
      </div>

      {/* toolbar */}
      <div className="db-toolbar">
        <button className={`db-toolbar-btn${toolbarPanel === "filter" ? " active" : ""}${filterStates.length > 0 ? " has-filter" : ""}`}
          onClick={() => setToolbarPanel(p => p === "filter" ? null : "filter")}>
          <Filter size={16} /> 筛选{filterStates.length > 0 && <span className="db-toolbar-badge">{filterStates.length}</span>}
        </button>
        <button className={`db-toolbar-btn${toolbarPanel === "sort" ? " active" : ""}${sortStates.length > 0 ? " has-sort" : ""}`}
          onClick={() => setToolbarPanel(p => p === "sort" ? null : "sort")}>
          <ArrowUpDown size={16} /> 排序{sortStates.length > 0 && <span className="db-toolbar-badge">{sortStates.length}</span>}
        </button>
        <button className={`db-toolbar-btn${toolbarPanel === "hide" ? " active" : ""}`}
          onClick={() => setToolbarPanel(p => p === "hide" ? null : "hide")}>
          <EyeOff size={16} /> 隐藏字段{hiddenCount > 0 ? ` (${hiddenCount})` : ""}
        </button>
        {(viewMode === "table" || viewMode === "list") && (
          <button className={`db-toolbar-btn${toolbarPanel === "group" ? " active" : ""}${groupByColId ? " has-value" : ""}`}
            onClick={() => setToolbarPanel(p => p === "group" ? null : "group")}>
            <Rows size={16} /> 分组{groupByColId ? ` (1)` : ""}
          </button>
        )}
      </div>

      {selectedRowIds.size > 0 && (
        <div className="db-batch-bar">
          <span className="db-batch-count">已选 {selectedRowIds.size} 行</span>
          <button className="db-batch-btn" onClick={() => setBatchPanel(v => !v)}>修改列值</button>
          <button className="db-batch-btn db-batch-danger" onClick={() => void batchDelete()}>删除</button>
          <button className="db-batch-btn" onClick={() => setSelectedRowIds(new Set())}>取消选择</button>
        </div>
      )}
      {batchPanel && selectedRowIds.size > 0 && (
        <div className="db-panel">
          <div className="db-panel-content">
            <div className="db-panel-title">批量修改列值</div>
            <select value={batchColId} onChange={e => setBatchColId(e.target.value)}>
              <option value="">选择列</option>
              {allCols.filter(c => !READONLY_COL_TYPES.has(c.type)).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {batchColId && (
              <input className="db-panel-input" placeholder="新值" value={batchVal}
                onChange={e => setBatchVal(e.target.value)} />
            )}
            <button className="formula-save-btn" onClick={() => void batchUpdateCol()}>应用</button>
            <button className="db-panel-clear" onClick={() => { setBatchPanel(false); setBatchColId(""); setBatchVal(""); }}>取消</button>
          </div>
        </div>
      )}

      {toolbarPanel && (
        <ToolbarPanelView
          toolbarPanel={toolbarPanel}
          allCols={allCols}
          sortStates={sortStates}
          setSortStates={setSortStates}
          filterStates={filterStates}
          setFilterStates={setFilterStates}
          groupByColId={groupByColId}
          setGroupByColId={setGroupByColId}
          toggleHideColumn={toggleHideColumn}
        />
      )}

      {viewMode === "kanban" && (
        selectCols.length === 0 ? (
          <div className="kanban-no-select">请先添加单选列以启用看板视图</div>
        ) : (
          <>
            <div className="kanban-group-select">
              分组列：
              <select value={activeGroupColId} onChange={e => setKanbanGroupColId(e.target.value)}>
                {selectCols.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <KanbanView
              columns={allCols}
              rows={displayedRows}
              groupColId={activeGroupColId}
              onMoveRow={async (rowId, newGroupVal) => {
                const cell: DBCell = { column_id: activeGroupColId, value: newGroupVal };
                await api.databases.updateCells(databaseId, rowId, [cell]);
                void reload();
              }}
            />
          </>
        )
      )}

      {viewMode === "gallery" && (
        <GalleryView
          columns={allCols}
          rows={displayedRows}
          onOpenRow={openRowModal}
        />
      )}

      {viewMode === "calendar" && (
        <CalendarView
          columns={allCols}
          rows={displayedRows}
          onOpenRow={openRowModal}
        />
      )}

      {viewMode === "timeline" && (
        <TimelineView
          columns={allCols}
          rows={displayedRows}
          onOpenRow={openRowModal}
        />
      )}

      {viewMode === "list" && (() => {
        const primaryCol = allCols[0];
        const groupCol = groupByColId ? allCols.find(c => c.id === groupByColId) : null;
        if (!groupCol) {
          return (
            <div className="db-list-view">
              {displayedRows.map(row => (
                <div key={row.id} className="db-list-row" onClick={() => openRowModal(row)}>
                  <span className="db-list-icon"><FileText size={14} /></span>
                  <span className="db-list-title">{primaryCol ? (row.cells[primaryCol.id] || "未命名") : "未命名"}</span>
                </div>
              ))}
              <button className="db-add-row-btn db-list-add" onClick={() => void addRow()}>
                <Plus size={14} /> 新建
              </button>
            </div>
          );
        }
        const groups = new Map<string, DBRow[]>();
        for (const row of displayedRows) {
          const val = row.cells[groupCol.id] || "";
          if (!groups.has(val)) groups.set(val, []);
          groups.get(val)!.push(row);
        }
        const entries = [...groups.entries()].sort(([a], [b]) => (a || "￿").localeCompare(b || "￿"));
        return (
          <div className="db-list-view">
            {entries.map(([groupVal, groupRows]) => (
              <ListGroup key={groupVal || "__empty__"} label={groupVal || "无"} col={groupCol} rows={groupRows}
                primaryCol={primaryCol ?? null} onOpen={openRowModal} onAdd={() => void addRow()} />
            ))}
          </div>
        );
      })()}

      <div className="db-scroll" style={{ display: viewMode === "table" ? undefined : "none" }} >
        <table className="db-table">
          <thead>
            <tr>
              <th className="th-row-actions">
                <input type="checkbox" className="db-row-check"
                  checked={displayedRows.length > 0 && selectedRowIds.size === displayedRows.length}
                  onChange={toggleSelectAll} title="全选" />
              </th>
              {cols.map(col => {
                const relMissing = col.type === "rollup" && parseRollupOpts(col)?.relation_column_id
                  ? rollupRelationMissing(col, allCols) : false;
                const relationTargetDeleted = col.type === "relation"
                  ? deletedTargetDbIds.has(parseRelationOpts(col)?.target_database_id ?? "") : false;
                return (
                  <th key={col.id} className={resizingColId === col.id ? "th-resizing" : undefined} style={{ width: colWidths[col.id] ?? undefined, minWidth: colWidths[col.id] ?? 120, maxWidth: 400 }}>
                    <button className="col-header-btn" onClick={e => openColMenu(e, col)}>
                      <span className="col-icon col-icon-wrap"><ColIcon type={col.type} /></span>
                      <span className="col-name-text">{col.name}</span>
                      {relMissing && <span className="rollup-dep-missing" title="关联列已被删除，汇总列无法计算"> (关联列已删除)</span>}
                      {relationTargetDeleted && <span className="rollup-dep-missing" title="关联的目标数据库已被删除"> (目标已删除)</span>}
                    </button>
                    <div className="col-resize-handle" onMouseDown={e => startResize(e, col.id)} />
                  </th>
                );
              })}
              <th className="col-add-th">
                <button className="col-add-th-btn" onClick={openAddCol} title="添加列"><Plus size={16} /></button>
              </th>
            </tr>
          </thead>
          <tbody>
            {displayedRows.length === 0 && cols.length === 0 && (
              <tr><td colSpan={3} className="db-empty-td">点击右上角 + 添加第一列</td></tr>
            )}
            {(() => {
              const groupCol = groupByColId ? allCols.find(c => c.id === groupByColId) : null;
              if (!groupCol) return displayedRows.map(row => ({ row, groupLabel: null as string | null }));
              const groups = new Map<string, DBRow[]>();
              for (const row of displayedRows) {
                const val = row.cells[groupCol.id] || "";
                if (!groups.has(val)) groups.set(val, []);
                groups.get(val)!.push(row);
              }
              const result: { row: DBRow | null; groupLabel: string | null }[] = [];
              const entries = [...groups.entries()].sort(([a], [b]) => (a || "￿").localeCompare(b || "￿"));
              for (const [val, groupRows] of entries) {
                result.push({ row: null, groupLabel: val || "无" });
                for (const row of groupRows) result.push({ row, groupLabel: null });
              }
              return result;
            })().map((item, idx) => {
              if (item.row === null) {
                const tc = (() => { const gc = groupByColId ? allCols.find(c => c.id === groupByColId) : null; return gc?.type === "select" && item.groupLabel !== "无" ? tagColor(item.groupLabel!) : null; })();
                return (
                  <tr key={`group-${idx}`} className="db-group-header-row">
                    <td colSpan={cols.length + 2} className="db-group-header-td">
                      {tc ? (
                        <span className="cell-tag" style={{ background: tc.bg, color: tc.color }}>{item.groupLabel}</span>
                      ) : (
                        <span className="db-group-label">{item.groupLabel}</span>
                      )}
                    </td>
                  </tr>
                );
              }
              const row = item.row;
              return (
              <tr key={row.id}>
                <td className="td-row-actions">
                  <div className="row-actions-wrap">
                    <input type="checkbox" className="db-row-check"
                      checked={selectedRowIds.has(row.id)}
                      onChange={() => toggleSelectRow(row.id)} />
                    <button className="row-open-btn" onClick={() => openRowModal(row)} title="展开行"><ExternalLink size={14} /></button>
                    <button className="row-dup-btn" onClick={() => void duplicateRow(row)} title="复制行"><Copy size={14} /></button>
                    <button className="row-del-btn" onClick={() => void deleteRow(row.id)} title="删除行"><Trash2 size={14} /></button>
                  </div>
                </td>
                {cols.map(col => {
                  const isEditing = editingCell?.rowId === row.id && editingCell?.colId === col.id;
                  const rollupRelMissing = col.type === "rollup" ? rollupRelationMissing(col, allCols) : false;
                  return (
                    <td key={col.id}>
                      <CellRenderer
                        col={col}
                        row={row}
                        cols={cols}
                        isEditing={isEditing}
                        cellDraft={cellDraft}
                        setCellDraft={setCellDraft}
                        cellInputRef={cellInputRef}
                        startEdit={startEdit}
                        commitEdit={commitEdit}
                        handleCellKeyDown={handleCellKeyDown}
                        toggleCheckbox={toggleCheckbox}
                        openSelectDropdown={openSelectDropdown}
                        openMultiSelectDropdown={openMultiSelectDropdown}
                        parseRelationOpts={parseRelationOpts}
                        relationRowsCache={relationRowsCache}
                        databaseId={databaseId}
                        reload={reload}
                        rollupRelMissing={rollupRelMissing}
                        onTargetDeleted={(targetDbId) => setDeletedTargetDbIds(prev => new Set(prev).add(targetDbId))}
                      />
                    </td>
                  );
                })}
                <td />
              </tr>
              );
            })}
            <tr className="db-add-row-tr">
              <td colSpan={cols.length + 2}>
                <button className="db-add-row-btn" onClick={() => void addRow()}>
                  <Plus size={14} /> 新建
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* column header menu */}
      {colMenu && menuCol && (
        <ColumnHeaderMenu
          colMenu={colMenu}
          menuCol={menuCol}
          renameInputRef={renameInputRef}
          setColMenu={setColMenu}
          closeColMenu={closeColMenu}
          commitRename={commitRename}
          changeColType={changeColType}
          deleteCol={deleteCol}
          openFormulaPopover={openFormulaPopover}
          openRollupPopover={openRollupPopover}
          openSelectOptions={openSelectOptions}
        />
      )}

      {/* formula editor popover */}
      {formulaPopover && db && (
        <FormulaPopoverPanel
          formulaPopover={formulaPopover}
          db={db}
          formulaInputRef={formulaInputRef}
          setFormulaPopover={setFormulaPopover}
          updateFormulaPreview={updateFormulaPreview}
          applyAcItem={applyAcItem}
          saveFormula={saveFormula}
        />
      )}

      {/* select options manager */}
      {selectOptionsPopover && (
        <SelectOptionsPopoverPanel
          selectOptionsPopover={selectOptionsPopover}
          newOptionName={newOptionName}
          setNewOptionName={setNewOptionName}
          setSelectOptionsPopover={setSelectOptionsPopover}
          saveSelectOptions={saveSelectOptions}
          addSelectOption={addSelectOption}
          removeSelectOption={removeSelectOption}
        />
      )}

      {/* select dropdown */}
      {selectDropdown && (
        <>
          <div className="col-menu-overlay" onClick={() => setSelectDropdown(null)} />
          <div className="select-dropdown" style={{ top: selectDropdown.y, left: selectDropdown.x }}>
            {selectDropdown.options.length === 0 ? (
              <div className="select-dd-empty">暂无选项，请从列头菜单添加</div>
            ) : (
              selectDropdown.options.map((opt, idx) => {
                const c = TAG_COLORS[opt.colorIdx % TAG_COLORS.length];
                const currentVal = rows.find(r => r.id === selectDropdown.rowId)?.cells[selectDropdown.colId] ?? "";
                const isSelected = currentVal === opt.value;
                return (
                  <button key={idx} className={`select-dd-item${isSelected ? " selected" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isSelected) {
                        void clearSelectCell(selectDropdown.rowId, selectDropdown.colId);
                      } else {
                        void selectOption(selectDropdown.rowId, selectDropdown.colId, opt.value);
                      }
                    }}>
                    <Chip label={`${isSelected ? "✓ " : ""}${opt.value}`} colors={[{ bg: isSelected ? c.bg : "#f0f0f0", text: isSelected ? c.color : "#6b7280" }]} colorIdx={0} />
                  </button>
                );
              })
            )}
            <div className="col-menu-divider" />
            {selectDropdown.options.length > 0 && (
              <button className="select-dd-item select-dd-clear"
                onClick={(e) => { e.stopPropagation(); void clearSelectCell(selectDropdown.rowId, selectDropdown.colId); }}>
                清除选择
              </button>
            )}
            <button
              className="select-dd-item select-dd-add-option"
              onClick={(e) => {
                e.stopPropagation();
                const col = db!.columns.find(c => c.id === selectDropdown.colId);
                if (col) openSelectOptions(e, col);
              }}
            >
              + 添加选项
            </button>
          </div>
        </>
      )}

      {/* add column popover */}
      {addColPopover && (
        <>
          <div className="add-col-overlay" onClick={() => setAddColPopover(null)} />
          <div className="add-col-popover" style={{ top: addColPopover.y, left: addColPopover.x }}>
            <input
              ref={newColInputRef}
              placeholder="列名"
              value={newColName}
              onChange={e => setNewColName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void submitNewCol(); if (e.key === "Escape") setAddColPopover(null); }}
            />
            <div className="col-type-selector">
              <div className="col-type-trigger" onClick={() => setColTypeOpen(v => !v)}>
                <ColIcon type={newColType} size={14} />
                <span>{newColType}</span>
                <ChevronDown size={12} />
              </div>
              {colTypeOpen && (
                <div className="col-type-dropdown">
                  {COL_TYPES.map(t => (
                    <div
                      key={t}
                      className={`col-type-item${newColType === t ? " selected" : ""}`}
                      onClick={() => {
                        setNewColType(t);
                        setColTypeOpen(false);
                        if (t === "relation") void loadAvailableDatabases();
                      }}
                    >
                      <span className="col-type-icon"><ColIcon type={t} size={16} /></span>
                      <span className="col-type-text">
                        <span className="col-type-name">{t}</span>
                        <span className="col-type-desc">{COL_TYPE_LABELS[t] ?? ""}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {newColType === "relation" && (
              <select
                value={newColRelationDbId}
                onChange={e => setNewColRelationDbId(e.target.value)}
              >
                <option value="">选择目标数据库…</option>
                {availableDatabases.map(d => (
                  <option key={d.id} value={d.id}>{d.title || d.id}</option>
                ))}
              </select>
            )}
            <div className="add-col-actions">
              <button onClick={() => void submitNewCol()}>确认</button>
              <button onClick={() => setAddColPopover(null)}>取消</button>
            </div>
          </div>
        </>
      )}

      {/* rollup config popover (from column header menu) */}
      {rollupPopover && db && (() => {
        const rollupCol = db.columns.find(c => c.id === rollupPopover.colId);
        if (!rollupCol) return null;
        return (
          <RollupConfigPopover
            allColumns={allCols}
            col={rollupCol}
            x={rollupPopover.x}
            y={rollupPopover.y}
            databaseId={databaseId}
            onSave={() => { setRollupPopover(null); void reload(); }}
            onCancel={() => setRollupPopover(null)}
          />
        );
      })()}

      {/* rollup config popover (after new rollup column creation) */}
      {pendingRollupColId && db && (() => {
        const rollupCol = db.columns.find(c => c.id === pendingRollupColId);
        if (!rollupCol) return null;
        const cx = Math.max(0, window.innerWidth / 2 - 160);
        const cy = Math.max(60, window.innerHeight / 3);
        return (
          <RollupConfigPopover
            allColumns={allCols}
            col={rollupCol}
            x={cx}
            y={cy}
            databaseId={databaseId}
            onSave={() => { setPendingRollupColId(null); void reload(); }}
            onCancel={() => setPendingRollupColId(null)}
          />
        );
      })()}

      {/* multi-select dropdown */}
      {multiSelectDropdown && (
        <>
          <div className="col-menu-overlay" onClick={() => setMultiSelectDropdown(null)} />
          <div className="select-dropdown" style={{ top: multiSelectDropdown.y, left: multiSelectDropdown.x }}>
            {multiSelectDropdown.options.length === 0 ? (
              <div className="select-dd-empty">暂无选项，请从列头菜单添加</div>
            ) : (
              multiSelectDropdown.options.map((opt, idx) => {
                const c = TAG_COLORS[opt.colorIdx % TAG_COLORS.length];
                const currentVal = rows.find(r => r.id === multiSelectDropdown.rowId)?.cells[multiSelectDropdown.colId] ?? "";
                const selected = currentVal.split(",").map(s => s.trim()).filter(Boolean);
                const isSelected = selected.includes(opt.value);
                return (
                  <button key={idx} className={`select-dd-item${isSelected ? " selected" : ""}`}
                    onClick={(e) => { e.stopPropagation(); void toggleMultiSelectValue(multiSelectDropdown.rowId, multiSelectDropdown.colId, opt.value, currentVal); }}>
                    <Chip
                      label={`${isSelected ? "✓ " : ""}${opt.value}`}
                      colors={[{ bg: isSelected ? c.bg : "#f0f0f0", text: isSelected ? c.color : "#6b7280" }]}
                      colorIdx={0}
                    />
                  </button>
                );
              })
            )}
            {multiSelectDropdown.options.length > 0 && <div className="col-menu-divider" />}
            {multiSelectDropdown.options.length > 0 && (
              <button className="select-dd-item select-dd-clear"
                onClick={async (e) => {
                  e.stopPropagation();
                  await api.databases.updateCells(databaseId, multiSelectDropdown.rowId, [{ column_id: multiSelectDropdown.colId, value: "" }]);
                  setMultiSelectDropdown(null);
                  void reload();
                }}>
                清除选择
              </button>
            )}
            <button
              className="select-dd-item select-dd-add-option"
              onClick={(e) => {
                e.stopPropagation();
                const col = db!.columns.find(c => c.id === multiSelectDropdown.colId);
                if (col) openSelectOptions(e, col);
              }}
            >
              + 添加选项
            </button>
          </div>
        </>
      )}

      {/* row detail modal */}
      {rowModal && db && (
        <RowModal
          rowModal={rowModal}
          cols={cols}
          rowModalDraft={rowModalDraft}
          setRowModalDraft={setRowModalDraft}
          setRowModal={setRowModal}
          saveRowModal={saveRowModal}
          databaseId={databaseId}
          rowContentSaveRef={rowContentSaveRef}
          parseRelationOpts={parseRelationOpts}
          relationRowsCache={relationRowsCache}
          reload={reload}
          onTargetDeleted={(targetDbId) => setDeletedTargetDbIds(prev => new Set(prev).add(targetDbId))}
        />
      )}
    </div>
  );
}
