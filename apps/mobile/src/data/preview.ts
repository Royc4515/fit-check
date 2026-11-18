import { parseDesignPreviewSnapshot, type DesignPreviewSnapshot } from "@fit-check/schema";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Platform } from "react-native";
import { supabase } from "../lib/supabase";

/**
 * TEMPORARY (Roy, 2026-11-18; the server stops answering after 2026-11-25T16:00:00Z): read-only design preview on
 * web. Opening any URL with `?preview=<code>` shows Roy's real wardrobe without a Google sign-in, so a designer can
 * look at the live app. Reads come from one snapshot (Edge Function `design-preview`); every write and paid call is
 * blocked in the data layer. Never active on native. Remove with the function (CHANGELOG 2026-11-18).
 */

// don't touch / must equal OWNER in supabase/functions/design-preview/index.ts; getSnapshot() checks it.
export const PREVIEW_OWNER = "f797bc43-e210-4f93-891d-a7616643a0d8";

const STORAGE_KEY = "fitcheck:design-preview";
const PARAM = "preview";

let code: string | null | undefined;
let snapshot: Promise<DesignPreviewSnapshot> | null = null;

/**
 * Takes the code from `?preview=` into sessionStorage (so it survives in-app navigation and reloads of this tab,
 * and dies with the tab) and strips it from the address bar, so a screenshot or a copied link does not carry it.
 */
function readCode(): string | null {
  // typeof window: the static web export renders on a server, where there is no URL and no storage.
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get(PARAM);
    if (fromUrl) {
      window.sessionStorage.setItem(STORAGE_KEY, fromUrl);
      url.searchParams.delete(PARAM);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Blocked storage: no preview, the normal app.
    return null;
  }
}

/** True in a web tab that was opened with `?preview=<code>`. Always false on native. Read once per page load. */
export function isPreview(): boolean {
  if (code === undefined) code = readCode();
  return code !== null;
}

/**
 * The owner's snapshot, fetched once per page load and kept in memory only (never in local storage, so nothing of
 * the wardrobe outlives the tab). Rejects on a wrong or expired code, and then forgets the code, so the next reload
 * is the normal sign-in instead of a dead preview. A failed fetch is not cached: the screen's retry fetches again.
 */
export function getSnapshot(): Promise<DesignPreviewSnapshot> {
  if (!isPreview() || !code) return Promise.reject(new Error("not in preview mode"));
  if (!snapshot) {
    const body = { code };
    snapshot = (async () => {
      const { data, error } = await supabase.functions.invoke("design-preview", { body });
      if (error) {
        const res: Response | undefined = error instanceof FunctionsHttpError ? error.context : undefined;
        const status = res?.status ?? 0;
        if (status === 401 || status === 410) forgetCode();
        throw new Error(`design preview unavailable (${status || error.message})`);
      }
      const parsed = parseDesignPreviewSnapshot(data);
      if (!parsed || parsed.owner !== PREVIEW_OWNER) throw new Error("design preview: unexpected response");
      return parsed;
    })();
    snapshot.catch(() => {
      snapshot = null;
    });
  }
  return snapshot;
}

function forgetCode() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the code was never stored either.
  }
}

/**
 * The error every blocked write throws in preview. The screens already handle a failed write (they roll back and say
 * it did not save), which is the honest answer here: nothing is saved.
 */
export class PreviewReadOnlyError extends Error {
  constructor(what: string) {
    super(`design preview is read-only: ${what} was not sent`);
    this.name = "PreviewReadOnlyError";
  }
}
