import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRightIcon, ClipIcon, ClockIcon, CloseIcon, FolderIcon, ImageIcon, ImportIcon, LinkIcon, SearchIcon } from "../editor/icons";
import { kindOf, mediaUrl, saveMedia } from "../editor/media";
import { attachmentImages, drawerImages, fileImages, imageAlt, searchImages, urlImage, type DrawerImage, type ImageTab, type PickedImage } from "./drawerImages";
import { childFolders, folderPath } from "./files";
import type { Library } from "./model";
import "./drawer.css";
import "./imagePicker.css";

/**
 * 插入圖片的對話框（參考 Google 文件／雲端硬碟的「插入圖片」選擇器）：
 * 上方標題與搜尋列，下面一排分頁 Recent、My Files、Attachments、Upload、By URL，
 * 中間是縮圖格子（點一下選取、可以選好幾張，連按兩下直接插入），下方 Select／Cancel。
 * Drawer 的圖片插入同一個 `media/` 檔案；Upload 存成新的 `media/` 檔案（不放進 Drawer，跟 Google 文件一樣）；
 * By URL 直接寫網址。App 畫它（`pickImages`），選好交給 onDone，Esc 或 Cancel 是空陣列。
 */
const TABS: { id: ImageTab; label: string; icon: ReactNode }[] = [
  { id: "recent", label: "Recent", icon: <ClockIcon /> },
  { id: "files", label: "My Files", icon: <FolderIcon /> },
  { id: "attachments", label: "Attachments", icon: <ClipIcon /> },
  { id: "upload", label: "Upload", icon: <ImportIcon /> },
  { id: "url", label: "By URL", icon: <LinkIcon /> },
];

const isDrawerTab = (t: ImageTab) => t === "recent" || t === "files" || t === "attachments";

