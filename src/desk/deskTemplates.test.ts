import { describe, expect, it } from "vitest";
import { FILE_TEMPLATES, fileFromTemplate, templateOfFile } from "./deskTemplates";
import { parseFile, serializeFile } from "./file";

describe("Desk 檔案範本", () => {
  it("每個內建範本都做得出讀得回來的檔案", () => {
    expect(FILE_TEMPLATES[0].id).toBe("blank");
    for (const t of FILE_TEMPLATES) {
      const f = parseFile(fileFromTemplate(t.id));
      expect(f).toEqual(parseFile(serializeFile(f)));
    }
  });

  it("Project：三欄看板＋簡介與任務表", () => {
    const f = parseFile(fileFromTemplate("project"));
    expect(f.board.sections.map((s) => s.title).sort()).toEqual(["Doing", "Done", "To do"]);
    expect(f.board.cards.length).toBe(4);
    expect(f.docs.map((d) => [d.kind, d.title])).toEqual([
      ["word", "Project brief"],
      ["sheet", "Tasks"],
    ]);
  });

  it("Research 放一張心智圖，Presentation 的便利貼依序連起來", () => {
    expect(parseFile(fileFromTemplate("research")).board.maps).toHaveLength(1);
    const p = parseFile(fileFromTemplate("presentation"));
    expect(p.board.cards).toHaveLength(5);
    expect(p.board.edges).toHaveLength(4);
  });

  it("使用者範本：存下整個檔案，用它建立的檔案內容相同", () => {
    const json = fileFromTemplate("meeting");
    const tpl = templateOfFile(json);
    expect(parseFile(fileFromTemplate(null, tpl))).toEqual(parseFile(json));
  });

  it("不認得的範本就是空白檔案", () => {
    expect(parseFile(fileFromTemplate("nope")).docs).toEqual([]);
  });
});
