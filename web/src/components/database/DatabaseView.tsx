import { useCallback, useEffect, useRef, useState } from "react";
import { Type, Hash, CheckSquare, AlignJustify, List, Calendar, Sigma, Link, Mail, Clock, Clock4, Paperclip, Link2, HelpCircle, Table2, Kanban, LayoutGrid, List as ListIcon, CalendarDays, GanttChart, Filter, ArrowUpDown, EyeOff, Layers, Plus, ChevronDown, Phone, User, Circle, GripVertical, X, FileText } from "lucide-react";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteSchema, defaultBlockSpecs, locales } from "@blocknote/core";
import { api } from "../../api/client";
import type { DBCell, DBColumn, DBRow, Database, FileAttachment, RelationColumnOptions, FilterState, SortState } from "../../types";
import { evalFormula } from "./formulaEngine";
import { KanbanView } from "./KanbanView";
import { GalleryView } from "./GalleryView";
import { CalendarView } from "./CalendarView";
import { TimelineView } from "./TimelineView";
import { FilesCell } from "./FilesCell";
import { FilesModalField } from "./FilesModalField";
import { RelationCell } from "./RelationCell";
import { RollupConfigPopover } from "./RollupConfigPopover";
import { ColorDotPicker } from "./ColorDotPicker";
import { Chip } from "./Chip";
import { getPopoverY } from "../../utils/popover";
import "./DatabaseView.css";

function parseFileAttachments(raw: string): FileAttachment[] {
  if (!raw || raw === "[]") return [];
  try {
    return JSON.parse(raw) as FileAttachment[];
  } catch {
    console.warn("FilesCell: invalid JSON in cell", raw);
    return [];
  }
}

interface Props { databaseId: string }

const COL_TYPES: DBColumn["type"][] = ["text", "number", "checkbox", "select", "multi-select", "date", "formula", "url", "email", "created_time", "last_edited_time", "files", "relation", "rollup", "phone", "people", "status"];

const COL_TYPE_LABELS: Record<string, string> = {
  text: "纯文本内容",
  number: "数字、金额、计算",
  checkbox: "勾选 / 布尔值",
  select: "单选标签",
  "multi-select": "多选标签",
  date: "日期和时间",
  formula: "自动计算公式",
  url: "网页链接",
  email: "邮件地址",
  created_time: "自动记录创建时间",
  last_edited_time: "自动记录编辑时间",
  files: "文件和附件",
  relation: "关联其他数据库",
  rollup: "汇总关联列数据",
  phone: "电话",
  people: "人员",
  status: "状态",
};

const COL_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  text: Type,
  number: Hash,
  checkbox: CheckSquare,
  select: AlignJustify,
  "multi-select": List,
  date: Calendar,
  formula: Sigma,
  url: Link,
  email: Mail,
  created_time: Clock,
  last_edited_time: Clock4,
  files: Paperclip,
  relation: Link2,
  rollup: Sigma,
  phone: Phone,
  people: User,
  status: Circle,
};

function ColIcon({ type, size = 14, className }: { type: string; size?: number; className?: string }) {
  const Icon = COL_ICONS[type] ?? HelpCircle;
  return <Icon size={size} className={className} />;
}

const READONLY_COL_TYPES = new Set(["formula", "created_time", "last_edited_time", "rollup"]);

function fmtTimestamp(ts: number | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const TAG_COLORS = [
  { bg: "#f3f0ff", color: "#6e5fd6" },
  { bg: "#e8f4fd", color: "#2383e2" },
  { bg: "#edfaf3", color: "#0f9b5c" },
  { bg: "#fff3e0", color: "#d9730d" },
  { bg: "#fce8e8", color: "#eb5757" },
  { bg: "#f0f0f0", color: "#6b7280" },
  { bg: "#fdf4e3", color: "#b07d28" },
  { bg: "#eef0ff", color: "#4361c2" },
];

function tagColor(val: string) {
  let h = 0;
  for (let i = 0; i < val.length; i++) h = (h * 31 + val.charCodeAt(i)) & 0xffff;
  return TAG_COLORS[h % TAG_COLORS.length];
}


interface ColMenu {
  colId: string;
  x: number;
  y: number;
  renaming: boolean;
  draft: string;
  changingType: boolean;
}

interface AddColPopover { x: number; y: number }
const FORMULA_FUNCTIONS = ["IF", "CONCAT", "ROUND", "ABS", "NOT"];

interface FormulaPopover { colId: string; x: number; y: number; draft: string; preview: string; acItems: string[]; acIndex: number }
interface RollupPopover { colId: string; x: number; y: number }
interface SelectOptionsPopover { colId: string; x: number; y: number; options: SelectOption[] }
interface SelectDropdown { rowId: string; colId: string; x: number; y: number; options: SelectOption[] }
interface RowModal { row: DBRow }
interface SelectOption { value: string; colorIdx: number }
type ToolbarPanel = "sort" | "filter" | "hide" | "group" | null

function parseOptions(raw: string): SelectOption[] {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((item: unknown) => {
      if (typeof item === "string") return { value: item, colorIdx: 0 };
      if (typeof item === "object" && item !== null && "value" in item) {
        const o = item as { value: string; colorIdx?: number };
        return { value: o.value, colorIdx: o.colorIdx ?? 0 };
      }
      return { value: String(item), colorIdx: 0 };
    });
  } catch {
    return [];
  }
}

function serializeOptions(opts: SelectOption[]): string {
  return JSON.stringify(opts);
}

// ── Row content editor schema (basic block types only, no database nesting) ──
const rowContentSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
  },
});

