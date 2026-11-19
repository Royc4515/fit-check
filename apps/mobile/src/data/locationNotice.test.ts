import { describe, expect, it } from "vitest";
import { locationNotice, type LocationFacts, type PermissionState } from "./locationNotice";

const facts = (over: Partial<LocationFacts>): LocationFacts => ({ saved: "current", permission: "granted", hasStoredFix: false, ...over });

describe("locationNotice", () => {
  it("says nothing when the saved choice is the default or a city, whatever the permission", () => {
    for (const saved of ["default", "city"] as const) {
      for (const permission of ["granted", "denied", "undetermined", "unknown"] as const) {
        expect(locationNotice(facts({ saved, permission }))).toBe("none");
      }
    }
  });

  it("says so when current is saved and the permission is refused, even with a stored fix", () => {
    expect(locationNotice(facts({ permission: "denied", hasStoredFix: false }))).toBe("noPermission");
    expect(locationNotice(facts({ permission: "denied", hasStoredFix: true }))).toBe("noPermission");
  });

  it("says so when current is saved, the permission was never granted and no position is stored", () => {
    for (const permission of ["undetermined", "unknown"] as PermissionState[]) {
      expect(locationNotice(facts({ permission, hasStoredFix: false }))).toBe("noPermission");
    }
  });

  it("says nothing for a never-asked permission while a stored position exists", () => {
    expect(locationNotice(facts({ permission: "undetermined", hasStoredFix: true }))).toBe("none");
    expect(locationNotice(facts({ permission: "unknown", hasStoredFix: true }))).toBe("none");
  });

  it("says nothing when the permission is granted", () => {
    expect(locationNotice(facts({ permission: "granted", hasStoredFix: false }))).toBe("none");
    expect(locationNotice(facts({ permission: "granted", hasStoredFix: true }))).toBe("none");
  });

  it("says so right after a failed tap, whatever was saved or reported", () => {
    for (const saved of ["default", "city", "current"] as const) {
      for (const permission of ["granted", "denied", "undetermined", "unknown"] as const) {
        expect(locationNotice(facts({ saved, permission, hasStoredFix: true, tapFailed: true }))).toBe("noPermission");
      }
    }
  });

  it("a tap that did not fail changes nothing", () => {
    expect(locationNotice(facts({ saved: "default", tapFailed: false }))).toBe("none");
  });
});
