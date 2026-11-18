export const XGZP_MODULE = 'clex.hardware.xgzp6847d';
export const XGZP_LOGIC = 'clex.logic.xgzp6847d';
export const isXgzp = component => component?.moduleId === XGZP_MODULE;
export function xgzpSupplyProblem(component, board) {
  if (!isXgzp(component) || Number(component.parameters.supplyVoltage) === (board.logicVoltage || 3.3)) return null;
  return board.logicVoltage === 5
    ? 'Для этой платы XGZP6847D подключается к питанию и подтяжкам I²C 5 В. Выберите питание 5 В.'
    : 'На ESP32 XGZP6847D подключается только к питанию и подтяжкам I²C 3,3 В. Питание 5 В недопустимо.';
}
export function xgzpPowerProblem(component, pin, board) {
  if (!isXgzp(component)) return null;
  const voltage = board.logicVoltage || 3.3;
  if (pin.kind !== 'power' || pin.voltage !== voltage) return voltage === 5
    ? 'Подключите VDD датчика к контакту питания 5 В.'
    : 'На ESP32 VDD датчика можно подключить только к контакту питания 3,3 В.';
  return xgzpSupplyProblem(component, board);
}
export function xgzpIssues(component, board) {
  if (!isXgzp(component)) return [];
  const issues = [];
  const voltageProblem = xgzpSupplyProblem(component, board);
  if (voltageProblem) issues.push(voltageProblem);
  if (!['4','8','16','32','64','128','256','512','1024','2048','4096','8192'].includes(component.parameters.kFactor)) issues.push('Выберите коэффициент K по диапазону и документации датчика.');
  return issues;
}
