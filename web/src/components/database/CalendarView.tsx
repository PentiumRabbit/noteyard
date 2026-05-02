import { useState } from "react";
import type { DBColumn, DBRow } from "../../types";
import "./CalendarView.css";

interface Props {
  columns: DBColumn[];
  rows: DBRow[];
  onOpenRow: (row: DBRow) => void;
}

export function CalendarView({ columns, rows, onOpenRow }: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const dateCols = columns.filter(c => c.type === "date");
  const [dateColId, setDateColId] = useState<string>(dateCols[0]?.id ?? "");
  const primaryCol = columns[0];

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const rowsByDate = new Map<string, DBRow[]>();
  if (dateColId) {
    for (const row of rows) {
      const val = row.cells[dateColId] ?? "";
      if (!val) continue;
      const key = val.slice(0, 10);
      if (!rowsByDate.has(key)) rowsByDate.set(key, []);
      rowsByDate.get(key)!.push(row);
    }
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="cal-wrap">
      <div className="cal-header">
        <button className="cal-nav-btn" onClick={prevMonth}>‹</button>
        <span className="cal-title">{year} 年 {month + 1} 月</span>
        <button className="cal-nav-btn" onClick={nextMonth}>›</button>
        {dateCols.length > 0 && (
          <select className="cal-col-select" value={dateColId} onChange={e => setDateColId(e.target.value)}>
            <option value="">不按日期显示</option>
            {dateCols.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {dateCols.length === 0 && (
          <span className="cal-no-date">请先添加日期列</span>
        )}
      </div>
      <div className="cal-grid">
        {WEEKDAYS.map(d => <div key={d} className="cal-weekday">{d}</div>)}
        {cells.map((day, idx) => {
          if (day === null) return <div key={`empty-${idx}`} className="cal-cell cal-cell-empty" />;
          const key = `${year}-${pad(month + 1)}-${pad(day)}`;
          const dayRows = rowsByDate.get(key) ?? [];
          const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
          return (
            <div key={key} className={`cal-cell${isToday ? " cal-today" : ""}`}>
              <span className="cal-day-num">{day}</span>
              <div className="cal-events">
                {dayRows.slice(0, 3).map(row => (
                  <button key={row.id} className="cal-event" onClick={() => onOpenRow(row)}>
                    {primaryCol ? (row.cells[primaryCol.id] || "未命名") : "未命名"}
                  </button>
                ))}
                {dayRows.length > 3 && (
                  <span className="cal-more">+{dayRows.length - 3} 更多</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
