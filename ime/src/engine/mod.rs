//! 輸入法的核心：純邏輯，不碰 Windows（`cargo test` 在任何平台都能跑）。
pub mod learn;
pub mod machine;
pub mod options;
pub mod predict;
pub mod punct;
pub mod typing;
