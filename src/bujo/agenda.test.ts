import { describe, expect, it } from "vitest";
import { agendaFor, collectAll } from "./agenda";

const journals = {
  "2026-11-16": [
    "- [ ] 過期任務",
    "- [x] 做完了",
    "- [<] 交報告 [[2026-11-20]]",
    "- [o] 15:00 看牙醫 [[2026-11-20]]",
    "- [<] 排到昨天 [[2026-11-17]]",
    "- [x] 排程後做完 [[2026-11-20]]",
  ].join("\n"),
  "2026-11-18": "- [ ] 今天寫的",
  "2026-11-20": "- [<] 那天自己寫的 [[2026-11-20]]",
};
const pages = { 專案: "- [<] 09:00 開會 [[2026-11-20]]\n- [ ] 頁面裡沒日期" };
const now = "2026-11-18";
const titles = (xs: { title: string }[]) => xs.map((x) => x.title);

describe("agendaFor", () => {
  const all = collectAll(journals, pages);

  it("排到這天、寫在別處的項目（含頁面），依時間排；完成的也列出", () => {
    const { scheduled, overdue } = agendaFor(all, "2026-11-20", now);
    expect(titles(scheduled)).toEqual(["交報告", "排程後做完", "開會", "看牙醫"]);
    expect(scheduled.find((t) => t.title === "開會")).toMatchObject({ kind: "page", key: "專案", due: "2026-11-20" });
    expect(overdue).toEqual([]);
  });

  it("今天列出過期的：未完成的舊任務，與排程日期已過的", () => {
    expect(titles(agendaFor(all, now, now).overdue)).toEqual(["過期任務", "排到昨天"]);
  });

  it("寫在這天日記裡的不重複列出", () => {
    expect(titles(agendaFor(all, "2026-11-18", now).scheduled)).toEqual([]);
  });

  it("內容沒變就用快取", () => {
    expect(collectAll(journals, pages)[0]).toBe(all[0]);
  });
});
