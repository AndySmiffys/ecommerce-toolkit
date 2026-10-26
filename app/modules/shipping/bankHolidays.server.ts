import { isIsoDate } from "./config";

const source = "https://www.gov.uk/bank-holidays.json";

/** Dates from gov.uk's England and Wales list that are today (London) or later. Anything else in the response is ignored. */
export function upcomingBankHolidays(payload: unknown, today: string): string[] {
  const events = (payload as { "england-and-wales"?: { events?: Array<{ date?: unknown }> } } | null)?.["england-and-wales"]?.events;
  if (!Array.isArray(events)) throw new Error("gov.uk sent a bank holiday list in a format the app does not recognise.");
  return events
    .map(event => (typeof event?.date === "string" ? event.date : ""))
    .filter(date => isIsoDate(date) && date >= today)
    .sort();
}

/** Reads gov.uk on the server (never from the shopper's browser). */
export async function fetchUpcomingBankHolidays(today: string, fetcher: typeof fetch = fetch): Promise<string[]> {
  const response = await fetcher(source, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`gov.uk did not answer (${response.status}).`);
  return upcomingBankHolidays(await response.json(), today);
}

export function mergeBankHolidays(existing: string[], imported: string[]) {
  return [...new Set([...existing, ...imported])].sort();
}
