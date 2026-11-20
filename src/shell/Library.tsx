import { forwardRef } from "react";
import { SearchIcon } from "../editor/icons";
import "./library.css";

/** 「所有頁面」的搜尋框：打字篩選，Enter 開啟或新增（右邊提示 Enter 會做什麼），Esc 清空。 */
export const LibrarySearch = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (v: string) => void;
    onSubmit: () => void;
    placeholder: string;
    /** 有輸入時右邊的提示，例如「Enter to create」 */
    hint?: string;
  }
>(function LibrarySearch(props, ref) {
  return (
    <form
      className="lib-search no-box"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit();
      }}
    >
      <SearchIcon className="ls-icon" />
      <input
        ref={ref}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && props.value) {
            e.preventDefault();
            props.onChange("");
          }
        }}
        placeholder={props.placeholder}
        spellCheck={false}
      />
      {props.value && props.hint && (
        <span className="ls-hint">
          <kbd>Enter</kbd> {props.hint}
        </span>
      )}
    </form>
  );
});
