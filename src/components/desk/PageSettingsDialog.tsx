import { createPortal } from "react-dom";
import { Icon } from "../../icons/Icon";
import {
    ALIGNMENTS, DEFAULT_PAGE, MARGIN_PRESETS, MAX_COLUMNS, PAGE_NUMBER, PAPERS, SIDES, pageInk, pageInsets, paperSize, runningLines,
    type Orientation, type PageSettings, type Paper,
} from "../../desk/paper";
import { DraftInput } from "./StylePanel";

const SIDE_LABELS = { top: "上", right: "右", bottom: "下", left: "左" } as const;
const ALIGN_LABELS = { left: "左", center: "中", right: "右" } as const;
const PART_LABELS = { header: "頁首", footer: "頁尾" } as const;

/** A number in mm from a text field, clamped; null when it isn't a number. */
function millimetres(text: string, max: number) {
    const value = Number(text.trim());
    return text.trim() && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value * 10) / 10)) : null;
}

/**
 * The page setup dialog: paper, orientation, margins, text columns, header and footer. Every change
 * is written to the YAML front matter at once, so the preview behind the dialog follows along.
 */
export default function PageSettingsDialog({ page, onChange, onClose }: {
    page: PageSettings;
    onChange: (fields: Partial<PageSettings>) => void;
    onClose: () => void;
}) {
    const size = paperSize(page);
    const preset = MARGIN_PRESETS.findIndex((item) => SIDES.every((side) => item.padding[side] === page.padding[side]));
    const segmented = <T extends string | number>(label: string, value: T, options: [T, string][], set: (value: T) => void) => (
        <div className="desk-segmented" role="radiogroup" aria-label={label}>
            {options.map(([option, text]) => (
                <button key={String(option)} type="button" role="radio" aria-checked={value === option} onClick={() => set(option)}>{text}</button>
            ))}
        </div>
    );

    return createPortal(
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal desk-page-dialog" role="dialog" aria-modal="true" aria-labelledby="desk-page-dialog-title"
                onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.stopPropagation(); onClose(); } }}>
                <div className="modal-header">
                    <h2 id="desk-page-dialog-title">頁面設定</h2>
                    <button className="icon-btn" aria-label="關閉" title="關閉（Esc）" onClick={onClose}><Icon name="close" size={16} /></button>
                </div>
                <div className="desk-page-dialog-body">
                    <div className="desk-page-dialog-form">
                        <section aria-labelledby="desk-page-paper">
                            <h3 id="desk-page-paper">紙張</h3>
                            <div className="desk-page-row">
                                <label>尺寸
                                    <select autoFocus value={page.paper} onChange={(e) => onChange({ paper: e.target.value as Paper })}>
                                        {Object.entries(PAPERS).map(([key, paper]) => <option key={key} value={key}>{paper.label}（{paper.width} × {paper.height} mm）</option>)}
                                    </select>
                                </label>
                                <label>方向
                                    {segmented<Orientation>("紙張方向", page.orientation, [["portrait", "直向"], ["landscape", "橫向"]], (orientation) => onChange({ orientation }))}
                                </label>
                                <label>紙張顏色
                                    <span className="desk-page-colour">
                                        <input type="color" value={page.color} aria-label="紙張顏色" onChange={(e) => onChange({ color: e.target.value })} />
                                        {page.color !== DEFAULT_PAGE.color && <button className="small-btn" onClick={() => onChange({ color: DEFAULT_PAGE.color })}>白色</button>}
                                    </span>
                                </label>
                            </div>
                        </section>

                        <section aria-labelledby="desk-page-margins">
                            <h3 id="desk-page-margins">邊界</h3>
                            <div className="desk-page-presets" role="group" aria-label="邊界預設">
                                {MARGIN_PRESETS.map((item, index) => (
                                    <button key={item.label} className="desk-style-chip" aria-pressed={preset === index}
                                        title={SIDES.map((side) => `${SIDE_LABELS[side]} ${item.padding[side]}`).join("・") + " mm"}
                                        onClick={() => onChange({ padding: { ...item.padding } })}>{item.label}</button>
                                ))}
                                {preset < 0 && <span className="desk-style-chip" aria-pressed="true">自訂</span>}
                            </div>
                            <div className="desk-page-row">
                                {SIDES.map((side) => (
                                    <label key={side}>{SIDE_LABELS[side]}
                                        <span className="desk-style-unit">
                                            <DraftInput value={String(page.padding[side])} inputMode="decimal" aria-label={`${SIDE_LABELS[side]}邊界（mm）`}
                                                onCommit={(text) => {
                                                    const value = millimetres(text, 60);
                                                    if (value !== null) onChange({ padding: { ...page.padding, [side]: value } });
                                                }} />
                                            <small>mm</small>
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </section>

                        <section aria-labelledby="desk-page-columns">
                            <h3 id="desk-page-columns">分欄</h3>
                            <div className="desk-page-row">
                                <label>欄數
                                    {segmented<number>("文字欄數", page.columns, Array.from({ length: MAX_COLUMNS }, (_, index) => [index + 1, String(index + 1)]),
                                        (columns) => onChange({ columns }))}
                                </label>
                                <label>欄距
                                    <span className="desk-style-unit">
                                        <DraftInput value={String(page.columnGap)} inputMode="decimal" aria-label="欄距（mm）" disabled={page.columns === 1}
                                            onCommit={(text) => {
                                                const value = millimetres(text, 30);
                                                if (value !== null) onChange({ columnGap: value });
                                            }} />
                                        <small>mm</small>
                                    </span>
                                </label>
                                <label className="desk-page-check">
                                    <input type="checkbox" checked={page.columnRule} disabled={page.columns === 1} onChange={(e) => onChange({ columnRule: e.target.checked })} />
                                    欄間分隔線
                                </label>
                            </div>
                            <p className="desk-page-hint">整份文件的正文分成多欄，由左到右填滿後換頁。只想讓一段內容分欄，用「版面配置」的分欄區塊（<code>::Col</code>）。</p>
                        </section>

                        <section aria-labelledby="desk-page-running">
                            <h3 id="desk-page-running">頁首與頁尾</h3>
                            {(["header", "footer"] as const).map((part) => (
                                <div key={part} className="desk-page-running" role="group" aria-label={PART_LABELS[part]}>
                                    <span className="desk-format-label">{PART_LABELS[part]}</span>
                                    {ALIGNMENTS.map((side) => (
                                        <label key={side}>{ALIGN_LABELS[side]}
                                            <DraftInput value={page[part][side].join("、")} placeholder={side === "center" ? "例如 pageNumber" : ""}
                                                aria-label={`${PART_LABELS[part]}${ALIGN_LABELS[side]}`}
                                                title="多個項目用「、」分隔；pageNumber 是頁碼"
                                                onCommit={(text) => {
                                                    const items = text.split(/[、\n]/).map((item) => item.trim().slice(0, 150)).filter(Boolean);
                                                    onChange({ [part]: { ...page[part], [side]: items } });
                                                }} />
                                        </label>
                                    ))}
                                </div>
                            ))}
                            <div className="desk-page-row">
                                <label className="desk-page-check">
                                    <input type="checkbox" checked={page.pageNumbers} onChange={(e) => onChange({ pageNumbers: e.target.checked })} />
                                    顯示頁碼（pageNumber）
                                </label>
                                <label className="desk-page-check">
                                    <input type="checkbox" checked={page.differentFirstPage} onChange={(e) => onChange({ differentFirstPage: e.target.checked })} />
                                    首頁不顯示頁首與頁尾
                                </label>
                                {!page.footer.center.includes(PAGE_NUMBER) && !page.header.center.includes(PAGE_NUMBER) && (
                                    <button className="small-btn" onClick={() => onChange({ footer: { ...page.footer, center: [...page.footer.center, PAGE_NUMBER] }, pageNumbers: true })}>
                                        <Icon name="plus" size={13} />頁尾置中加入頁碼
                                    </button>
                                )}
                            </div>
                        </section>
                    </div>
                    <PageThumbnail page={page} />
                </div>
                <div className="modal-actions">
                    <span className="desk-page-summary">{PAPERS[page.paper].label}・{page.orientation === "landscape" ? "橫向" : "直向"}・{size.width} × {size.height} mm{page.columns > 1 ? `・${page.columns} 欄` : ""}</span>
                    <button className="secondary-btn" onClick={() => onChange({
                        ...DEFAULT_PAGE, header: page.header, footer: page.footer, color: page.color,
                    })}>版面還原預設</button>
                    <button className="primary-btn" onClick={onClose}>完成</button>
                </div>
            </div>
        </div>,
        document.body,
    );
}

/** A small drawing of the sheet: margins, columns and where the header and footer go. */
function PageThumbnail({ page }: { page: PageSettings }) {
    const size = paperSize(page);
    const insets = pageInsets(page);
    // Fit the sheet in a 200 × 220 box.
    const scale = Math.min(200 / size.width, 220 / size.height);
    const mm = (value: number) => value * scale;
    const contentWidth = size.width - insets.left - insets.right;
    const columnWidth = (contentWidth - page.columnGap * (page.columns - 1)) / page.columns;
    const lines = (part: "header" | "footer") => ALIGNMENTS.some((side) => runningLines(page, 1)(part, side).length > 0);
    return (
        <figure className="desk-page-thumbnail" aria-label="版面預覽">
            <div className="desk-page-sheet" style={{ width: mm(size.width), height: mm(size.height), background: page.color, color: pageInk(page.color) }}>
                {lines("header") && <span className="desk-page-thumb-line" style={{ top: mm(insets.top) / 2 - 1, left: mm(insets.left), right: mm(insets.right) }} />}
                {Array.from({ length: page.columns }, (_, index) => (
                    <span key={index} className="desk-page-thumb-column" style={{
                        top: mm(insets.top), bottom: mm(insets.bottom),
                        left: mm(insets.left + index * (columnWidth + page.columnGap)), width: Math.max(1, mm(columnWidth)),
                    }} />
                ))}
                {page.columnRule && Array.from({ length: page.columns - 1 }, (_, index) => (
                    <span key={index} className="desk-page-thumb-rule" style={{
                        top: mm(insets.top), bottom: mm(insets.bottom),
                        left: mm(insets.left + (index + 1) * columnWidth + index * page.columnGap + page.columnGap / 2),
                    }} />
                ))}
                {lines("footer") && <span className="desk-page-thumb-line" style={{ bottom: mm(insets.bottom) / 2 - 1, left: mm(insets.left), right: mm(insets.right) }} />}
            </div>
            <figcaption>{size.width} × {size.height} mm</figcaption>
        </figure>
    );
}
