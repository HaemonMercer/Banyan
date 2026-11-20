import { describe, expect, it } from "vitest";
import { filterBlockTypes } from "../editor/blockTypes";
import { collectTemplates, expandTemplate, isTemplatePage, templateLabel, templateNameFor } from "./templates";

describe("頁面範本", () => {
  it("名稱是 Template/… 的頁面才是範本（不分大小寫）", () => {
    expect(isTemplatePage("Template/Meeting")).toBe(true);
    expect(isTemplatePage("template/meeting")).toBe(true);
    expect(isTemplatePage("Template/")).toBe(false);
    expect(isTemplatePage("Templates")).toBe(false);
    expect(templateLabel("Template/ Weekly review")).toBe("Weekly review");
  });

  it("收集有內容的範本，依名稱排序", () => {
    const list = collectTemplates({ "Template/b": "B", "Template/a": "A", "Template/empty": "  ", Notes: "x" });
    expect(list.map((t) => t.label)).toEqual(["a", "b"]);
  });

  it("另存成範本時名稱不重複", () => {
    expect(templateNameFor("Meeting", [])).toBe("Template/Meeting");
    expect(templateNameFor("Meeting", ["template/meeting", "Template/Meeting 2"])).toBe("Template/Meeting 3");
  });

  it("換掉變數，不認得的留著，去掉頭尾空行", () => {
    const now = new Date(2026, 10, 19, 9, 5);
    const out = expandTemplate("\n\n# {{title}}\n{{date}} {{weekday}} {{ TIME }} {{month}} {{year}} {{nope}}\n\n", {
      date: "2026-11-18",
      title: "Standup",
      now,
    });
    expect(out).toBe("# Standup\n[[2026-11-18]] Wednesday 09:05 November 2026 {{nope}}");
    expect(expandTemplate("{{today}} / {{title}}", { date: "2026-11-18" })).toBe("Nov 18, 2026 / Nov 18, 2026");
  });

  it("斜線選單列出範本；沒有範本時有一個說明項目", () => {
    const tpl = [{ page: "Template/Meeting notes", label: "Meeting notes" }];
    expect(filterBlockTypes("meet", tpl).map((i) => i.template)).toEqual(["Template/Meeting notes"]);
    const none = filterBlockTypes("template");
    expect(none).toHaveLength(1);
    expect(none[0].template).toBe("");
  });
});
