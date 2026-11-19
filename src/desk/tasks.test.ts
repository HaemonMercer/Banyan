import { describe, expect, it } from "vitest";
import {
  addCard,
  addCheck,
  addList,
  appendTaskCards,
  cardsByDay,
  checkProgress,
  dueLabel,
  dueState,
  hasDue,
  listCards,
  markdownCard,
  moveCard,
  moveList,
  parseTasks,
  removeList,
  serializeTasks,
  starterTasks,
  tasksCsv,
  tasksMarkdown,
  toggleLabel,
  updateCard,
  updateCheck,
  type TaskBoard,
  dueCards,
} from "./tasks";

const board = (): TaskBoard => ({
  lists: [
    { id: "a", title: "To do" },
    { id: "b", title: "Done" },
  ],
  labels: [
    { id: "green", color: "green", name: "" },
    { id: "red", color: "red", name: "Urgent" },
  ],
  cards: [
    { id: "1", list: "a", title: "One" },
    { id: "2", list: "b", title: "Two" },
    { id: "3", list: "a", title: "Three" },
  ],
});

const titles = (b: TaskBoard, list: string) => listCards(b, list).map((c) => c.title);

describe("tasks model", () => {
  it("starts with three lists and six labels", () => {
    const b = starterTasks();
    expect(b.lists.map((l) => l.title)).toEqual(["To do", "Doing", "Done"]);
    expect(b.labels).toHaveLength(6);
    expect(parseTasks("").lists).toHaveLength(3);
    expect(parseTasks("not json").lists).toHaveLength(3);
  });

  it("round-trips and drops broken data", () => {
    const b = updateCard(board(), "1", { due: "2026-11-20", time: "09:30", done: true, labels: ["red"], desc: "x" });
    expect(parseTasks(serializeTasks(b))).toEqual(b);
    const bad = parseTasks(
      JSON.stringify({
        lists: [{ id: "a", title: "A" }, { id: "a" }, { title: "no id" }],
        labels: [{ id: "g", color: "pink" }],
        cards: [
          { id: "1", list: "a", title: "ok", due: "nope", time: "10:00", labels: ["g", "zzz", "g"] },
          { id: "2", list: "gone", title: "orphan" },
          { id: "1", list: "a", title: "dup" },
        ],
      }),
    );
    expect(bad.lists).toEqual([{ id: "a", title: "A" }]);
    expect(bad.labels).toEqual([{ id: "g", color: "green", name: "" }]);
    expect(bad.cards).toEqual([{ id: "1", list: "a", title: "ok", labels: ["g"] }]);
  });

  it("does not write empty fields", () => {
    const b = updateCard(board(), "1", { due: "2026-11-20", time: "08:00" });
    const cleared = updateCard(b, "1", { due: undefined, desc: "", labels: [], done: false });
    expect(cleared.cards[0]).toEqual({ id: "1", list: "a", title: "One" });
  });

  it("moves cards within and between lists", () => {
    const b = board();
    expect(titles(moveCard(b, "3", "a", 0), "a")).toEqual(["Three", "One"]);
    expect(titles(moveCard(b, "1", "a", 5), "a")).toEqual(["Three", "One"]);
    const m = moveCard(b, "1", "b", 0);
    expect(titles(m, "a")).toEqual(["Three"]);
    expect(titles(m, "b")).toEqual(["One", "Two"]);
    expect(titles(moveCard(b, "2", "a", 1), "a")).toEqual(["One", "Two", "Three"]);
    // 空的清單
    const e = addList(b, "Empty");
    expect(titles(moveCard(e.board, "2", e.id, 0), e.id)).toEqual(["Two"]);
    expect(moveCard(b, "1", "nowhere", 0)).toBe(b);
  });

  it("moves and removes lists", () => {
    const b = board();
    expect(moveList(b, "a", 1).lists.map((l) => l.id)).toEqual(["b", "a"]);
    const r = removeList(b, "a");
    expect(r.lists.map((l) => l.id)).toEqual(["b"]);
    expect(r.cards.map((c) => c.id)).toEqual(["2"]);
  });

  it("toggles labels in board order and tracks checklists", () => {
    let b = toggleLabel(board(), "1", "red");
    b = toggleLabel(b, "1", "green");
    expect(b.cards[0].labels).toEqual(["green", "red"]);
    expect(toggleLabel(b, "1", "red").cards[0].labels).toEqual(["green"]);
    b = addCheck(addCheck(b, "1", "a"), "1", "b");
    b = updateCheck(b, "1", b.cards[0].checklist![0].id, { done: true });
    expect(checkProgress(b.cards[0])).toEqual({ done: 1, total: 2 });
  });

  it("works out due states and the calendar days", () => {
    const now = "2026-11-19";
    const c = (due: string, done = false) => ({ id: "x", list: "a", title: "", due, done });
    expect(dueState(c("2026-11-18"), now)).toBe("overdue");
    expect(dueState(c("2026-11-19"), now)).toBe("today");
    expect(dueState(c("2026-11-20"), now)).toBe("soon");
    expect(dueState(c("2026-12-01"), now)).toBe("later");
    expect(dueState(c("2026-11-01", true), now)).toBe("done");
    expect(dueState({ id: "x", list: "a", title: "" }, now)).toBeNull();
    expect(dueLabel({ ...c("2026-11-20"), time: "14:00" }, now)).toBe("Nov 20, 14:00");
    expect(dueLabel(c("2027-01-02"), now)).toBe("Jan 2, 2027");

    let b = board();
    expect(hasDue(b)).toBe(false);
    b = updateCard(b, "1", { due: "2026-11-20" });
    b = updateCard(b, "2", { due: "2026-11-20", time: "08:00" });
    b = updateCard(b, "3", { due: "2026-12-20" });
    expect(hasDue(b)).toBe(true);
    const days = cardsByDay(b, ["2026-11-20", "2026-11-21"]);
    expect(days.get("2026-11-20")!.map((x) => x.id)).toEqual(["2", "1"]);
    expect(days.get("2026-11-21")).toEqual([]);
  });

  it("exports Markdown and CSV", () => {
    let b = updateCard(board(), "1", { due: "2026-11-20", labels: ["red"], desc: "Line 1\nLine 2", done: true });
    b = addCheck(b, "1", "Step");
    expect(tasksMarkdown(b, "Plan")).toBe(
      "# Plan\n\n## To do\n\n- [x] One (due 2026-11-20, #Urgent)\n  Line 1\n  Line 2\n  - [ ] Step\n- [ ] Three\n\n## Done\n\n- [ ] Two\n",
    );
    const csv = tasksCsv(b).split("\r\n");
    expect(csv[0]).toBe("List,Card,Due,Time,Done,Labels,Checklist,Description");
    expect(csv[1]).toBe('To do,One,2026-11-20,,Yes,Urgent,0/1,"Line 1\nLine 2"');
  });

  it("turns whiteboard cards into task cards", () => {
    expect(markdownCard("\n## Call **Ann**\nabout the plan\n")).toEqual({ title: "Call Ann", desc: "about the plan" });
    expect(markdownCard("- { } Buy milk")).toEqual({ title: "Buy milk" });
    expect(markdownCard("", "Page")).toEqual({ title: "Page" });
    const b = appendTaskCards(board(), [{ title: "New", desc: "d" }]);
    expect(listCards(b, "a").slice(-1)[0]).toMatchObject({ title: "New", desc: "d" });
    const empty = appendTaskCards({ lists: [], cards: [], labels: [] }, [{ title: "X" }]);
    expect(empty.lists[0].title).toBe("To do");
    expect(empty.cards[0].title).toBe("X");
    expect(addCard(board(), "a", "Y", { due: "2026-11-30" }).board.cards.slice(-1)[0].due).toBe("2026-11-30");
  });
});

