export function sdkRequirement(board) {
  return board?.mcu?.startsWith('ESP32-S3') || board?.id==='esp32-s3-generic'
    ? {family:'esp-idf',version:board?.espIdfVersion || '5.4.4',target:'esp32s3',compiler:'Xtensa ESP32-S3 GCC',name:'ESP-IDF'} : null;
}
export const SDK_STATES={detected:'Обнаружен',ready:'Проверен',missing:'Недоступен',invalid:'Требует проверки / восстановления',installing:'Устанавливается',interrupted:'Установка прервана',failed:'Ошибка установки'};