// ── Row content BlockNote editor (isolated from page editor) ──
function RowContentEditor({
  databaseId,
  rowId,
  initialContent,
  onSaveRef,
}: {
  databaseId: string;
  rowId: string;
  initialContent: string;
  onSaveRef: React.MutableRefObject<(() => void) | null>;
}) {
  const editor = useCreateBlockNote({
    schema: rowContentSchema,
    dictionary: locales.zh,
  });

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyRef = useRef(false);

  const doSave = useCallback(() => {
    if (!readyRef.current) return;
    const content = JSON.stringify(editor.document);
    void api.databases.updateRowContent(databaseId, rowId, content);
  }, [databaseId, rowId, editor]);

  // Expose flush function for parent to call on close
  useEffect(() => {
    onSaveRef.current = () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      doSave();
    };
    return () => { onSaveRef.current = null; };
  }, [onSaveRef, doSave]);

  // Initialize editor with content
  useEffect(() => {
    readyRef.current = false;
    let cancelled = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let initialBlocks: any[];
    if (initialContent && initialContent !== "") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        initialBlocks = JSON.parse(initialContent) as any[];
      } catch {
        initialBlocks = [{ type: "paragraph" }];
      }
    } else {
      initialBlocks = [{ type: "paragraph" }];
    }

    setTimeout(() => {
      if (cancelled) return;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.replaceBlocks(editor.document, initialBlocks as any);
      } catch (err) {
        console.error("[RowContentEditor] replaceBlocks failed", err);
      }
      requestAnimationFrame(() => { readyRef.current = true; });
    }, 0);

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowId]);

  const handleChange = () => {
    if (!readyRef.current) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => doSave(), 500);
  };

  return (
    <div className="row-modal-content-editor">
      <BlockNoteView editor={editor} onChange={handleChange} theme="light" />
    </div>
  );
}

