import { describe, expect, it } from "vitest";
import {
  addCard,
  addEdge,
  addMedia,
  addNote,
  addSection,
  clipText,
  copyItems,
  emptyBoard,
  MEDIA_MIN,
  parseBoard,
  parseClip,
  pasteItems,
  removeItems,
  sameRef,
  serializeBoard,
} from "./board";
import { embedUrl, fitMediaSize, mediaCardMarkdown, mediaFromUrl, resizeKeepRatio } from "./boardMedia";
import { cardsMarkdown } from "./file";
import { insertMindMap } from "./templates";

describe("media cards", () => {
  it("round-trip through JSON with a fixed size", () => {
    const { board, id } = addMedia(emptyBoard(), "media/a.gif", "image", 10, 20, 300, 200);
    const back = parseBoard(serializeBoard(board));
    expect(back).toEqual(board);
    expect(back.cards[0]).toMatchObject({ id, ref: { kind: "media", src: "media/a.gif", type: "image" }, w: 300, h: 200 });
  });

  it("old files and broken entries still open", () => {
    const b = parseBoard({
      cards: [
        { id: "a", ref: { kind: "media", src: "media/x.mp4", type: "video" }, x: 0, y: 0, w: 10 },
        { id: "b", ref: { kind: "media", src: "", type: "image" }, x: 0, y: 0 },
        { id: "c", ref: { kind: "media", src: "media/y.png", type: "audio" }, x: 0, y: 0 },
        { id: "d", ref: { kind: "note" }, x: 0, y: 0, w: 240, h: null, text: "hi" },
      ],
    });
    expect(b.cards.map((c) => c.id)).toEqual(["a", "d"]);
    // 太小的拉到最小，沒有高度就用 16:9
    expect(b.cards[0].w).toBe(MEDIA_MIN);
    expect(b.cards[0].h).toBe(MEDIA_MIN);
    expect(parseBoard({ cards: [{ id: "e", ref: { kind: "media", src: "https://youtu.be/abcdefghijk", type: "embed" }, w: 480 }] }).cards[0].h).toBe(270);
  });

  it("every media card is its own item and can be connected and removed", () => {
    let b = addMedia(emptyBoard(), "media/a.png", "image", 0, 0).board;
    b = addMedia(b, "media/a.png", "image", 600, 0).board;
    expect(b.cards).toHaveLength(2);
    expect(sameRef(b.cards[0].ref, b.cards[1].ref)).toBe(false);
    b = addEdge(b, b.cards[0].id, b.cards[1].id).board;
    expect(b.edges).toHaveLength(1);
    b = removeItems(b, [b.cards[0].id]);
    expect(b.cards).toHaveLength(1);
    expect(b.edges).toHaveLength(0);
  });

  it("are sent to the Dock as Markdown media", () => {
    const img = addMedia(emptyBoard(), "media/a.png", "image", 0, 0).board.cards[0];
    const yt = addMedia(emptyBoard(), "https://youtu.be/abcdefghijk", "embed", 0, 0).board.cards[0];
    const src = (c: typeof img) => ({ title: "Image", content: c.ref.kind === "media" ? mediaCardMarkdown(c.ref) : "" });
    expect(cardsMarkdown([img, yt], src, "word")).toBe("![](media/a.png)\n\n<https://youtu.be/abcdefghijk>");
    expect(mediaCardMarkdown({ src: "media/v.mp4", type: "video" })).toBe('<video src="media/v.mp4" controls>\n</video>');
  });
});

