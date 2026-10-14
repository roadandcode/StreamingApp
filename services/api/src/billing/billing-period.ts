import type { BillingPeriod } from '../database/schema';

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Adds calendar months in UTC, clamping to the last day of the target month (Jan 31 + 1M = Feb 28/29). */
export function addUtcMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const day = Math.min(date.getUTCDate(), daysInUtcMonth(targetYear, targetMonth));
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

/** End of one billing period (ISO-8601 duration P1M or P1Y) starting at `from`. */
export function addBillingPeriod(from: Date, period: BillingPeriod): Date {
  return addUtcMonths(from, period === 'P1Y' ? 12 : 1);
}
