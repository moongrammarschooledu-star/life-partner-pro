import { describe, it, expect } from "vitest";
import { daysInMonth, dobYears, joinDob, splitDob } from "./dob-parts";

describe("date of birth parts", () => {
  it("splits an ISO date and drops leading zeros", () => {
    expect(splitDob("1996-04-09")).toEqual({ y: "1996", m: "4", d: "9" });
    expect(splitDob("")).toBeNull();
    expect(splitDob("09/04/1996")).toBeNull();
    expect(splitDob(null)).toBeNull();
  });

  it("joins the parts into an ISO date once all three are there", () => {
    expect(joinDob({ d: "9", m: "4", y: "1996" })).toBe("1996-04-09");
    expect(joinDob({ d: "31", m: "12", y: "1980" })).toBe("1980-12-31");
  });

  it("gives an empty value while a part is missing", () => {
    expect(joinDob({ d: "9", m: "4" })).toBe("");
    expect(joinDob({ m: "4", y: "1996" })).toBe("");
    expect(joinDob({})).toBe("");
  });

  it("refuses dates that do not exist", () => {
    expect(joinDob({ d: "31", m: "2", y: "1996" })).toBe("");
    expect(joinDob({ d: "30", m: "2", y: "1996" })).toBe("");
    expect(joinDob({ d: "29", m: "2", y: "1997" })).toBe("");
    expect(joinDob({ d: "29", m: "2", y: "1996" })).toBe("1996-02-29");
    expect(joinDob({ d: "0", m: "1", y: "1996" })).toBe("");
    expect(joinDob({ d: "1", m: "13", y: "1996" })).toBe("");
  });

  it("knows month lengths", () => {
    expect(daysInMonth(2, 2000)).toBe(29);
    expect(daysInMonth(2, 1900)).toBe(28);
    expect(daysInMonth(4, 2001)).toBe(30);
    expect(daysInMonth(12, 2001)).toBe(31);
  });

  it("offers adult birth years, newest first", () => {
    const years = dobYears(new Date("2026-10-15T00:00:00Z"));
    expect(years[0]).toBe(2008);
    expect(years[years.length - 1]).toBe(1946);
    expect(years).toEqual([...years].sort((a, b) => b - a));
  });
});
