import { describe, expect, it } from "vitest";
import { clock, duration, layoutTimed, parseClock, parseTime, setLineTime, setTimeAt, timeText } from "./time";

describe("parseTime", () => {
  it("開始時間", () => {
    expect(parseTime("9:30 晨會")).toEqual({ time: { start: 570 }, rest: "晨會" });
  });
  it("開始與結束", () => {
    expect(parseTime("14:00-15:30 開會")).toEqual({ time: { start: 840, end: 930 }, rest: "開會" });
    expect(parseTime("14:00 – 15:30 開會").time).toEqual({ start: 840, end: 930 });
    expect(parseTime("23:00-24:00 x").time).toEqual({ start: 1380, end: 1440 });
  });
  it("結束早於開始就只算開始", () => {
    expect(parseTime("15:00-14:00 x").time).toEqual({ start: 900 });
  });
  it("不是時間", () => {
    expect(parseTime("25:00 x").time).toBeNull();
    expect(parseTime("10:75 x").time).toBeNull();
    expect(parseTime("10:00開會").time).toBeNull();
    expect(parseTime("開會 10:00").time).toBeNull();
    expect(parseTime("24:00 x").time).toBeNull();
  });
  it("只有時間", () => {
    expect(parseTime("08:00")).toEqual({ time: { start: 480 }, rest: "" });
  });
});

describe("時間文字", () => {
  it("clock、parseClock", () => {
    expect(clock(570)).toBe("09:30");
    expect(parseClock("9:05")).toBe(545);
    expect(parseClock("x")).toBeNull();
  });
  it("timeText、duration", () => {
    expect(timeText({ start: 840, end: 930 })).toBe("14:00-15:30");
    expect(timeText({ start: 840 })).toBe("14:00");
    expect(duration({ start: 840 })).toBe(60);
    expect(duration({ start: 840, end: 870 })).toBe(30);
  });
});

describe("setLineTime", () => {
  it("加上、改掉、拿掉時間", () => {
    expect(setLineTime("- [o] 開會", { start: 600, end: 660 })).toBe("- [o] 10:00-11:00 開會");
    expect(setLineTime("- [o] 10:00-11:00 開會 [[2026-11-20]]", { start: 780 })).toBe("- [o] 13:00 開會 [[2026-11-20]]");
    expect(setLineTime("- [ ] 9:00 寫報告", null)).toBe("- [ ] 寫報告");
    expect(setLineTime("  * [x] 打電話", { start: 60 })).toBe("  * [x] 01:00 打電話");
  });
  it("不是任務就不變", () => {
    expect(setLineTime("- 筆記", { start: 60 })).toBe("- 筆記");
    expect(setTimeAt("a\n- [ ] b", 0, { start: 60 })).toBe("a\n- [ ] b");
    expect(setTimeAt("a\n- [ ] b", 1, { start: 60 })).toBe("a\n- [ ] 01:00 b");
  });
});

describe("layoutTimed", () => {
  const t = (start: number, end: number) => ({ start, end });
  it("不重疊的各自一欄", () => {
    const r = layoutTimed([t(60, 120), t(120, 180)], (x) => x);
    expect(r.map((x) => [x.col, x.cols])).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });
  it("重疊的並排", () => {
    const r = layoutTimed([t(60, 180), t(90, 120), t(130, 200), t(300, 360)], (x) => x);
    expect(r.map((x) => [x.item.start, x.col, x.cols])).toEqual([
      [60, 0, 2],
      [90, 1, 2],
      [130, 1, 2],
      [300, 0, 1],
    ]);
  });
});