export function ImagePicker(props: { lib: Library; tab?: ImageTab; multiple?: boolean; onDone: (list: PickedImage[]) => void }) {
  const { lib, onDone } = props;
  const multiple = props.multiple !== false;
  const [tab, setTab] = useState<ImageTab>(props.tab ?? "recent");
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  /** 選取的圖片（照點的順序插入） */
  const [picked, setPicked] = useState<DrawerImage[]>([]);
  const [url, setUrl] = useState("");
  const [urlState, setUrlState] = useState<"empty" | "loading" | "ok" | "bad">("empty");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const all = useMemo(() => drawerImages(lib), [lib]);
  const searching = isDrawerTab(tab) && !!query.trim();
  const list = useMemo(() => {
    if (searching) return searchImages(all, query);
    if (tab === "recent") return all;
    if (tab === "files") return fileImages(lib, folder);
    if (tab === "attachments") return attachmentImages(lib);
    return [];
  }, [all, lib, tab, folder, query, searching]);
  const folders = tab === "files" && !searching ? childFolders(lib, folder) : [];

  const done = (out: PickedImage[]) => onDone(out);
  const insertPicked = (imgs = picked) => imgs.length && done(imgs.map((i) => ({ src: i.src, alt: imageAlt(i) })));
  const fromUrl = urlState === "ok" ? urlImage(url) : null;

  // 換分頁時把焦點放在那一頁要打字的地方
  useEffect(() => {
    if (tab === "url") urlRef.current?.focus();
    else if (isDrawerTab(tab)) searchRef.current?.focus();
  }, [tab]);

  // 網址：先試著載入，載得到才能插入
  useEffect(() => {
    const u = urlImage(url);
    if (!url.trim()) return setUrlState("empty");
    if (!u) return setUrlState("bad");
    setUrlState("loading");
    const img = new Image();
    let live = true;
    img.onload = () => live && setUrlState("ok");
    img.onerror = () => live && setUrlState("bad");
    img.src = u.src;
    return () => {
      live = false;
    };
  }, [url]);

  const upload = async (files: File[]) => {
    const imgs = files.filter((f) => kindOf(f.name, f.type) === "image");
    if (!imgs.length) return setError("Choose an image file (PNG, JPEG, GIF, WebP, SVG…).");
    setBusy(true);
    setError(null);
    try {
      const out: PickedImage[] = [];
      for (const f of multiple ? imgs : imgs.slice(0, 1)) out.push({ src: await saveMedia(f), alt: f.name.replace(/\.[^.]+$/, "") });
      done(out);
    } catch (err) {
      console.error("Couldn't upload the image", err);
      setError("Couldn't save the image.");
      setBusy(false);
    }
  };

  // Esc 關掉、Enter 插入；Upload 分頁可以直接 Ctrl＋V 貼上圖片
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    if (e.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      done([]);
    } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      e.stopPropagation();
      if (tab === "url") fromUrl && done([fromUrl]);
      else insertPicked();
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  const pasteRef = useRef<(e: ClipboardEvent) => void>(() => {});
  pasteRef.current = (e) => {
    if (tab !== "upload") return;
    const files = [...(e.clipboardData?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    void upload(files);
  };
  useEffect(() => {
    const paste = (e: ClipboardEvent) => pasteRef.current(e);
    window.addEventListener("paste", paste, true);
    return () => window.removeEventListener("paste", paste, true);
  }, []);

  const toggle = (img: DrawerImage) =>
    setPicked((p) => (p.some((i) => i.id === img.id) ? p.filter((i) => i.id !== img.id) : multiple ? [...p, img] : [img]));

  const crumbs = folderPath(lib, folder);
  const emptyNote = searching
    ? `No images match “${query.trim()}”.`
    : tab === "files"
      ? folders.length
        ? null
        : folder
          ? "No images in this folder."
          : "No images in My Files yet. Add pictures in Drawer › Files."
      : tab === "attachments"
        ? "No images attached to items yet."
        : "No images in Drawer yet. Add pictures to My Files or attach them to an item, or use Upload.";

  return createPortal(
    <div className="modal-backdrop ip-backdrop" onMouseDown={(e) => e.target === e.currentTarget && done([])}>
      <div className="modal ip" role="dialog" aria-modal="true" aria-label="Insert image">
        <div className="ip-head">
          <span className="ip-title">
            <ImageIcon /> Insert image
          </span>
          {isDrawerTab(tab) && (
            <label className="ip-search">
              <SearchIcon />
              <input ref={searchRef} value={query} placeholder="Search Drawer images" onChange={(e) => setQuery(e.target.value)} />
              {query && (
                <button className="ip-clear" title="Clear search" onClick={() => setQuery("")}>
                  <CloseIcon />
                </button>
              )}
            </label>
          )}
          <button className="icon-btn ip-close" title="Close (Esc)" onClick={() => done([])}>
            <CloseIcon />
          </button>
        </div>
        <div className="ip-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => (setTab(t.id), setError(null))}>
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div className="ip-body">
          {isDrawerTab(tab) && (
            <>
              {tab === "files" && !searching && (
                <nav className="ip-crumbs" aria-label="Folder">
                  <button className={folder === null ? "here" : ""} onClick={() => setFolder(null)}>
                    My Files
                  </button>
                  {crumbs.map((f) => (
                    <span key={f.id} className="ip-crumb">
                      <ChevronRightIcon />
                      <button className={f.id === folder ? "here" : ""} onClick={() => setFolder(f.id)}>
                        {f.name}
                      </button>
                    </span>
                  ))}
                </nav>
              )}
              {searching && <div className="ip-section">Search results</div>}
              {folders.length > 0 && (
                <>
                  <div className="ip-section">Folders</div>
                  <div className="ip-folders">
                    {folders.map((f) => (
                      <button key={f.id} className="ip-folder" onClick={() => setFolder(f.id)} title={f.name}>
                        <FolderIcon />
                        <span>{f.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {list.length > 0 && (
                <>
                  {folders.length > 0 && <div className="ip-section">Images</div>}
                  <div className="ip-grid">
                    {list.map((img) => {
                      const n = picked.findIndex((i) => i.id === img.id);
                      return (
                        <button
                          key={img.id}
                          className={`ip-tile${n >= 0 ? " on" : ""}`}
                          title={`${img.name}\n${img.where}`}
                          aria-pressed={n >= 0}
                          onClick={() => toggle(img)}
                          onDoubleClick={() => insertPicked(n >= 0 ? picked : [...(multiple ? picked : []), img])}
                        >
                          <span className="ip-thumb">
                            <img src={mediaUrl(img.src)} alt="" draggable={false} loading="lazy" />
                          </span>
                          <span className="ip-name">{img.name}</span>
                          {(searching || tab !== "files") && <span className="ip-where">{img.where}</span>}
                          {n >= 0 && <span className="ip-check">{multiple && picked.length > 1 ? n + 1 : "✓"}</span>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              {!list.length && emptyNote && <div className="ip-empty">{emptyNote}</div>}
            </>
          )}

          {tab === "upload" && (
            <div className="ip-upload">
              <ImportIcon className="ip-upload-icon" />
              <div className="ip-upload-text">{busy ? "Uploading…" : "Paste an image here (Ctrl+V)"}</div>
              <div className="ip-upload-or">or</div>
              <button className="dr-btn primary" disabled={busy} onClick={() => fileRef.current?.click()}>
                Browse
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple={multiple}
                hidden
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = "";
                  if (files.length) void upload(files);
                }}
              />
              <div className="ip-upload-note">Uploaded images aren't added to Drawer. To reuse a picture in other documents, add it to Drawer › Files.</div>
              {error && <div className="ip-error">{error}</div>}
            </div>
          )}

          {tab === "url" && (
            <div className="ip-url">
              <input
                ref={urlRef}
                className="ip-url-input"
                data-no-predict
                value={url}
                placeholder="Paste the image URL (https://…)"
                spellCheck={false}
                onChange={(e) => setUrl(e.target.value)}
              />
              <div className="ip-url-note">Only use images you have the right to use. The document links to the image; it isn't copied.</div>
              <div className="ip-url-preview">
                {urlState === "ok" && fromUrl ? (
                  <img src={fromUrl.src} alt="" />
                ) : (
                  <span className="ip-url-hint">
                    {urlState === "loading" ? "Loading…" : urlState === "bad" ? "Can't find an image at this URL." : "The image will show up here."}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="ip-foot">
          <span className="ip-count">
            {isDrawerTab(tab) && picked.length > 0 && (
              <>
                {picked.length} selected
                <button className="ip-link" onClick={() => setPicked([])}>
                  Clear
                </button>
              </>
            )}
          </span>
          <button className="dr-btn" onClick={() => done([])}>
            Cancel
          </button>
          {tab === "url" ? (
            <button className="dr-btn primary" disabled={!fromUrl} onClick={() => fromUrl && done([fromUrl])}>
              Insert image
            </button>
          ) : tab === "upload" ? null : (
            <button className="dr-btn primary" disabled={!picked.length} onClick={() => insertPicked()}>
              {picked.length > 1 ? `Insert ${picked.length} images` : "Insert"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
