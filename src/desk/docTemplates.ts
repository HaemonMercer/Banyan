import { key, newSheet, newTable, serializeWorkbook, type Cell, type Style, type Table, type Workbook } from "../sheet/model";
import { today } from "../journal/journal";
import { expandTemplate } from "../pages/templates";
import type { DockKind } from "./file";

/**
 * Dock 文件的內建範本（參考 Pages／Keynote／Numbers 的範本選擇器）：新增 Word、簡報、Excel 時先挑一個。
 * 每個範本產生新文件的內容（Word、簡報是 Markdown，簡報用前面空一行的 `---` 分張；Excel 是活頁簿 JSON）。
 * 文字裡可以用頁面範本的變數（`{{today}}`、`{{title}}`…，`src/pages/templates.ts`）。純函式。
 */

export interface DocTemplate {
  id: string;
  kind: DockKind;
  label: string;
  hint: string;
  /** 新文件的內容 */
  make: (title: string) => string;
}

const md = (text: string) => (title: string) => expandTemplate(text, { title, date: today() }) + "\n";
const slides = (...pages: string[]) => md(pages.join("\n\n---\n\n"));

const WORD: DocTemplate[] = [
  { id: "word-blank", kind: "word", label: "Blank", hint: "An empty document", make: md("# {{title}}") },
  {
    id: "word-report",
    kind: "word",
    label: "Report",
    hint: "Summary, findings, recommendations",
    make: md(`# {{title}}

*Prepared {{today}}*

## Summary

One paragraph with the key message of this report.

## Background

Why this report was written and what question it answers.

## Findings

- First finding
- Second finding
- Third finding

## Recommendations

1. What should happen next
2. Who should do it

## Next steps

- [ ] Share with the team
- [ ] Decide on the recommendations`),
  },
  {
    id: "word-letter",
    kind: "word",
    label: "Letter",
    hint: "A formal letter",
    make: md(`Your Name\\
Street Address\\
City, Postcode

{{today}}

Recipient Name\\
Company\\
Street Address\\
City, Postcode

Dear Recipient,

Start with why you are writing. Keep each paragraph to one idea.

Add the details here: what you need, by when, and anything the reader should know.

Thank you for your time.

Sincerely,

Your Name`),
  },
  {
    id: "word-minutes",
    kind: "word",
    label: "Meeting minutes",
    hint: "Attendees, agenda, decisions, actions",
    make: md(`# {{title}}

**Date:** {{today}}\\
**Attendees:** \\
**Facilitator:**

## Agenda

1. Review last meeting's actions
2. Topic
3. Any other business

## Notes

-

## Decisions

-

## Action items

- [ ] Action — owner, due date`),
  },
  {
    id: "word-resume",
    kind: "word",
    label: "Résumé",
    hint: "Experience, education, skills",
    make: md(`# Your Name

Email · Phone · City · Website

## Profile

Two or three sentences about who you are and what you are looking for.

## Experience

### Job Title — Company

*2023 – Present*

- What you achieved, with a number if you can
- Another accomplishment

### Job Title — Company

*2020 – 2023*

- What you achieved

## Education

### Degree — School

*2016 – 2020*

## Skills

- Skill · Skill · Skill`),
  },
];

const SLIDES: DocTemplate[] = [
  { id: "slides-blank", kind: "slides", label: "Blank", hint: "One title slide", make: md("# {{title}}") },
  {
    id: "slides-pitch",
    kind: "slides",
    label: "Pitch deck",
    hint: "Problem, solution, market, ask",
    make: slides(
      "# {{title}}\n\nOne line that says what you do",
      "## The problem\n\n- Who has it\n- Why it hurts\n- How they solve it today",
      "## Our solution\n\n- What we built\n- Why it is better",
      "## Market\n\n- Who will buy it\n- How many of them there are",
      "## Business model\n\n- How we make money\n- Pricing",
      "## Team\n\n- Name — role\n- Name — role",
      "## The ask\n\nWhat we need and what it will get us",
    ),
  },
  {
    id: "slides-update",
    kind: "slides",
    label: "Project update",
    hint: "Highlights, progress, risks, next steps",
    make: slides(
      "# {{title}}\n\nProject update · {{today}}",
      "## Highlights\n\n- Biggest win\n- Another win",
      "## Progress\n\n- {x} Done\n- { } In progress\n- { } Not started",
      "## Risks\n\n- Risk — what we are doing about it",
      "## Next steps\n\n1. Next step\n2. Next step",
    ),
  },
  {
    id: "slides-lesson",
    kind: "slides",
    label: "Lesson",
    hint: "Objectives, ideas, example, recap",
    make: slides(
      "# {{title}}",
      "## Today you will learn\n\n- Objective\n- Objective",
      "## Key idea\n\nExplain the idea in one or two sentences.",
      "## Example\n\nWalk through a worked example.",
      "## Try it\n\nA short exercise for the class.",
      "## Recap\n\n- What we covered\n- What comes next",
    ),
  },
];

