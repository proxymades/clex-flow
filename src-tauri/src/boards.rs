use serde_json::Value;

pub fn default_target() -> String {
    "esp32s3".into()
}
pub fn compiler(target: &str) -> Result<&'static str, String> {
    match target {
        "esp32" => Ok("xtensa-esp32-elf-gcc"),
        "esp32s3" => Ok("xtensa-esp32s3-elf-gcc"),
        "esp32p4" => Ok("riscv32-esp-elf-gcc"),
        "atmega328p" => Ok("avr-gcc"),
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
        "doit-esp32-devkit-v1-30pin" => {
            include_str!("../../src/catalog/boards/doit-esp32-devkit-v1-30pin.json")
        }
        "arduino-nano-atmega328p-ch340" => {
            include_str!("../../src/catalog/boards/arduino-nano-atmega328p-ch340.json")
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classic_esp32_profile_selects_its_toolchain_and_uart_console() {
        let board = profile("doit-esp32-devkit-v1-30pin").unwrap();
        assert_eq!(board["target"], "esp32");
        assert_eq!(board["espIdfVersion"], "5.4.4");
        assert_eq!(
            board["firmware"]["consoleModes"],
            serde_json::json!(["uart"])
        );
        assert_eq!(board["firmware"]["flashSizeMb"], 4);
        assert_eq!(target(Some("esp32".into())).unwrap(), "esp32");
        assert_eq!(compiler("esp32").unwrap(), "xtensa-esp32-elf-gcc");
        assert!(compiler("esp32;echo unsafe").is_err());
    }
}
