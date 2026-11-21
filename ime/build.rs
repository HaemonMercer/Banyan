fn main() {
    // 圖示：輸入法設定檔指向 DLL 本身的第一個圖示
    #[cfg(windows)]
    {
        println!("cargo:rerun-if-changed=res/banyan_ime.rc");
        println!("cargo:rerun-if-changed=../src-tauri/icons/icon.ico");
        embed_resource::compile("res/banyan_ime.rc", embed_resource::NONE).manifest_optional().unwrap();
    }
    // Dll* 匯出由 Rust 的 no_mangle 產生，連結器建議寫成 PRIVATE（.def 檔）：不影響使用，關掉這個警告
    #[cfg(windows)]
    println!("cargo:rustc-cdylib-link-arg=/IGNORE:4104");
    // 字典嵌進 DLL（predict.rs 的 include_str!）
    for f in ["cangjie.txt", "phrases.txt", "english.txt", "english-next.txt"] {
        println!("cargo:rerun-if-changed=../src/editor/predict/{f}");
    }
}
