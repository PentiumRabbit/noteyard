import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DBColumn, DBRow } from "../../types";
import "./KanbanView.css";

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

interface SelectOption { value: string; colorIdx: number }

function parseOptions(raw: string): SelectOption[] {
  try {
    const arr = JSON.parse(raw ?? "[]");
    if (!Array.isArray(arr)) return [];
    return arr.map((item: unknown) => {
      if (typeof item === "string") return { value: item, colorIdx: 0 };
      const o = item as { value: string; colorIdx?: number };
      return { value: o.value, colorIdx: o.colorIdx ?? 0 };
    });
  } catch { return []; }
}

interface Props {
  columns: DBColumn[];
  rows: DBRow[];
  groupColId: string;
  onMoveRow: (rowId: string, newGroupVal: string) => void;
}

function KanbanCard({ row, titleCol }: { row: DBRow; titleCol: DBColumn | undefined }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const title = titleCol ? (row.cells?.[titleCol.id] ?? "") : "";
  return (
    <div ref={setNodeRef} style={style} className="kanban-card" {...attributes} {...listeners}>
      <span className="kanban-card-title">{title || "Untitled"}</span>
    </div>
  );
}

export function KanbanView({ columns, rows, groupColId, onMoveRow }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const groupCol = columns.find(c => c.id === groupColId);
  const titleCol = columns[0];

  const parsedOptions = parseOptions(groupCol?.options ?? "[]");
  const groups = ["", ...parsedOptions.map(o => o.value)];

  const optionColorMap = new Map(parsedOptions.map(o => [o.value, TAG_COLORS[o.colorIdx % TAG_COLORS.length]]));

  const rowsByGroup = (g: string) =>
    rows
      .filter(r => (r.cells?.[groupColId] ?? "") === g)
      .sort((a, b) => a.order_index - b.order_index);

  const activeRow = activeId ? rows.find(r => r.id === activeId) : null;
  const activeCellTitle = activeRow && titleCol ? (activeRow.cells?.[titleCol.id] ?? "") : "";

  const handleDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const overId = String(over.id);
    const isGroup = overId.startsWith("group:");
    if (isGroup) {
      onMoveRow(String(active.id), overId.slice(6));
    } else {
      const overRow = rows.find(r => r.id === overId);
      if (overRow) {
        onMoveRow(String(active.id), overRow.cells?.[groupColId] ?? "");
      }
    }
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="kanban-board">
        {groups.map(g => {
          const groupRows = rowsByGroup(g);
          const tagColor = g ? optionColorMap.get(g) : undefined;
          const labelStyle = tagColor
            ? { background: tagColor.bg, color: tagColor.color }
            : undefined;
          return (
            <div key={g} className="kanban-col">
              <div className="kanban-col-header">
                <span className="kanban-col-label" style={labelStyle}>{g || "未分组"}</span>
                <span className="kanban-col-count">{groupRows.length}</span>
              </div>
              <SortableContext items={groupRows.map(r => r.id)} strategy={verticalListSortingStrategy}>
                <div className="kanban-col-body" id={`group:${g}`}>
                  {groupRows.map(row => (
                    <KanbanCard key={row.id} row={row} titleCol={titleCol} />
                  ))}
                </div>
              </SortableContext>
            </div>
          );
        })}
      </div>
      <DragOverlay>
        {activeId && (
          <div className="kanban-card kanban-card-overlay">
            <span className="kanban-card-title">{activeCellTitle || "Untitled"}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
