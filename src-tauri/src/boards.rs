use serde_json::Value;

pub fn default_target() -> String {
    "esp32s3".into()
}
pub fn compiler(target: &str) -> Result<&'static str, String> {
    match target {
        "esp32s3" => Ok("xtensa-esp32s3-elf-gcc"),
        "esp32p4" => Ok("riscv32-esp-elf-gcc"),
        _ => Err("Цель SDK не поддерживается".into()),
    }
}
pub fn target(value: Option<String>) -> Result<String, String> {
    let value = value.unwrap_or_else(default_target);
    compiler(&value)?;
    Ok(value)
}
pub fn profile(id: &str) -> Result<Value, String> {
    let source = match id {
        "waveshare-esp32-s3-eth" => {
            include_str!("../../src/catalog/boards/waveshare-esp32-s3-eth.json")
        }
        "espressif-devkitc-1-v1-1-n8r8" => {
            include_str!("../../src/catalog/boards/espressif-devkitc-1-v1-1-n8r8.json")
        }
        "waveshare-esp32-p4-nano" => {
            include_str!("../../src/catalog/boards/waveshare-esp32-p4-nano.json")
        }
        _ => return Err("Нет реализованного профиля прошивки этой платы".into()),
    };
    serde_json::from_str(source).map_err(|e| e.to_string())
}
