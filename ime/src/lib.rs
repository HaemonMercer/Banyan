//! Banyan 輸入法：把 Banyan 的倉頡／速成、字預測與輔助打字做成 Windows 的輸入法（TSF 文字服務）。
//!
//! - `engine`：純邏輯（照 `src/editor/predict.ts`、`predictor.ts`、`typing.ts`、`punct.ts` 移植）。
//! - `tsf`：Windows 的部分（COM 註冊、按鍵、組字、候選視窗）。
pub mod engine;

#[cfg(windows)]
mod tsf;