/* ─── 試算表：一張工作表、一個表格 ─── */

function table(name: string, header: string[], rows: string[][], opt: { styles?: (Style | undefined)[]; footer?: string[]; widths?: number[]; hc?: number; theme?: Table["theme"] } = {}): Table {
  const cols = header.length;
  const fr = opt.footer ? 1 : 0;
  const t = newTable(name, 40, 40, rows.length + 1 + fr, cols, 1, opt.hc ?? 0);
  t.fr = fr;
  if (opt.theme) t.theme = opt.theme;
  if (opt.widths) t.colW = opt.widths;
  const put = (r: number, c: number, v: string, s?: Style) => {
    if (!v && !s) return;
    const cell: Cell = { v };
    if (s) cell.s = s;
    t.cells[key(r, c)] = cell;
  };
  header.forEach((h, c) => put(0, c, h));
  rows.forEach((row, r) => header.forEach((_h, c) => put(r + 1, c, row[c] ?? "", opt.styles?.[c])));
  opt.footer?.forEach((v, c) => put(rows.length + 1, c, v, opt.styles?.[c]));
  return t;
}

const book = (sheet: string, t: Table): (() => string) => () => {
  const s = newSheet(sheet);
  const wb: Workbook = { sheets: [{ ...s, tables: [t] }] };
  return serializeWorkbook(wb);
};

const CUR: Style = { fmt: "currency", cur: "$", dec: 2, sep: true };

const SHEET: DocTemplate[] = [
  { id: "sheet-blank", kind: "sheet", label: "Blank", hint: "One empty table", make: () => book("Sheet 1", newTable("Table 1"))() },
  {
    id: "sheet-budget",
    kind: "sheet",
    label: "Budget",
    hint: "Planned vs actual with totals",
    make: (title) => {
      const items = ["Rent", "Groceries", "Transport", "Utilities", "Fun", "Savings"];
      const plan = ["1200", "400", "120", "150", "200", "500"];
      const rows = items.map((it, i) => [it, plan[i], "", `=B${i + 2}-C${i + 2}`]);
      return book(
        "Budget",
        table(title || "Budget", ["Category", "Budget", "Actual", "Difference"], rows, {
          styles: [undefined, CUR, CUR, CUR],
          footer: ["Total", "=SUM(B:B)", "=SUM(C:C)", "=SUM(D:D)"],
          widths: [150, 120, 120, 120],
          theme: "green",
        }),
      )();
    },
  },
  {
    id: "sheet-tracker",
    kind: "sheet",
    label: "Project tracker",
    hint: "Tasks, owners, status, due dates",
    make: (title) =>
      book(
        "Tasks",
        table(
          title || "Tasks",
          ["Done", "Task", "Owner", "Status", "Due"],
          [
            ["FALSE", "Kick-off meeting", "", "Not started", ""],
            ["FALSE", "Write the plan", "", "Not started", ""],
            ["FALSE", "First draft", "", "Not started", ""],
            ["FALSE", "Review", "", "Not started", ""],
            ["FALSE", "Ship it", "", "Not started", ""],
          ],
          { styles: [{ fmt: "checkbox", align: "center" }, undefined, undefined, undefined, { fmt: "date" }], widths: [60, 220, 120, 120, 120], theme: "blue" },
        ),
      )(),
  },
  {
    id: "sheet-schedule",
    kind: "sheet",
    label: "Weekly schedule",
    hint: "Hours by weekday",
    make: (title) => {
      const hours = ["8:00", "9:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"];
      return book(
        "Schedule",
        table(
          title || "Schedule",
          ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
          hours.map((h) => ["'" + h]),
          { hc: 1, widths: [70, 120, 120, 120, 120, 120], theme: "purple" },
        ),
      )();
    },
  },
];

export const DOC_TEMPLATES: DocTemplate[] = [...WORD, ...SLIDES, ...SHEET];

/** 這種文件有沒有範本可以挑（Note、Draw 直接新增） */
export const templatesFor = (kind: DockKind) => DOC_TEMPLATES.filter((t) => t.kind === kind);
