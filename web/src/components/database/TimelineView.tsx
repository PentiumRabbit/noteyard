import { useState } from "react";
import type { DBColumn, DBRow } from "../../types";
import "./TimelineView.css";

interface Props {
  columns: DBColumn[];
  rows: DBRow[];
  onOpenRow: (row: DBRow) => void;
}

type Granularity = "month" | "week";

export function TimelineView({ columns, rows, onOpenRow }: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [granularity, setGranularity] = useState<Granularity>("month");

  const dateCols = columns.filter(c => c.type === "date");
  const [dateColId, setDateColId] = useState<string>(dateCols[0]?.id ?? "");
  const primaryCol = columns[0];

  const prevPeriod = () => {
    if (granularity === "month") {
      if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1);
    } else {
      const d = new Date(year, month, 1);
      d.setDate(d.getDate() - 7);
      setYear(d.getFullYear()); setMonth(d.getMonth());
    }
  };
  const nextPeriod = () => {
    if (granularity === "month") {
      if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1);
    } else {
      const d = new Date(year, month, 1);
      d.setDate(d.getDate() + 7);
      setYear(d.getFullYear()); setMonth(d.getMonth());
    }
  };

  const pad = (n: number) => String(n).padStart(2, "0");

  // Determine visible date range
  let startDate: Date, endDate: Date, days: Date[];
  if (granularity === "month") {
    startDate = new Date(year, month, 1);
    endDate = new Date(year, month + 1, 0);
  } else {
    // start from Monday of the current week containing (year, month, 1)
    const ref = new Date(year, month, 1);
    const dow = (ref.getDay() + 6) % 7; // Monday=0
    startDate = new Date(ref); startDate.setDate(ref.getDate() - dow);
    endDate = new Date(startDate); endDate.setDate(startDate.getDate() + 6);
  }

  days = [];
  const cur = new Date(startDate);
  while (cur <= endDate) { days.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }

  const dayWidth = granularity === "month" ? 36 : 100;

  // Filter rows that have a date in range
  const rowsWithDate = dateColId
    ? rows.filter(r => {
        const v = r.cells[dateColId];
        if (!v) return false;
        const d = new Date(v);
        return d >= startDate && d <= endDate;
      })
    : [];

  const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  return (
    <div className="tl-wrap">
      <div className="tl-header">
        <button className="cal-nav-btn" onClick={prevPeriod}>‹</button>
        <span className="cal-title">
          {granularity === "month"
            ? `${year} 年 ${month + 1} 月`
            : `${dateKey(startDate)} — ${dateKey(endDate)}`}
        </span>
        <button className="cal-nav-btn" onClick={nextPeriod}>›</button>
        <div className="tl-granularity">
          <button className={`db-view-btn${granularity === "month" ? " active" : ""}`} onClick={() => setGranularity("month")}>月</button>
          <button className={`db-view-btn${granularity === "week" ? " active" : ""}`} onClick={() => setGranularity("week")}>周</button>
        </div>
        {dateCols.length > 0 && (
          <select className="cal-col-select" value={dateColId} onChange={e => setDateColId(e.target.value)}>
            <option value="">选择日期列</option>
            {dateCols.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {dateCols.length === 0 && <span className="cal-no-date">请先添加日期列</span>}
      </div>

      <div className="tl-scroll">
        {/* date header */}
        <div className="tl-date-row" style={{ width: days.length * dayWidth }}>
          {days.map(d => {
            const isToday = dateKey(d) === dateKey(today);
            return (
              <div key={dateKey(d)} className={`tl-date-cell${isToday ? " tl-today" : ""}`} style={{ width: dayWidth }}>
                <span className="tl-date-num">{d.getDate()}</span>
                {granularity === "week" && <span className="tl-date-dow">{["一","二","三","四","五","六","日"][(d.getDay() + 6) % 7]}</span>}
              </div>
            );
          })}
        </div>

        {/* today line */}
        {(() => {
          const todayIdx = days.findIndex(d => dateKey(d) === dateKey(today));
          if (todayIdx < 0) return null;
          return <div className="tl-today-line" style={{ left: todayIdx * dayWidth + dayWidth / 2 }} />;
        })()}

        {/* rows */}
        <div className="tl-rows" style={{ width: days.length * dayWidth }}>
          {dateCols.length === 0 || !dateColId ? (
            <div className="tl-empty">请选择日期列以显示时间轴</div>
          ) : rowsWithDate.length === 0 ? (
            <div className="tl-empty">该时间段内无数据</div>
          ) : rowsWithDate.map(row => {
            const val = row.cells[dateColId];
            const d = new Date(val);
            const idx = days.findIndex(dd => dateKey(dd) === val.slice(0, 10));
            if (idx < 0) return null;
            const title = primaryCol ? (row.cells[primaryCol.id] || "未命名") : "未命名";
            return (
              <div key={row.id} className="tl-row">
                <div className="tl-bar-wrap">
                  <button
                    className="tl-bar"
                    style={{ left: idx * dayWidth, width: Math.max(dayWidth, 80) }}
                    onClick={() => onOpenRow(row)}
                    title={`${title} — ${val}`}
                  >
                    {title}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
