import { useState } from "react";

export interface UseMonthNavResult {
  year: number;
  month: number;
  prevMonth: () => void;
  nextMonth: () => void;
}

/**
 * Manages year/month navigation state with prevMonth/nextMonth helpers.
 * Accepts optional initial values so callers can pass test-friendly dates
 * without hard-coding `new Date()` in the hook.
 */
export function useMonthNav(
  initialYear?: number,
  initialMonth?: number,
): UseMonthNavResult {
  const today = new Date();
  const [year, setYear] = useState(initialYear ?? today.getFullYear());
  const [month, setMonth] = useState(initialMonth ?? today.getMonth());

  const prevMonth = () => {
    if (month === 0) {
      setYear(y => y - 1);
      setMonth(11);
    } else {
      setMonth(m => m - 1);
    }
  };

  const nextMonth = () => {
    if (month === 11) {
      setYear(y => y + 1);
      setMonth(0);
    } else {
      setMonth(m => m + 1);
    }
  };

  return { year, month, prevMonth, nextMonth };
}
