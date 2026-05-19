import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string) {
  const parsedDate = parseDate(date);

  if (!parsedDate) {
    return "Recently";
  }

  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(parsedDate);
}

function parseDate(value: string) {
  if (!value) return null;

  const isoDate = new Date(value);
  if (Number.isFinite(isoDate.getTime())) return isoDate;

  const [year, month, day] = value.split("-").map(Number);
  const localDate = new Date(year, month - 1, day);

  return Number.isFinite(localDate.getTime()) ? localDate : null;
}
