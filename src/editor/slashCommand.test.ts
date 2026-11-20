import { describe, expect, it } from "vitest";
import { slashCommand } from "./predictor";

describe("/ 命令", () => {
  it("行首或空白後的 / 加英文字母", () => {
    expect(slashCommand("/")).toBe(true);
    expect(slashCommand("/hea")).toBe(true);
    expect(slashCommand("今天 /to")).toBe(true);
    expect(slashCommand("和/或")).toBe(false);
    expect(slashCommand("/to do")).toBe(false);
    expect(slashCommand("a/b")).toBe(false);
  });
});
