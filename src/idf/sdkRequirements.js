const compilers = { esp32s3: 'Xtensa ESP32-S3 GCC', esp32p4: 'RISC-V ESP32 GCC' };
export function sdkRequirement(board) {
  if(board?.platform==='arduino-avr')return {family:'arduino-avr',version:board.coreVersion,target:board.target,compiler:board.firmware.compiler,name:'Arduino AVR'};
  const target = board?.target || (board?.id === 'esp32-s3-generic' ? 'esp32s3' : null);
  return compilers[target] ? { family: 'esp-idf', version: board.espIdfVersion || '5.4.4', target, compiler: board.firmware?.compiler || compilers[target], name: 'ESP-IDF' } : null;
}
export const SDK_STATES={detected:'Обнаружен',ready:'Проверен',missing:'Недоступен',invalid:'Требует проверки / восстановления',installing:'Устанавливается',interrupted:'Установка прервана',failed:'Ошибка установки'};
