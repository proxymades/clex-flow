import { BTS7960, DC_MOTOR, MOTOR_PWM_TERMINALS, motorPwmChannels } from '../../hardware/dc-motor.js';

export function dcMotorFirmware(project, board, components, nodes) {
  const motors = components.filter(component => component.moduleId === BTS7960);
  const operations = new Map();
  if (!motors.length) return { feature: null, source: '', initialize: '', operations };

  const avr = board.platform === 'arduino-avr';
  const channels = avr ? [] : motorPwmChannels(project, board);
  const source = ['#include <math.h>'];
  const setup = [];
  if (!avr) {
    source.push('#include "driver/ledc.h"');
    setup.push(`  const ledc_timer_config_t motor_timer = {
    .speed_mode = LEDC_LOW_SPEED_MODE, .timer_num = LEDC_TIMER_1,
    .duty_resolution = LEDC_TIMER_8_BIT, .freq_hz = 20000,
    .clk_cfg = ${board.target === 'esp32' ? 'LEDC_USE_APB_CLK' : 'LEDC_AUTO_CLK'},
  };
  ESP_ERROR_CHECK(ledc_timer_config(&motor_timer));`);
  }

  for (const [index, motor] of motors.entries()) {
    const gpio = terminal => project.gpioAssignments.find(
      assignment => assignment.componentId === motor.id && assignment.terminalId === terminal
    ).gpio;
    const pinEnable = gpio('enable');
    const pwm = MOTOR_PWM_TERMINALS.map((terminal, offset) => ({
      pin: gpio(terminal),
      channel: channels[index * 2 + offset],
    }));
    const name = 'clex_motor_' + index;
    const enable = level => avr
      ? 'digitalWrite(' + pinEnable + ', ' + (level ? 'HIGH' : 'LOW') + ');'
      : 'ESP_ERROR_CHECK(gpio_set_level(' + pinEnable + ', ' + level + '));';
    const write = ({ pin, channel }, duty, indent = '  ') => avr
      ? 'analogWrite(' + pin + ', ' + duty + ');'
      : 'ESP_ERROR_CHECK(ledc_set_duty(LEDC_LOW_SPEED_MODE, ' + channel + ', ' + duty + '));\n' +
        indent + 'ESP_ERROR_CHECK(ledc_update_duty(LEDC_LOW_SPEED_MODE, ' + channel + '));';
    setup.push('  ' + enable(0), avr
      ? '  pinMode(' + pinEnable + ', OUTPUT);'
      : '  ESP_ERROR_CHECK(gpio_set_direction(' + pinEnable + ', GPIO_MODE_OUTPUT));');
    for (const { pin, channel } of pwm) {
      setup.push(avr ? `  digitalWrite(${pin}, LOW);
  pinMode(${pin}, OUTPUT);` : `  const ledc_channel_config_t motor_pwm_${channel} = {
    .gpio_num = ${pin}, .speed_mode = LEDC_LOW_SPEED_MODE, .channel = ${channel},
    .intr_type = LEDC_INTR_DISABLE, .timer_sel = LEDC_TIMER_1, .duty = 0, .hpoint = 0,
  };
  ESP_ERROR_CHECK(ledc_channel_config(&motor_pwm_${channel}));`);
    }

    const controls = nodes.filter(node => node.moduleId === DC_MOTOR && node.parameters.componentId === motor.id);
    if (!controls.length) continue;
    const maxDuty = avr ? 255 : 256;
    source.push(`static int ${name}_duty;

static void ${name}_set(bool reverse, float percent) {
  int duty = 0;
  if (isfinite(percent) && percent > 0.0f) {
    duty = percent >= 100.0f ? ${maxDuty} : (int)(percent * (${maxDuty}.0f / 100.0f) + 0.5f);
  }
  const int command = reverse ? -duty : duty;
  if (command == ${name}_duty) {
    return;
  }

  ${enable(0)}
  ${write(pwm[0], '0')}
  ${write(pwm[1], '0')}
  if (duty > 0) {
    if (reverse) {
      ${write(pwm[1], 'duty', '      ')}
    } else {
      ${write(pwm[0], 'duty', '      ')}
    }
    ${enable(1)}
  }
  ${name}_duty = command;
}`);

    for (const node of controls) {
      operations.set(node.id, {
        start(value) {
          const reverse = node.parameters.direction === 'reverse';
          return '  ' + name + '_set(' + reverse + ', ' + (value ?? node.parameters.speed) + ');';
        },
        stop: '  ' + name + '_set(false, 0.0f);',
      });
    }
  }

  return {
    feature: avr ? null : 'dc-motor-' + board.target,
    source: source.join('\n'),
    initialize: setup.join('\n'),
    operations,
  };
}
