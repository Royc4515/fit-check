/** Rows PostgREST returns at most per request (its default `max_rows`; `supabase/config.toml` does not raise it). */
export const PAGE_SIZE = 1000;
/** Pages read before giving up: 20,000 rows, far above a month of one user's AI calls. */
export const MAX_PAGES = 20;

/**
 * Reads every row of a query by paging, because PostgREST silently truncates one response to its max_rows (a
 * `.limit(20_000)` still returns 1,000). Asks for [0, 999], [1000, 1999], ... until a page comes back shorter than
 * `pageSize`; a page of exactly `pageSize` rows means "there may be more", so one more is asked for.
 * Pure: the fetcher is an argument, so the pager is checked against a fake.
 * @param fetchPage - rows `from`..`to` inclusive (the `.range()` arguments); must use a stable order, or pages can
 * overlap or skip. Throws on a network or permission error, which is passed on.
 * @returns the rows, and `partial: true` when `maxPages` full pages were read and the data may go on: the caller
 * must then say the total is partial instead of presenting it as complete.
 */
export async function readAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<readonly T[]>,
  pageSize = PAGE_SIZE,
  maxPages = MAX_PAGES
): Promise<{ rows: T[]; partial: boolean }> {
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const chunk = await fetchPage(page * pageSize, page * pageSize + pageSize - 1);
    rows.push(...chunk);
    if (chunk.length < pageSize) return { rows, partial: false };
  }
  // don't touch / reached only after maxPages full pages: the last one was full, so the table may hold more. (A table
  // of exactly maxPages * pageSize rows is also reported partial; the pager cannot tell without one more read.)
  return { rows, partial: true };
}
