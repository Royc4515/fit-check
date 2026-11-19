import { describe, expect, it } from "vitest";
import { canSave, changeFor, decideLeave, resolveOpen, storedForm, type OpenText, type TextField } from "./writing";

const open = (field: OpenText["field"], original: string, draft: string): OpenText => ({ field, original, draft });

describe("resolveOpen: an open field on leaving the screen or switching fields", () => {
  it("does nothing when no field is open", () => {
    expect(resolveOpen(null)).toBe("none");
  });

  it("saves a changed, valid value (name, brand, notes)", () => {
    expect(resolveOpen(open("name", "Polo", "Benetton Polo"))).toBe("save");
    expect(resolveOpen(open("brand", "", "Benetton"))).toBe("save");
    expect(resolveOpen(open("notes", "", "dry clean only"))).toBe("save");
  });

  it("saves a cleared brand or note: empty is a valid value there", () => {
    expect(resolveOpen(open("brand", "Gant", "  "))).toBe("save");
    expect(resolveOpen(open("notes", "old note", ""))).toBe("save");
  });

  it("cancels an emptied name instead of saving it", () => {
    expect(resolveOpen(open("name", "Polo", ""))).toBe("cancel");
    expect(resolveOpen(open("name", "Polo", "   \n "))).toBe("cancel");
  });

  it("just closes when nothing changed, including whitespace-only differences", () => {
    expect(resolveOpen(open("name", "Polo", "Polo"))).toBe("close");
    expect(resolveOpen(open("name", "Polo", "  Polo "))).toBe("close");
    expect(resolveOpen(open("notes", "a\nb", "a\nb\n"))).toBe("close");
  });

  it("a line break in a name is a space, so it is not a change on its own", () => {
    expect(resolveOpen(open("name", "Benetton Polo", "Benetton\nPolo"))).toBe("close");
    expect(storedForm("name", "a\r\nb")).toBe("a b");
  });

  it("keeps line breaks inside notes", () => {
    expect(resolveOpen(open("notes", "a b", "a\nb"))).toBe("save");
  });
});

describe("canSave (the save button)", () => {
  it("is off with no change and for an empty name, on otherwise", () => {
    expect(canSave(open("name", "Polo", "Polo"))).toBe(false);
    expect(canSave(open("name", "Polo", ""))).toBe(false);
    expect(canSave(open("name", "Polo", "Polo shirt"))).toBe(true);
    expect(canSave(open("brand", "Gant", ""))).toBe(true);
  });
});

describe("decideLeave: leaving the item screen", () => {
  const base = { open: null, saving: false, failed: [] as TextField[] };
  it("leaves at once when nothing is open, saving or held", () => {
    expect(decideLeave(base)).toEqual({ kind: "leave" });
  });
  it("saves a changed, valid field first", () => {
    const edit = open("name", "Polo", "Polo shirt");
    expect(decideLeave({ ...base, open: edit })).toEqual({ kind: "save-first", edit });
  });
  it("does not block on an unchanged or an invalid (emptied name) field", () => {
    expect(decideLeave({ ...base, open: open("notes", "a", "a") })).toEqual({ kind: "leave" });
    expect(decideLeave({ ...base, open: open("name", "Polo", " ") })).toEqual({ kind: "leave" });
  });
  it("waits for a save already on its way instead of writing again", () => {
    expect(decideLeave({ ...base, saving: true, open: open("name", "Polo", "Polo shirt") })).toEqual({ kind: "wait" });
  });
  it("stays on a failed save whose text is held while its field is closed", () => {
    expect(decideLeave({ ...base, failed: ["brand"] })).toEqual({ kind: "stay", field: "brand" });
  });
  it("saves a changed open field before reopening a held failure", () => {
    const edit = open("notes", "", "x");
    expect(decideLeave({ ...base, open: edit, failed: ["brand"] })).toEqual({ kind: "save-first", edit });
  });
  it("the open field's own failure is decided by the open field", () => {
    expect(decideLeave({ ...base, open: open("name", "Polo", "Polo shirt"), failed: ["name"] }).kind).toBe("save-first");
    expect(decideLeave({ ...base, open: open("name", "Polo", "Polo"), failed: ["name"] })).toEqual({ kind: "leave" });
  });
});

describe("changeFor", () => {
  it("never sends a line break in a name or brand", () => {
    expect(changeFor("name", "a\nb")).toEqual({ name: "a b" });
    expect(changeFor("brand", "x\ny")).toEqual({ brand: "x y" });
    expect(changeFor("notes", "x\ny")).toEqual({ notes: "x\ny" });
  });
});