describe("tasks in a Desk file", () => {
  it("saves the board on the file and reads it back", async () => {
    const { emptyFile, parseFile, serializeFile } = await import("./file");
    expect(parseFile(serializeFile(emptyFile())).tasks).toBeUndefined();
    expect(JSON.parse(serializeFile(emptyFile())).tasks).toBeUndefined();
    const b = starterTasks();
    const withCard = addCard(b, b.lists[0].id, "Ship it", { due: "2026-11-30" }).board;
    const json = serializeFile({ ...emptyFile(), tasks: withCard });
    expect(JSON.parse(json).tasks.cards[0]).toMatchObject({ title: "Ship it", due: "2026-11-30" });
    expect(parseFile(json).tasks).toEqual(withCard);
  });

  it("moves a board saved as a Dock document onto the file", async () => {
    const { parseFile } = await import("./file");
    const tasks = { lists: [{ id: "a", title: "To do" }], labels: [], cards: [{ id: "1", list: "a", title: "Old" }] };
    const f = parseFile(JSON.stringify({ board: {}, docs: [{ id: "d1", title: "Tasks", kind: "tasks", tasks }, { id: "d2", title: "Notes", kind: "note", content: "x" }] }));
    expect(f.docs.map((d) => d.id)).toEqual(["d2"]);
    expect(f.tasks?.cards[0].title).toBe("Old");
  });
});

describe("行事曆用的截止日卡片", () => {
  it("只拿有截止日的卡片，帶上清單名稱", () => {
    let b = starterTasks();
    b = addCard(b, b.lists[0].id, "A", { due: "2026-11-20", time: "09:30" }).board;
    b = addCard(b, b.lists[1].id, "B", { due: "bad" }).board;
    b = addCard(b, b.lists[1].id, "C").board;
    const got = dueCards(b);
    expect(got.map((x) => [x.card.title, x.list, x.card.time])).toEqual([["A", b.lists[0].title, "09:30"]]);
  });
});
