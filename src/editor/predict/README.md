# 字預測資料

- `cangjie.txt`、`phrases.txt`：由 `scripts/build-predict.mjs` 從 Rime 的資料產生，不要手改。
  - 碼表：[rime/rime-cangjie](https://github.com/rime/rime-cangjie) 的 `cangjie5.base.dict.yaml`、`cangjie5.extended.dict.yaml`（倉頡五代）
  - 字頻與詞：[rime/rime-essay](https://github.com/rime/rime-essay) 的 `essay.txt`
  - 兩者都是 LGPL-3.0（`LICENSE-rime.txt`）。
- `english.txt`：英文常用字，大致依常用程度排列，可以直接改（重複的字會略過）。
