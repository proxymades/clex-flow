fn main() {
    let root = "../src/firmware/components/clex_voice";
    let mut build = cc::Build::new();
    build.include(root).opt_level(2);
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        build.flag_if_supported("/std:c11");
    } else {
        build.flag_if_supported("-std=c99");
    }
    for file in ["features.c", "dtw.c", "core.c"] {
        let path = format!("{root}/{file}");
        println!("cargo:rerun-if-changed={path}");
        build.file(path);
    }
    for header in ["features.h", "core.h"] {
        println!("cargo:rerun-if-changed={root}/{header}");
    }
    build.compile("clex_voice_dsp");
    tauri_build::build()
}
