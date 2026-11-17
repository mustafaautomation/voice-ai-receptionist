/** Accept E.164 or a 10/11 digit US number. Return E.164 or null. */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const compact = trimmed.replace(/[\s().-]/g, "");
  if (/^\+[1-9]\d{9,14}$/.test(compact)) return compact;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
