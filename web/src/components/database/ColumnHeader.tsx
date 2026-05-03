// ColumnHeader.tsx — Column header popover (rename, type change, delete, formula, select options)
import { GripVertical, X, Trash2 } from "lucide-react";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DBColumn, Database } from "../../types";
import { TAG_COLORS } from "./shared";
import type { SelectOption } from "./shared";
import { ColorDotPicker } from "./ColorDotPicker";
import { ColIcon } from "./ColIcon";
import { COL_TYPES } from "./databaseConstants";

// ── Interfaces re-exported so DatabaseView can import them ──
export interface ColMenu {
  colId: string;
  x: number;
  y: number;
  renaming: boolean;
  draft: string;
  changingType: boolean;
}

export interface FormulaPopover {
  colId: string;
  x: number;
  y: number;
  draft: string;
  preview: string;
  acItems: string[];
  acIndex: number;
}

export interface SelectOptionsPopover {
  colId: string;
  x: number;
  y: number;
  options: SelectOption[];
}

// ── Sortable option row for select options popover ──
export function SortableOptionRow({
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

// ── Column header menu ──
interface ColumnHeaderMenuProps {
  colMenu: ColMenu;
  menuCol: DBColumn;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  setColMenu: React.Dispatch<React.SetStateAction<ColMenu | null>>;
  closeColMenu: () => void;
  commitRename: () => void;
  changeColType: (type: DBColumn["type"]) => void;
  deleteCol: () => void;
  openFormulaPopover: (e: React.MouseEvent, col: DBColumn) => void;
  openRollupPopover: (e: React.MouseEvent, col: DBColumn) => void;
  openSelectOptions: (e: React.MouseEvent, col: DBColumn) => void;
}

export function ColumnHeaderMenu({
  colMenu,
  menuCol,
  renameInputRef,
  setColMenu,
  closeColMenu,
  commitRename,
  changeColType,
  deleteCol,
  openFormulaPopover,
  openRollupPopover,
  openSelectOptions,
}: ColumnHeaderMenuProps) {
  return (
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
        <button className="col-menu-del-btn" onClick={() => void deleteCol()}><Trash2 size={14} /> 删除列</button>
      </div>
    </>
  );
}

// ── Formula editor popover ──
interface FormulaPopoverPanelProps {
  formulaPopover: FormulaPopover;
  db: Database;
  formulaInputRef: React.RefObject<HTMLTextAreaElement | null>;
  setFormulaPopover: React.Dispatch<React.SetStateAction<FormulaPopover | null>>;
  updateFormulaPreview: (draft: string, acItems?: string[]) => void;
  applyAcItem: (item: string) => void;
  saveFormula: () => void;
}

export function FormulaPopoverPanel({
  formulaPopover,
  db,
  formulaInputRef,
  setFormulaPopover,
  updateFormulaPreview,
  applyAcItem,
  saveFormula,
}: FormulaPopoverPanelProps) {
  return (
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
  );
}

// ── Select options manager ──
interface SelectOptionsPopoverPanelProps {
  selectOptionsPopover: SelectOptionsPopover;
  newOptionName: string;
  setNewOptionName: React.Dispatch<React.SetStateAction<string>>;
  setSelectOptionsPopover: React.Dispatch<React.SetStateAction<SelectOptionsPopover | null>>;
  saveSelectOptions: (colId: string, options: SelectOption[]) => void;
  addSelectOption: () => void;
  removeSelectOption: (idx: number) => void;
}

export function SelectOptionsPopoverPanel({
  selectOptionsPopover,
  newOptionName,
  setNewOptionName,
  setSelectOptionsPopover,
  saveSelectOptions,
  addSelectOption,
  removeSelectOption,
}: SelectOptionsPopoverPanelProps) {
  const selectOptSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  return (
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
  );
}
