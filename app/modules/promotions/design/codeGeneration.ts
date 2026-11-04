export type CodeOptions = { codeMode?: "single" | "bulk"; codeCount?: string; codePrefix?: string; codeSuffix?: string; codeListTitle?: string };
export type CodeBatchSummary = { id: string; reconciling?: boolean; total: number; confirmed: number; status: string; error: string | null; prefix: string; suffix: string; title: string };
export function normalizeSharedCode(code: string): string {
  const value = typeof code === "string" ? code.trim().toUpperCase() : "";
  if (!value || value.length > 255 || /\s/.test(value) || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error("Enter a discount code of up to 255 characters, without spaces.");
  return value;
}
export function validateCodeOptions(options: CodeOptions) {
  if (options.codeMode !== undefined && options.codeMode !== "single" && options.codeMode !== "bulk") throw new Error("Choose one shared code or a generated code list.");
  const count = Number(options.codeCount);
  if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error("Enter a whole number of codes from 1 to 10,000.");
  const prefix = String(options.codePrefix ?? "").trim().toUpperCase();
  const suffix = String(options.codeSuffix ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{0,32}$/.test(prefix) || !/^[A-Z0-9_-]{0,32}$/.test(suffix)) throw new Error("Prefixes and suffixes can contain up to 32 letters, numbers, hyphens or underscores each.");
  const title = String(options.codeListTitle ?? "").trim();
  if (!title || title.length > 255) throw new Error("Enter a name for the code list (up to 255 characters).");
  return { count, prefix, suffix, title };
}
export function codesCsv(codes: string[]): string {
  return "Code\r\n" + codes.map(code => `"${code.replace(/"/g, '""')}"`).join("\r\n") + "\r\n";
}