describe("media URLs", () => {
  it("YouTube and Vimeo links become embeds", () => {
    expect(embedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(embedUrl("https://youtu.be/dQw4w9WgXcQ?t=90")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?start=90");
    expect(embedUrl("https://youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?start=65");
    expect(embedUrl("https://www.youtube.com/shorts/abcDEF12345")).toBe("https://www.youtube.com/embed/abcDEF12345");
    expect(embedUrl("https://m.youtube.com/embed/abcDEF12345")).toBe("https://www.youtube.com/embed/abcDEF12345");
    expect(embedUrl("https://vimeo.com/76979871")).toBe("https://player.vimeo.com/video/76979871");
    expect(embedUrl("https://vimeo.com/channels/staffpicks/76979871")).toBe("https://player.vimeo.com/video/76979871");
    expect(embedUrl("https://player.vimeo.com/video/76979871")).toBe("https://player.vimeo.com/video/76979871");
    expect(embedUrl("https://www.youtube.com/feed/library")).toBeNull();
    expect(embedUrl("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(embedUrl("not a url")).toBeNull();
  });

  it("recognizes video, image and embed links, but not other pages or text", () => {
    expect(mediaFromUrl(" https://youtu.be/dQw4w9WgXcQ \n")).toEqual({ src: "https://youtu.be/dQw4w9WgXcQ", type: "embed" });
    expect(mediaFromUrl("https://cdn.example.com/clip.MP4?x=1")).toEqual({ src: "https://cdn.example.com/clip.MP4?x=1", type: "video" });
    expect(mediaFromUrl("https://example.com/a/funny.gif")).toMatchObject({ type: "image" });
    expect(mediaFromUrl("https://example.com/article")).toBeNull();
    expect(mediaFromUrl("look at https://youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(mediaFromUrl("https://youtu.be/a https://youtu.be/b")).toBeNull();
  });
});

describe("media sizes", () => {
  it("fits the long side, keeps small images at their own size", () => {
    expect(fitMediaSize(1920, 1080)).toEqual({ w: 480, h: 270 });
    expect(fitMediaSize(600, 1200)).toEqual({ w: 240, h: 480 });
    expect(fitMediaSize(120, 80)).toEqual({ w: 120, h: 80 });
    expect(fitMediaSize(0, 0)).toEqual({ w: 480, h: 270 });
    expect(fitMediaSize(2000, 10).h).toBe(MEDIA_MIN);
  });

  it("resizing keeps the aspect ratio and covers the pointer", () => {
    expect(resizeKeepRatio(400, 100, 0.5)).toEqual({ w: 400, h: 200 });
    expect(resizeKeepRatio(100, 400, 0.5)).toEqual({ w: 800, h: 400 });
    const tiny = resizeKeepRatio(10, 5, 0.5);
    expect(tiny.h).toBeGreaterThanOrEqual(MEDIA_MIN);
    expect(tiny.w / tiny.h).toBeCloseTo(2);
  });
});

describe("copy and paste", () => {
  it("copies cards, sections (with what is inside), maps and the edges between copied cards", () => {
    let b = addSection(emptyBoard(), { x: 0, y: 0, w: 800, h: 600 }).board;
    const n1 = addNote(b, 40, 80, "one");
    const n2 = addNote(n1.board, 400, 80, "two");
    const m = addMedia(n2.board, "media/a.png", "image", 2000, 0);
    b = addEdge(m.board, n1.id, n2.id).board;
    b = addEdge(b, n2.id, m.id).board;
    b = insertMindMap(b, 3000, 0).board;
    const clip = copyItems(b, [b.sections[0].id, b.maps[0].id]);
    expect(clip.cards.map((c) => c.text)).toEqual(["one", "two"]);
    expect(clip.edges).toHaveLength(1);
    expect(clip.maps).toHaveLength(1);

    const res = pasteItems(b, clip, 1000, 0);
    expect(res.board.cards).toHaveLength(b.cards.length + 2);
    expect(res.board.edges).toHaveLength(b.edges.length + 1);
    expect(res.board.sections).toHaveLength(2);
    expect(res.board.maps).toHaveLength(2);
    // 全部是新的 id，位置移動了
    const old = new Set([...b.cards, ...b.edges, ...b.sections, ...b.maps].map((x) => x.id));
    expect(res.ids.every((id) => !old.has(id))).toBe(true);
    expect(res.ids).toHaveLength(2 + 1 + 1 + 1);
    const pasted = res.board.cards.filter((c) => res.ids.includes(c.id));
    expect(pasted.map((c) => c.x)).toEqual([1040, 1400]);
    const e = res.board.edges.find((x) => res.ids.includes(x.id))!;
    expect([e.from, e.to]).toEqual(pasted.map((c) => c.id));
  });

  it("page cards are not duplicated: edges reconnect to the card already on the board", () => {
    const p = addCard(emptyBoard(), { kind: "page", name: "Ideas" }, 0, 0);
    const n = addNote(p.board, 400, 0, "x");
    const b = addEdge(n.board, p.id, n.id).board;
    const res = pasteItems(b, copyItems(b, [p.id, n.id]), 0, 300);
    expect(res.board.cards.filter((c) => c.ref.kind === "page")).toHaveLength(1);
    expect(res.board.cards).toHaveLength(3);
    const e = res.board.edges.find((x) => res.ids.includes(x.id))!;
    expect(e.from).toBe(p.id);
  });

  it("clipboard text round-trips and ignores other text", () => {
    const m = addMedia(emptyBoard(), "media/a.png", "image", 5, 5, 100, 50);
    const clip = copyItems(m.board, [m.id]);
    expect(parseClip(clipText(clip))).toEqual(clip);
    expect(parseClip("banyan-board is a nice name")).toBeNull();
    expect(parseClip('{"banyan-board":1,"cards":[]}')).toBeNull();
    expect(parseClip("hello")).toBeNull();
  });
});
