/** Kenyan mobile numbers compared as 2547… so 0712… and +254712… match. */
export function normalizeKenyanMobile(raw: string): string | null {
  const v = String(raw || "").trim().replace(/\s+/g, "").replace(/^\+/, "");
  if (!v) return null;

  if (/^254\d{9,12}$/.test(v)) return v;
  if (/^0\d{9}$/.test(v)) return `254${v.slice(1)}`;
  if (/^7\d{8}$/.test(v)) return `254${v}`;

  const digits = v.replace(/\D/g, "");
  if (/^254\d{9,12}$/.test(digits)) return digits;
  if (/^0\d{9}$/.test(digits)) return `254${digits.slice(1)}`;

  return null;
}

export function phoneVariants(raw: string): string[] {
  const normalized = normalizeKenyanMobile(raw);
  const trimmed = String(raw || "").trim();
  if (!normalized) return trimmed ? [trimmed] : [];
  const local = normalized.startsWith("254") ? `0${normalized.slice(3)}` : normalized;
  return [...new Set([trimmed, normalized, `+${normalized}`, local].filter(Boolean))];
}
