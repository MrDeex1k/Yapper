fn main() {
    println!("cargo::rerun-if-changed=build.rs");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo::rerun-if-changed=macos/Info.plist");
        // The static WebRTC archive uses Objective-C categories for codec capability checks.
        // Its dependency build script cannot pass this option to the final executable.
        println!("cargo::rustc-link-arg=-Wl,-ObjC");
        let plist = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("macos/Info.plist");
        for argument in ["-sectcreate", "__TEXT", "__info_plist"] {
            println!("cargo::rustc-link-arg=-Wl,{argument}");
        }
        // Pass the enclosing linker option in a single argument, including paths with spaces.
        println!("cargo::rustc-link-arg=-Wl,{}", plist.display());
    }
}