// ── Sortable option row for select options popover ──
function SortableOptionRow({
  opt,
  idx,
  onRename,
  onColorChange,
  onDelete,
}: {
  opt: SelectOption;
  idx: number;
  onRename: (idx: number, value: string) => void;
  onColorChange: (idx: number, colorIdx: number) => void;
  onDelete: (idx: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: String(idx) });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const c = TAG_COLORS[opt.colorIdx % TAG_COLORS.length];

  return (
    <div ref={setNodeRef} style={style} className="select-opt-row">
      <button className="select-opt-drag" {...attributes} {...listeners} type="button" tabIndex={-1}>
        <GripVertical size={14} />
      </button>
      <input
        className="select-opt-input"
        style={{ background: c.bg, color: c.color }}
        value={opt.value}
        onChange={e => onRename(idx, e.target.value)}
        onBlur={e => { if (!e.target.value.trim()) onRename(idx, opt.value); }}
      />
      <ColorDotPicker
        colors={TAG_COLORS.map(tc => ({ bg: tc.bg, text: tc.color }))}
        value={opt.colorIdx}
        onChange={ci => onColorChange(idx, ci)}
      />
      <button
        type="button"
        className="select-opt-del-hover"
        onClick={() => onDelete(idx)}
        tabIndex={-1}
      >
        <X size={13} />
      </button>
    </div>
  );
}

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
  const [rowModal, setRowModal] = useState<RowModal | null>(null);
  const [rowModalDraft, setRowModalDraft] = useState<Record<string, string>>({});
  const [newColName, setNewColName] = useState("");
  const [newColType, setNewColType] = useState<DBColumn["type"]>("text");
  const [colTypeOpen, setColTypeOpen] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
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
  // relation column
  const [newColRelationDbId, setNewColRelationDbId] = useState("");
  const [availableDatabases, setAvailableDatabases] = useState<Database[]>([]);
  const relationRowsCache = useRef<Map<string, Map<string, DBRow | null>>>(new Map());
  // rollup new-column pending config popover (shown after column is created)
  const [pendingRollupColId, setPendingRollupColId] = useState<string | null>(null);

  // ── dnd sensors for select options sortable ──
  const selectOptSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const cellInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const newColInputRef = useRef<HTMLInputElement>(null);
  const formulaInputRef = useRef<HTMLTextAreaElement>(null);
  const resizingRef = useRef<{ colId: string; startX: number; startWidth: number } | null>(null);
  // ── row content editor flush ref (populated by RowContentEditor) ──
  const rowContentSaveRef = useRef<(() => void) | null>(null);

  // ── relation helpers ──
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

  const reload = useCallback(async () => {
    const [dbData, rowData] = await Promise.all([
      api.databases.get(databaseId),
      api.databases.listRows(databaseId, {}),
    ]);
    setDb(dbData);
    setRows(rowData ?? []);
  }, [databaseId]);

  useEffect(() => { void reload().catch(() => {}); }, [reload]);

  // ── batch load relation target rows to avoid N+1 ──
  // Use a ref to read the latest rows without making rows a reactive dependency,
  // preventing the setRows(r => [...r]) call from retriggering this effect.
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

        // collect all referenced IDs in this column across all rows
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

  // ── title ──
  const startTitleEdit = () => { setTitleDraft(db?.title ?? ""); setTitleEditing(true); };
  const commitTitle = async () => {
    setTitleEditing(false);
    if (!titleDraft.trim() || titleDraft === db?.title) return;
    await api.databases.updateTitle(databaseId, titleDraft.trim());
    void reload();
  };

  // ── cell edit ──
  const startEdit = (rowId: string, colId: string, val: string) => {
    setEditingCell({ rowId, colId });
    setCellDraft(val);
  };

  const commitEdit = async (rowId: string, colId: string) => {
    setEditingCell(null);
    const cells: DBCell[] = [{ column_id: colId, value: cellDraft }];
    await api.databases.updateCells(databaseId, rowId, cells);
    void reload();
  };

  const toggleCheckbox = async (rowId: string, colId: string, val: string) => {
    await api.databases.updateCells(databaseId, rowId, [{ column_id: colId, value: val === "true" ? "false" : "true" }]);
    void reload();
  };

  // ── keyboard navigation ──
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

  // ── rows ──
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

  // ── column menu ──
  const openColMenu = (e: React.MouseEvent, col: DBColumn) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setColMenu({ colId: col.id, x: rect.left, y: getPopoverY(rect, 200), renaming: false, draft: col.name, changingType: false });
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

  // ── add column ──
  const openAddCol = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setAddColPopover({ x: rect.left, y: getPopoverY(rect, 420) });
    setNewColName("");
    setNewColType("text");
    setNewColRelationDbId("");
    setColTypeOpen(false);
  };

  const loadAvailableDatabases = async () => {
    if (availableDatabases.length > 0) return;
    try {
      // fetch all pages, then for each page get its blocks to find database blocks
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
      // For rollup columns, open config popover after creation
      if (newColType === "rollup" && newCol?.id) {
        setPendingRollupColId(newCol.id);
      }
    } catch (e) { setError((e as Error).message); }
  };

  // ── formula autocomplete helpers ──
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

  // ── formula popover ──
  const openFormulaPopover = (e: React.MouseEvent, col: DBColumn) => {
    const menuEl = (e.currentTarget as HTMLElement).closest(".col-menu");
    const rect = menuEl?.getBoundingClientRect() ?? (e.currentTarget as HTMLElement).getBoundingClientRect();
    const firstRow = rows[0];
    const preview = firstRow ? evalFormula(col.formula, firstRow, db?.columns ?? []) : "";
    setColMenu(null);
    setFormulaPopover({ colId: col.id, x: rect.left, y: rect.bottom + 4, draft: col.formula, preview, acItems: [], acIndex: 0 });
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

  // ── rollup popover ──
  const openRollupPopover = (e: React.MouseEvent, col: DBColumn) => {
    const menuEl = (e.currentTarget as HTMLElement).closest(".col-menu");
    const rect = menuEl?.getBoundingClientRect() ?? (e.currentTarget as HTMLElement).getBoundingClientRect();
    setColMenu(null);
    setRollupPopover({ colId: col.id, x: rect.left, y: getPopoverY(rect, 320) });
  };

  // ── select options management ──
  const openSelectOptions = (e: React.MouseEvent, col: DBColumn) => {
    const menuEl = (e.currentTarget as HTMLElement).closest(".col-menu");
    const rect = menuEl?.getBoundingClientRect() ?? (e.currentTarget as HTMLElement).getBoundingClientRect();
    const options = parseOptions(col.options);
    setColMenu(null);
    setNewOptionName("");
    setSelectOptionsPopover({ colId: col.id, x: rect.left, y: getPopoverY(rect, 280), options });
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

  // ── select dropdown ──
  const openSelectDropdown = (e: React.MouseEvent, row: DBRow, col: DBColumn) => {
    e.stopPropagation();
    const options = parseOptions(col.options);
    if (options.length === 0) {
      // fallback to free input if no options defined
      startEdit(row.id, col.id, row.cells[col.id] ?? "");
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setSelectDropdown({ rowId: row.id, colId: col.id, x: rect.left, y: getPopoverY(rect, 180, 2), options });
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

  // ── hide column ──
  const toggleHideColumn = async (col: DBColumn) => {
    await api.databases.updateColumn(databaseId, col.id, { ...col, is_hidden: !col.is_hidden });
    void reload();
  };

  // ── multi-select ──
  const openMultiSelectDropdown = (e: React.MouseEvent, row: DBRow, col: DBColumn) => {
    e.stopPropagation();
    const options = parseOptions(col.options);
    if (options.length === 0) {
      startEdit(row.id, col.id, row.cells[col.id] ?? "");
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMultiSelectDropdown({ rowId: row.id, colId: col.id, x: rect.left, y: getPopoverY(rect, 180, 2), options });
  };

  const toggleMultiSelectValue = async (rowId: string, colId: string, optValue: string, currentVal: string) => {
    const selected = currentVal ? currentVal.split(",").map(s => s.trim()).filter(Boolean) : [];
    const idx = selected.indexOf(optValue);
    const next = idx >= 0 ? selected.filter(v => v !== optValue) : [...selected, optValue];
    await api.databases.updateCells(databaseId, rowId, [{ column_id: colId, value: next.join(",") }]);
    // update local state immediately for responsiveness
    setRows(rs => rs.map(r => r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: next.join(",") } } : r));
    if (multiSelectDropdown) {
      setMultiSelectDropdown(d => d ? { ...d } : null);
    }
  };

  // ── column resize ──
  const startResize = (e: React.MouseEvent, colId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest("th") as HTMLElement;
    const startWidth = th.getBoundingClientRect().width;
    resizingRef.current = { colId, startX: e.clientX, startWidth };

    const onMove = (mv: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = mv.clientX - resizingRef.current.startX;
      const newWidth = Math.max(80, Math.min(500, resizingRef.current.startWidth + delta));
      setColWidths(prev => ({ ...prev, [resizingRef.current!.colId]: newWidth }));
    };
    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // ── row detail modal ──
  const openRowModal = (row: DBRow) => {
    setRowModal({ row });
    setRowModalDraft({ ...row.cells });
  };

  const saveRowModal = async () => {
    if (!rowModal) return;
    // Flush any pending content editor save before closing
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

  // ── client-side filter (AND) ──
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

  // ── client-side sort ──
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
        <button className={`db-view-btn${viewMode === "table" ? " active" : ""}`} onClick={() => setViewMode("table")}><Table2 size={14} /> 表格</button>
        <button className={`db-view-btn${viewMode === "kanban" ? " active" : ""}`} onClick={() => setViewMode("kanban")}><Kanban size={14} /> 看板</button>
        <button className={`db-view-btn${viewMode === "gallery" ? " active" : ""}`} onClick={() => setViewMode("gallery")}><LayoutGrid size={14} /> 库</button>
        <button className={`db-view-btn${viewMode === "list" ? " active" : ""}`} onClick={() => setViewMode("list")}><ListIcon size={14} /> 列表</button>
        <button className={`db-view-btn${viewMode === "calendar" ? " active" : ""}`} onClick={() => setViewMode("calendar")}><CalendarDays size={14} /> 日历</button>
        <button className={`db-view-btn${viewMode === "timeline" ? " active" : ""}`} onClick={() => setViewMode("timeline")}><GanttChart size={14} /> 时间轴</button>
      </div>

      {/* toolbar */}
      <div className="db-toolbar">
        <button className={`db-toolbar-btn${toolbarPanel === "filter" ? " active" : ""}${filterStates.length > 0 ? " has-value" : ""}`}
          onClick={() => setToolbarPanel(p => p === "filter" ? null : "filter")}>
          <Filter size={14} /> {filterStates.length > 0 ? `筛选 ${filterStates.length}` : "筛选"}
        </button>
        <button className={`db-toolbar-btn${toolbarPanel === "sort" ? " active" : ""}${sortStates.length > 0 ? " has-value" : ""}`}
          onClick={() => setToolbarPanel(p => p === "sort" ? null : "sort")}>
          <ArrowUpDown size={14} /> {sortStates.length > 0 ? `排序 ${sortStates.length}` : "排序"}
        </button>
        <button className={`db-toolbar-btn${toolbarPanel === "hide" ? " active" : ""}`}
          onClick={() => setToolbarPanel(p => p === "hide" ? null : "hide")}>
          <EyeOff size={14} /> 隐藏字段{hiddenCount > 0 ? ` (${hiddenCount})` : ""}
        </button>
        {(viewMode === "table" || viewMode === "list") && (
          <button className={`db-toolbar-btn${toolbarPanel === "group" ? " active" : ""}${groupByColId ? " has-value" : ""}`}
            onClick={() => setToolbarPanel(p => p === "group" ? null : "group")}>
            <Layers size={14} /> 分组{groupByColId ? " ●" : ""}
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
        <div className="db-panel">
          {toolbarPanel === "sort" && (
            <div className="db-panel-list-content">
              <div className="db-panel-title">排序</div>
              {sortStates.map((s) => (
                <div key={s.id} className="db-panel-list-row">
                  <select
                    className="db-panel-list-select"
                    value={s.colId}
                    onChange={e => setSortStates(prev => prev.map(x => x.id === s.id ? { ...x, colId: e.target.value } : x))}>
                    <option value="">选择列</option>
                    {allCols.filter(c => c.type !== "formula").map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    className="db-panel-order-btn"
                    onClick={() => setSortStates(prev => prev.map(x => x.id === s.id ? { ...x, order: x.order === "asc" ? "desc" : "asc" } : x))}>
                    {s.order === "asc" ? "升序 ↑" : "降序 ↓"}
                  </button>
                  <button
                    className="db-panel-row-del"
                    onClick={() => setSortStates(prev => prev.filter(x => x.id !== s.id))}
                    title="删除">
                    <X size={13} />
                  </button>
                </div>
              ))}
              <button
                className="db-panel-add-btn"
                onClick={() => setSortStates(prev => [...prev, { id: crypto.randomUUID(), colId: "", order: "asc" }])}>
                <Plus size={13} /> 添加排序
              </button>
            </div>
          )}
          {toolbarPanel === "filter" && (
            <div className="db-panel-list-content">
              <div className="db-panel-title">筛选</div>
              {filterStates.map((f) => (
                <div key={f.id} className="db-panel-list-row">
                  <select
                    className="db-panel-list-select"
                    value={f.colId}
                    onChange={e => setFilterStates(prev => prev.map(x => x.id === f.id ? { ...x, colId: e.target.value } : x))}>
                    <option value="">选择列</option>
                    {allCols.filter(c => c.type !== "formula" && c.type !== "checkbox").map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <select
                    className="db-panel-list-select"
                    value={f.op}
                    onChange={e => setFilterStates(prev => prev.map(x => x.id === f.id ? { ...x, op: e.target.value } : x))}>
                    <option value="contains">包含</option>
                    <option value="not_contains">不包含</option>
                    <option value="equals">等于</option>
                    <option value="not_equals">不等于</option>
                    <option value="is_empty">为空</option>
                    <option value="is_not_empty">不为空</option>
                    <option value="gt">大于</option>
                    <option value="lt">小于</option>
                  </select>
                  {f.op !== "is_empty" && f.op !== "is_not_empty" && (
                    <input
                      className="db-panel-list-input"
                      placeholder="值"
                      value={f.val}
                      onChange={e => setFilterStates(prev => prev.map(x => x.id === f.id ? { ...x, val: e.target.value } : x))}
                    />
                  )}
                  <button
                    className="db-panel-row-del"
                    onClick={() => setFilterStates(prev => prev.filter(x => x.id !== f.id))}
                    title="删除">
                    <X size={13} />
                  </button>
                </div>
              ))}
              <button
                className="db-panel-add-btn"
                onClick={() => setFilterStates(prev => [...prev, { id: crypto.randomUUID(), colId: "", op: "contains", val: "" }])}>
                <Plus size={13} /> 添加筛选条件
              </button>
            </div>
          )}
          {toolbarPanel === "hide" && (
            <div className="db-panel-content">
              <div className="db-panel-title">隐藏字段</div>
              {allCols.map(col => (
                <label key={col.id} className="db-hide-row">
                  <input type="checkbox" checked={!col.is_hidden}
                    onChange={() => void toggleHideColumn(col)} />
                  <span className="col-icon col-icon-wrap"><ColIcon type={col.type} /></span>
                  {col.name}
                </label>
              ))}
            </div>
          )}
          {toolbarPanel === "group" && (
            <div className="db-panel-list-content">
              <div className="db-panel-title">分组</div>
              <button
                className={`db-group-radio-row${groupByColId === "" ? " selected" : ""}`}
                onClick={() => setGroupByColId("")}>
                <span className="db-group-radio-dot" />
                <span className="db-group-radio-label">无分组</span>
              </button>
              {allCols.filter(c => c.type === "select" || c.type === "checkbox" || c.type === "status").map(c => (
                <button
                  key={c.id}
                  className={`db-group-radio-row${groupByColId === c.id ? " selected" : ""}`}
                  onClick={() => setGroupByColId(c.id)}>
                  <span className="col-icon col-icon-wrap db-group-radio-icon"><ColIcon type={c.type} size={13} /></span>
                  <span className="db-group-radio-label">{c.name}</span>
                  <span className="db-group-radio-dot" />
                </button>
              ))}
            </div>
          )}
        </div>
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
              {cols.map(col => (
                <th key={col.id} style={{ width: colWidths[col.id] ?? undefined, minWidth: colWidths[col.id] ?? 120 }}>
                  <button className="col-header-btn" onClick={e => openColMenu(e, col)}>
                    <span className="col-icon col-icon-wrap"><ColIcon type={col.type} /></span>
                    <span className="col-name-text">{col.name}</span>
                  </button>
                  <div className="col-resize-handle" onMouseDown={e => startResize(e, col.id)} />
                </th>
              ))}
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
                    <button className="row-open-btn" onClick={() => openRowModal(row)} title="展开行">↗</button>
                    <button className="row-dup-btn" onClick={() => void duplicateRow(row)} title="复制行">⊕</button>
                    <button className="row-del-btn" onClick={() => void deleteRow(row.id)} title="删除行">⊖</button>
                  </div>
                </td>
                {cols.map(col => {
                  const val = row.cells[col.id] ?? "";
                  const isEditing = editingCell?.rowId === row.id && editingCell?.colId === col.id;
                  return (
                    <td key={col.id}>
                      {col.type === "rollup" ? (
                        <span className="cell-formula-inner">
                          {val || <span className="cell-empty">—</span>}
                        </span>
                      ) : col.type === "formula" ? (
                        <span className="cell-formula-inner">
                          {(() => { const r = evalFormula(col.formula, row, cols); return r || <span className="cell-empty">—</span>; })()}
                        </span>
                      ) : col.type === "created_time" ? (
                        <span className="cell-time-readonly">{fmtTimestamp(row.created_at)}</span>
                      ) : col.type === "last_edited_time" ? (
                        <span className="cell-time-readonly">{fmtTimestamp(row.updated_at)}</span>
                      ) : col.type === "checkbox" ? (
                        <div className="cell-checkbox">
                          <input type="checkbox" checked={val === "true"} onChange={() => void toggleCheckbox(row.id, col.id, val)} />
                        </div>
                      ) : col.type === "select" ? (
                        <div className="cell-select-wrap" onClick={e => openSelectDropdown(e, row, col)}>
                          {val ? (
                            <Chip label={val} colors={[{ bg: tagColor(val).bg, text: tagColor(val).color }]} colorIdx={0} />
                          ) : (
                            <span className="cell-empty">　</span>
                          )}
                        </div>
                      ) : col.type === "multi-select" ? (
                        <div className="cell-select-wrap" onClick={e => openMultiSelectDropdown(e, row, col)}>
                          {val ? val.split(",").map(s => s.trim()).filter(Boolean).map((v, i) => (
                            <Chip key={i} label={v} colors={[{ bg: tagColor(v).bg, text: tagColor(v).color }]} colorIdx={0} />
                          )) : <span className="cell-empty">　</span>}
                        </div>
                      ) : col.type === "status" ? (
                        <div className="cell-select-wrap" onClick={e => openSelectDropdown(e, row, col)}>
                          {val ? (() => {
                            const opts = parseOptions(col.options);
                            const opt = opts.find(o => o.value === val);
                            const c = opt ? TAG_COLORS[opt.colorIdx % TAG_COLORS.length] : tagColor(val);
                            return <Chip label={val} colors={[{ bg: c.bg, text: c.color }]} colorIdx={0} />;
                          })() : <span className="cell-empty">　</span>}
                        </div>
                      ) : col.type === "phone" ? (
                        isEditing ? (
                          <input ref={cellInputRef} className="cell-input" type="tel" value={cellDraft}
                            onChange={e => setCellDraft(e.target.value)}
                            onBlur={() => void commitEdit(row.id, col.id)}
                            onKeyDown={e => handleCellKeyDown(e, row.id, col.id)} />
                        ) : (
                          <div className="cell-select-wrap" onClick={() => startEdit(row.id, col.id, val)}>
                            {val ? <Chip label={val} href={`tel:${val}`} /> : <span className="cell-empty">　</span>}
                          </div>
                        )
                      ) : col.type === "people" ? (
                        isEditing ? (
                          <input ref={cellInputRef} className="cell-input" type="text" value={cellDraft}
                            onChange={e => setCellDraft(e.target.value)}
                            onBlur={() => void commitEdit(row.id, col.id)}
                            onKeyDown={e => handleCellKeyDown(e, row.id, col.id)} />
                        ) : (
                          <div className="cell-select-wrap" onClick={() => startEdit(row.id, col.id, val)}>
                            {val ? val.split(",").map(s => s.trim()).filter(Boolean).map((name, i) => (
                              <Chip key={i} label={name} />
                            )) : <span className="cell-empty">　</span>}
                          </div>
                        )
                      ) : col.type === "url" ? (
                        isEditing ? (
                          <input ref={cellInputRef} className="cell-input" type="url" value={cellDraft}
                            onChange={e => setCellDraft(e.target.value)}
                            onBlur={() => void commitEdit(row.id, col.id)}
                            onKeyDown={e => handleCellKeyDown(e, row.id, col.id)} />
                        ) : (
                          <span className="cell-url-wrap" onClick={() => startEdit(row.id, col.id, val)}>
                            {val ? <a href={val} target="_blank" rel="noopener noreferrer" className="cell-url-link" onClick={e => e.stopPropagation()}>🔗 {val}</a> : <span className="cell-empty">　</span>}
                          </span>
                        )
                      ) : col.type === "email" ? (
                        isEditing ? (
                          <input ref={cellInputRef} className="cell-input" type="email" value={cellDraft}
                            onChange={e => setCellDraft(e.target.value)}
                            onBlur={() => void commitEdit(row.id, col.id)}
                            onKeyDown={e => handleCellKeyDown(e, row.id, col.id)} />
                        ) : (
                          <span className="cell-url-wrap" onClick={() => startEdit(row.id, col.id, val)}>
                            {val ? <a href={`mailto:${val}`} className="cell-url-link" onClick={e => e.stopPropagation()}>✉ {val}</a> : <span className="cell-empty">　</span>}
                          </span>
                        )
                      ) : col.type === "files" ? (
                        <FilesCell
                          attachments={parseFileAttachments(row.cells[col.id])}
                          onUpdate={(newAttachments) => {
                            void api.databases.updateCells(databaseId, row.id, [{ column_id: col.id, value: JSON.stringify(newAttachments) }]).then(() => void reload());
                          }}
                        />
                      ) : col.type === "relation" ? (
                        <RelationCell
                          column={col}
                          value={val}
                          onChange={(newVal) => {
                            void api.databases.updateCells(databaseId, row.id, [{ column_id: col.id, value: newVal }])
                              .then(() => void reload());
                          }}
                          targetRowsCache={(() => {
                            const opts = parseRelationOpts(col);
                            return opts?.target_database_id ? relationRowsCache.current.get(opts.target_database_id) : undefined;
                          })()}
                        />
                      ) : isEditing ? (
                        <input
                          ref={cellInputRef}
                          className="cell-input"
                          type={col.type === "number" ? "number" : col.type === "date" ? "date" : "text"}
                          value={cellDraft}
                          onChange={e => setCellDraft(e.target.value)}
                          onBlur={() => void commitEdit(row.id, col.id)}
                          onKeyDown={e => handleCellKeyDown(e, row.id, col.id)}
                        />
                      ) : (
                        <span className={`cell-${col.type}-inner`} onClick={() => startEdit(row.id, col.id, val)}>
                          {val || <span className="cell-empty">　</span>}
                        </span>
                      )}
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
        <>
          <div className="col-menu-overlay" onClick={closeColMenu} />
          <div className="col-menu" style={{ top: colMenu.y, left: colMenu.x }}>
            <div className="col-menu-rename">
              <input
                ref={renameInputRef}
                value={colMenu.draft}
                onChange={e => setColMenu(m => m ? { ...m, draft: e.target.value } : m)}
                onKeyDown={e => { if (e.key === "Enter") void commitRename(); if (e.key === "Escape") closeColMenu(); }}
                onBlur={() => void commitRename()}
                placeholder="列名"
              />
            </div>
            <div className="col-menu-divider" />
            <div className="col-menu-type-label">列类型</div>
            {COL_TYPES.map(t => (
              <button key={t} className={`col-menu-type-item${menuCol.type === t ? " active" : ""}`}
                onClick={() => void changeColType(t)}>
                <span className="col-icon-wrap"><ColIcon type={t} /></span>{t}
              </button>
            ))}
            {menuCol.type === "formula" && (
              <>
                <div className="col-menu-divider" />
                <button className="col-menu-formula-btn" onClick={e => openFormulaPopover(e, menuCol)}>ƒ 编辑公式</button>
              </>
            )}
            {menuCol.type === "rollup" && (
              <>
                <div className="col-menu-divider" />
                <button className="col-menu-formula-btn" onClick={e => openRollupPopover(e, menuCol)}>Σ 编辑汇总</button>
              </>
            )}
            {(menuCol.type === "select" || menuCol.type === "multi-select" || menuCol.type === "status") && (
              <>
                <div className="col-menu-divider" />
                <button className="col-menu-formula-btn" onClick={e => openSelectOptions(e, menuCol)}>≡ 管理选项</button>
              </>
            )}
            <div className="col-menu-divider" />
            <button className="col-menu-del-btn" onClick={() => void deleteCol()}>🗑 删除列</button>
          </div>
        </>
      )}

      {/* formula editor popover */}
      {formulaPopover && db && (
        <>
          <div className="formula-overlay" onClick={() => setFormulaPopover(null)} />
          <div className="formula-popover" style={{ top: formulaPopover.y, left: formulaPopover.x }}>
            <div className="formula-popover-title">编辑公式</div>
            <div className="formula-input-wrap">
              <textarea
                ref={formulaInputRef}
                className="formula-input"
                value={formulaPopover.draft}
                onChange={e => updateFormulaPreview(e.target.value)}
                onKeyDown={e => {
                  if (formulaPopover.acItems.length > 0) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setFormulaPopover(p => p ? { ...p, acIndex: (p.acIndex + 1) % p.acItems.length } : p);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setFormulaPopover(p => p ? { ...p, acIndex: (p.acIndex - 1 + p.acItems.length) % p.acItems.length } : p);
                      return;
                    }
                    if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault();
                      applyAcItem(formulaPopover.acItems[formulaPopover.acIndex]);
                      return;
                    }
                  }
                  if (e.key === "Escape") setFormulaPopover(null);
                }}
                placeholder={`prop("列名") + prop("列名")`}
                rows={3}
                spellCheck={false}
              />
              {formulaPopover.acItems.length > 0 && (
                <div className="formula-ac-list">
                  {formulaPopover.acItems.map((item, i) => (
                    <button
                      key={item}
                      className={`formula-ac-item${i === formulaPopover.acIndex ? " active" : ""}`}
                      onMouseDown={e => { e.preventDefault(); applyAcItem(item); }}
                    >
                      <span className="formula-ac-fn">ƒ</span> {item}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="formula-props-label">可引用属性</div>
            <div className="formula-props">
              {db.columns.filter(c => c.type !== "formula").map(c => (
                <button key={c.id} className="formula-prop-chip"
                  onClick={() => {
                    const ins = `prop("${c.name}")`;
                    const next = formulaPopover.draft + ins;
                    updateFormulaPreview(next, []);
                  }}>
                  <ColIcon type={c.type} /> {c.name}
                </button>
              ))}
            </div>
            {formulaPopover.preview !== "" && (
              <div className="formula-preview">
                <span className="formula-preview-label">预览：</span>
                <span className={formulaPopover.preview === "⚠" ? "formula-preview-err" : "formula-preview-val"}>
                  {formulaPopover.preview}
                </span>
              </div>
            )}
            <div className="formula-actions">
              <button className="formula-save-btn" onClick={() => void saveFormula()}>完成</button>
              <button className="formula-cancel-btn" onClick={() => setFormulaPopover(null)}>取消</button>
            </div>
          </div>
        </>
      )}

      {/* select options manager */}
      {selectOptionsPopover && (
        <>
          <div className="formula-overlay" onClick={() => setSelectOptionsPopover(null)} />
          <div className="select-opts-popover" style={{ top: selectOptionsPopover.y, left: selectOptionsPopover.x }}>
            <div className="formula-popover-title">管理选项</div>
            <DndContext
              sensors={selectOptSensors}
              onDragEnd={async (event: DragEndEvent) => {
                const { active, over } = event;
                if (!over || active.id === over.id || !selectOptionsPopover) return;
                const oldIdx = selectOptionsPopover.options.findIndex((_, i) => String(i) === active.id);
                const newIdx = selectOptionsPopover.options.findIndex((_, i) => String(i) === over.id);
                if (oldIdx < 0 || newIdx < 0) return;
                const updated = arrayMove(selectOptionsPopover.options, oldIdx, newIdx);
                setSelectOptionsPopover(p => p ? { ...p, options: updated } : p);
                await saveSelectOptions(selectOptionsPopover.colId, updated);
              }}
            >
              <SortableContext
                items={selectOptionsPopover.options.map((_, i) => String(i))}
                strategy={verticalListSortingStrategy}
              >
                <div className="select-opts-list">
                  {selectOptionsPopover.options.map((opt, idx) => (
                    <SortableOptionRow
                      key={idx}
                      opt={opt}
                      idx={idx}
                      onRename={async (i, value) => {
                        const updated = selectOptionsPopover.options.map((o, oi) => oi === i ? { ...o, value } : o);
                        setSelectOptionsPopover(p => p ? { ...p, options: updated } : p);
                        await saveSelectOptions(selectOptionsPopover.colId, updated);
                      }}
                      onColorChange={async (i, colorIdx) => {
                        const updated = selectOptionsPopover.options.map((o, oi) => oi === i ? { ...o, colorIdx } : o);
                        setSelectOptionsPopover(p => p ? { ...p, options: updated } : p);
                        await saveSelectOptions(selectOptionsPopover.colId, updated);
                      }}
                      onDelete={removeSelectOption}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            <div className="select-opt-add">
              <input
                placeholder="新选项名称"
                value={newOptionName}
                onChange={e => setNewOptionName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void addSelectOption(); }}
              />
              <button onClick={() => void addSelectOption()}>添加</button>
            </div>
          </div>
        </>
      )}

      {/* select dropdown */}
      {selectDropdown && (
        <>
          <div className="col-menu-overlay" onClick={() => setSelectDropdown(null)} />
          <div className="select-dropdown" style={{ top: selectDropdown.y, left: selectDropdown.x }}>
            {selectDropdown.options.map((opt, idx) => {
              const c = TAG_COLORS[opt.colorIdx % TAG_COLORS.length];
              return (
                <button key={idx} className="select-dd-item"
                  onClick={() => void selectOption(selectDropdown.rowId, selectDropdown.colId, opt.value)}>
                  <Chip label={opt.value} colors={[{ bg: c.bg, text: c.color }]} colorIdx={0} />
                </button>
              );
            })}
            <div className="col-menu-divider" />
            <button className="select-dd-item select-dd-clear"
              onClick={() => void clearSelectCell(selectDropdown.rowId, selectDropdown.colId)}>
              清除选择
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
        // Position near center of screen
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
            {multiSelectDropdown.options.map((opt, idx) => {
              const c = TAG_COLORS[opt.colorIdx % TAG_COLORS.length];
              const currentVal = rows.find(r => r.id === multiSelectDropdown.rowId)?.cells[multiSelectDropdown.colId] ?? "";
              const selected = currentVal.split(",").map(s => s.trim()).filter(Boolean);
              const isSelected = selected.includes(opt.value);
              return (
                <button key={idx} className={`select-dd-item${isSelected ? " selected" : ""}`}
                  onClick={() => void toggleMultiSelectValue(multiSelectDropdown.rowId, multiSelectDropdown.colId, opt.value, currentVal)}>
                  <Chip
                    label={`${isSelected ? "✓ " : ""}${opt.value}`}
                    colors={[{ bg: isSelected ? c.bg : "#f0f0f0", text: isSelected ? c.color : "#6b7280" }]}
                    colorIdx={0}
                  />
                </button>
              );
            })}
            <div className="col-menu-divider" />
            <button className="select-dd-item select-dd-clear"
              onClick={async () => {
                await api.databases.updateCells(databaseId, multiSelectDropdown.rowId, [{ column_id: multiSelectDropdown.colId, value: "" }]);
                setMultiSelectDropdown(null);
                void reload();
              }}>
              清除选择
            </button>
          </div>
        </>
      )}

      {/* row detail modal */}
      {rowModal && db && (
        <>
          <div className="row-modal-overlay" onClick={saveRowModal} />
          <div className="row-modal" onClick={e => e.stopPropagation()}>
            <div className="row-modal-header">
              <span className="row-modal-title">行详情</span>
              <button className="row-modal-close" onClick={() => void saveRowModal()}>×</button>
            </div>
            <div className="row-modal-body">
              <RowContentEditor
                databaseId={databaseId}
                rowId={rowModal.row.id}
                initialContent={rowModal.row.content ?? ""}
                onSaveRef={rowContentSaveRef}
              />
              <div className="row-modal-content-divider" />
              {cols.map(col => (
                <div key={col.id} className="row-modal-field">
                  <div className="row-modal-label">
                    <span className="col-icon col-icon-wrap"><ColIcon type={col.type} /></span>
                    {col.name}
                  </div>
                  <div className="row-modal-value">
                    {col.type === "rollup" ? (
                      <span className="cell-formula-inner">{rowModal.row.cells[col.id] || "—"}</span>
                    ) : col.type === "formula" ? (
                      <span className="cell-formula-inner">{evalFormula(col.formula, rowModal.row, cols) || "—"}</span>
                    ) : col.type === "created_time" ? (
                      <span className="cell-time-readonly">{fmtTimestamp(rowModal.row.created_at)}</span>
                    ) : col.type === "last_edited_time" ? (
                      <span className="cell-time-readonly">{fmtTimestamp(rowModal.row.updated_at)}</span>
                    ) : col.type === "url" ? (
                      <div className="row-modal-url-wrap">
                        <input className="row-modal-input" type="url" value={rowModalDraft[col.id] ?? ""}
                          onChange={e => setRowModalDraft(d => ({ ...d, [col.id]: e.target.value }))} placeholder="https://" />
                        {rowModalDraft[col.id] && (
                          <a href={rowModalDraft[col.id]} target="_blank" rel="noopener noreferrer" className="cell-url-link row-modal-url-open">↗</a>
                        )}
                      </div>
                    ) : col.type === "email" ? (
                      <div className="row-modal-url-wrap">
                        <input className="row-modal-input" type="email" value={rowModalDraft[col.id] ?? ""}
                          onChange={e => setRowModalDraft(d => ({ ...d, [col.id]: e.target.value }))} placeholder="name@example.com" />
                        {rowModalDraft[col.id] && (
                          <a href={`mailto:${rowModalDraft[col.id]}`} className="cell-url-link row-modal-url-open">✉</a>
                        )}
                      </div>
                    ) : col.type === "checkbox" ? (
                      <input
                        type="checkbox"
                        checked={rowModalDraft[col.id] === "true"}
                        onChange={e => setRowModalDraft(d => ({ ...d, [col.id]: e.target.checked ? "true" : "false" }))}
                        style={{ accentColor: "#2383e2", width: 15, height: 15 }}
                      />
                    ) : col.type === "select" ? (
                      <select
                        value={rowModalDraft[col.id] ?? ""}
                        onChange={e => setRowModalDraft(d => ({ ...d, [col.id]: e.target.value }))}
                        className="row-modal-select"
                      >
                        <option value="">—</option>
                        {parseOptions(col.options).map((opt, idx) => (
                          <option key={idx} value={opt.value}>{opt.value}</option>
                        ))}
                      </select>
                    ) : col.type === "multi-select" ? (
                      <div className="row-modal-multiselect">
                        {parseOptions(col.options).map((opt, idx) => {
                          const selected = (rowModalDraft[col.id] ?? "").split(",").map(s => s.trim()).filter(Boolean);
                          const isSelected = selected.includes(opt.value);
                          const c = TAG_COLORS[opt.colorIdx % TAG_COLORS.length];
                          return (
                            <button key={idx}
                              className={`cell-tag${isSelected ? " selected" : ""}`}
                              style={{ background: isSelected ? c.bg : "#f0f0f0", color: isSelected ? c.color : "#6b7280", border: isSelected ? `1.5px solid ${c.color}` : "1.5px solid transparent" }}
                              onClick={() => {
                                const next = isSelected ? selected.filter(v => v !== opt.value) : [...selected, opt.value];
                                setRowModalDraft(d => ({ ...d, [col.id]: next.join(",") }));
                              }}>
                              {opt.value}
                            </button>
                          );
                        })}
                      </div>
                    ) : col.type === "status" ? (
                      <div className="row-modal-multiselect">
                        {parseOptions(col.options).map((opt, idx) => {
                          const currentVal = rowModalDraft[col.id] ?? "";
                          const isSelected = currentVal === opt.value;
                          const c = TAG_COLORS[opt.colorIdx % TAG_COLORS.length];
                          return (
                            <button key={idx}
                              className={`cell-tag${isSelected ? " selected" : ""}`}
                              style={{ background: isSelected ? c.bg : "#f0f0f0", color: isSelected ? c.color : "#6b7280", border: isSelected ? `1.5px solid ${c.color}` : "1.5px solid transparent" }}
                              onClick={() => setRowModalDraft(d => ({ ...d, [col.id]: isSelected ? "" : opt.value }))}>
                              {opt.value}
                            </button>
                          );
                        })}
                      </div>
                    ) : col.type === "phone" ? (
                      <div className="row-modal-url-wrap">
                        <input className="row-modal-input" type="tel" value={rowModalDraft[col.id] ?? ""}
                          onChange={e => setRowModalDraft(d => ({ ...d, [col.id]: e.target.value }))} placeholder="+86 138 0000 0000" />
                        {rowModalDraft[col.id] && (
                          <a href={`tel:${rowModalDraft[col.id]}`} className="cell-url-link row-modal-url-open" onClick={e => e.stopPropagation()}>☎</a>
                        )}
                      </div>
                    ) : col.type === "people" ? (
                      <input
                        className="row-modal-input"
                        type="text"
                        value={rowModalDraft[col.id] ?? ""}
                        onChange={e => setRowModalDraft(d => ({ ...d, [col.id]: e.target.value }))}
                        placeholder="张三,李四（逗号分隔）"
                      />
                    ) : col.type === "files" ? (
                      <FilesModalField
                        attachments={parseFileAttachments(rowModal.row.cells[col.id])}
                        onUpdate={(newAtts) => {
                          void api.databases.updateCells(databaseId, rowModal.row.id, [{ column_id: col.id, value: JSON.stringify(newAtts) }])
                            .then(() => {
                              // 同步更新 rowModal.row 的 cells，不走 rowModalDraft
                              setRowModal(m => m ? { row: { ...m.row, cells: { ...m.row.cells, [col.id]: JSON.stringify(newAtts) } } } : null);
                              void reload();
                            });
                        }}
                      />
                    ) : col.type === "relation" ? (
                      <RelationCell
                        column={col}
                        value={rowModal.row.cells[col.id] ?? ""}
                        onChange={(newVal) => {
                          // 即存即存，不走 rowModalDraft
                          void api.databases.updateCells(databaseId, rowModal.row.id, [{ column_id: col.id, value: newVal }])
                            .then(() => {
                              setRowModal(m => m ? { row: { ...m.row, cells: { ...m.row.cells, [col.id]: newVal } } } : null);
                              void reload();
                            });
                        }}
                        targetRowsCache={(() => {
                          const opts = parseRelationOpts(col);
                          return opts?.target_database_id ? relationRowsCache.current.get(opts.target_database_id) : undefined;
                        })()}
                      />
                    ) : (
                      <input
                        className="row-modal-input"
                        type={col.type === "number" ? "number" : col.type === "date" ? "date" : "text"}
                        value={rowModalDraft[col.id] ?? ""}
                        onChange={e => setRowModalDraft(d => ({ ...d, [col.id]: e.target.value }))}
                        placeholder="空"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="row-modal-footer">
              <button className="formula-save-btn" onClick={() => void saveRowModal()}>保存</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
