import { isStepperDriver } from '../stepper/model.js';

export const BTS7960 = 'clex.hardware.bts7960';
export const DC_MOTOR = 'clex.logic.dc-motor';
export const MOTOR_PWM_TERMINALS = ['rpwm', 'lpwm'];
const nanoPwmPins = [3, 5, 6, 9, 10, 11];

export function resolveBts7960Module(component, module) {
  if (module?.id !== BTS7960 || component.moduleVersion !== '1.0.0') return module;
  return {
    ...module,
    terminals: module.terminals.filter(terminal => terminal.id !== 'enable-left').map(
      terminal => terminal.id === 'enable' ? { ...terminal, label: 'R_EN + L_EN' } : terminal
    ),
  };
}

export function motorPwmPinProblem(project, board, gpio) {
  if (board.platform !== 'arduino-avr') return null;
  if (!nanoPwmPins.includes(gpio)) return 'Этот вывод Nano не поддерживает аппаратный ШИМ.';
  if ([9, 10].includes(gpio) && project.components.some(isStepperDriver)) {
    return 'ШИМ на D9 и D10 недоступен: Timer1 занят шаговыми двигателями.';
  }
  return null;
}

export function motorPwmChannels(project, board) {
  const count = board.target === 'esp32c3' ? 6 : 8;
  const first = project.components.some(component => component.moduleId === 'clex.hardware.camera-dvp') ? 1 : 0;
  return Array.from({ length: count - first }, (_, index) => index + first);
}

export function motorAssemblyIssues(project, board) {
  const motors = project.components.filter(component => component.moduleId === BTS7960);
  if (!motors.length || board.platform === 'arduino-avr') return [];
  const available = Math.floor(motorPwmChannels(project, board).length / 2);
  if (motors.length <= available) return [];
  return [{
    severity: 'error',
    code: 'motor-pwm-channels',
    message: 'Недостаточно каналов ШИМ. С текущим набором компонентов можно подключить до ' + available + ' драйверов BTS7960.',
  }];
}
