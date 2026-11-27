import { findUnknownCategoryIds } from "@/utils/category";
import { describe, expect, it } from "vitest";

const own = [
  { id: 1, name: "Food", is_expense: true },
  { id: 2, name: "Salary", is_expense: false },
];

describe("findUnknownCategoryIds", () => {
  it("accepts the user's own categories", () => {
    expect(findUnknownCategoryIds(own, [1, 2, 1])).toEqual([]);
  });

  it("returns each id the user does not own once, in order", () => {
    expect(findUnknownCategoryIds(own, [42, 1, 7, 42])).toEqual([42, 7]);
  });

  it("rejects everything when the user has no categories", () => {
    expect(findUnknownCategoryIds([], [1])).toEqual([1]);
  });
});
