import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format } from "date-fns"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(val: number | null | undefined) {
  if (val == null) return "$0.00";
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

export function formatCurrencySigned(val: number | null | undefined) {
  if (val == null) return "+$0.00";
  const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(val));
  return val >= 0 ? `+${formatted}` : `-${formatted}`;
}

export function formatNumber(val: number | null | undefined, decimals = 5) {
  if (val == null) return "0".padEnd(decimals + 1, ".0");
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(val);
}

export function formatPercentage(val: number | null | undefined) {
  if (val == null) return "0.00%";
  const formatted = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(val));
  return val >= 0 ? `+${formatted}%` : `-${formatted}%`;
}

export function cnProfitLoss(val: number | null | undefined) {
  if (val == null || val === 0) return "text-muted-foreground";
  return val > 0 ? "text-primary" : "text-destructive";
}

export function formatDateTime(dateString: string | null | undefined) {
  if (!dateString) return "-";
  return format(new Date(dateString), "MMM dd HH:mm:ss");
}

export function formatDateShort(dateString: string | null | undefined) {
  if (!dateString) return "-";
  return format(new Date(dateString), "MM/dd HH:mm");
}
