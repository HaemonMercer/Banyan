/** 字數：中日韓文字每字算一個，其他以空白分隔的詞算一個；版面標籤（欄位、縮排）不算。 */
export function countWords(source: string): number {
  const md = source.replace(/^<\/?div\b[^>]*>[ \t]*$/gim, "").replace(/&nbsp;/g, " ");
  const cjk = md.match(/[㐀-鿿豈-﫿぀-ヿ가-힯]/g)?.length ?? 0;
  const words = md.replace(/[㐀-鿿豈-﫿぀-ヿ가-힯]/g, " ").match(/[\p{L}\p{N}]+/gu);
  return cjk + (words?.length ?? 0);
}
