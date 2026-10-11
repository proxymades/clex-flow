import { indicatorState, indicatorLayout } from '../../displays/indicator.js';
const hex = value => '0x' + value.slice(1);
export function indicatorFirmware(component, screen, cString, fontSymbols) {
  const elements = screen.elements.filter(element=>element.type==='indicator');
  if (!elements.length) return {source:[],initialize:()=>[]};
  const source = ['/* CLEX indicators: device and element IDs address ordinary LVGL objects. */',
    'typedef struct { const char *key; double number; const char *text; uint32_t background, color, dot_color; } clex_indicator_state_t;',
    ...elements.flatMap((element,index)=>[
      `static const clex_indicator_state_t indicator_states_${index}[] = {`,
      ...element.states.map(state=>`  { ${cString(String(state.value))}, ${typeof state.value==='number'?String(state.value):'0'}, ${cString(state.text)}, ${hex(state.background)}, ${hex(state.color)}, ${hex(state.dotColor)} },`), '};']),
    'static struct { const char *component_id, *id; lv_obj_t *object, *label, *dot; const clex_indicator_state_t *states; size_t count, fallback; bool numeric, caption_override; int active; } clex_indicators[] = {',
    ...elements.map((element,index)=>`  { ${cString(component.id)}, ${cString(element.id)}, NULL, NULL, NULL, indicator_states_${index}, ${element.states.length}, ${element.states.findIndex(state=>state.id===element.fallbackStateId)}, ${element.valueType==='number'}, ${element.captionDynamic}, -1 },`), '};',
    'static void __attribute__((unused)) clex_graphics_set_indicator_state(const char *component_id, const char *element_id, const char *value) {',
    '  for (size_t i = 0; i < sizeof(clex_indicators) / sizeof(clex_indicators[0]); i++) {',
    '    if (strcmp(clex_indicators[i].component_id, component_id) || strcmp(clex_indicators[i].id, element_id)) continue;',
    '    size_t selected = clex_indicators[i].fallback;',
    '    for (size_t j = 0; j < clex_indicators[i].count; j++) if (clex_indicators[i].numeric ? strtod(value, NULL) == clex_indicators[i].states[j].number : strcmp(value, clex_indicators[i].states[j].key) == 0) { selected = j; break; }',
    '    if (clex_indicators[i].active == (int)selected) return;',
    '    clex_indicators[i].active = (int)selected;',
    '    const clex_indicator_state_t *state = &clex_indicators[i].states[selected];',
    '    lv_obj_set_style_bg_color(clex_indicators[i].object, lv_color_hex(state->background), LV_PART_MAIN);',
    '    lv_obj_set_style_text_color(clex_indicators[i].label, lv_color_hex(state->color), LV_PART_MAIN);',
    '    if (clex_indicators[i].dot) lv_obj_set_style_bg_color(clex_indicators[i].dot, lv_color_hex(state->dot_color), LV_PART_MAIN);',
    '    if (!clex_indicators[i].caption_override) lv_label_set_text(clex_indicators[i].label, state->text);',
    '    return;', '  }', '}',
    'static void __attribute__((unused)) clex_graphics_set_indicator_caption(const char *component_id, const char *element_id, const char *value) {',
    '  for (size_t i = 0; i < sizeof(clex_indicators) / sizeof(clex_indicators[0]); i++) if (!strcmp(clex_indicators[i].component_id, component_id) && !strcmp(clex_indicators[i].id, element_id)) {',
    '    clex_indicators[i].caption_override = true;',
    '    if (strcmp(lv_label_get_text(clex_indicators[i].label), value)) lv_label_set_text(clex_indicators[i].label, value);', '    return;', '  }', '}'];
  function initialize(element,index) {
    const slot=elements.indexOf(element), layout=indicatorLayout(element), state=indicatorState(element);
    const flow={left:'LV_FLEX_FLOW_ROW',right:'LV_FLEX_FLOW_ROW_REVERSE',top:'LV_FLEX_FLOW_COLUMN',bottom:'LV_FLEX_FLOW_COLUMN_REVERSE'}[element.dotPosition];
    const root=`indicator_${index}`,label=`indicator_label_${index}`,dot=`indicator_dot_${index}`;
    return [
      `  lv_obj_t *${root} = lv_obj_create(screen);`, `  clex_indicators[${slot}].object = ${root};`,
      `  lv_obj_set_size(${root}, ${element.width}, ${element.height});`, `  lv_obj_set_pos(${root}, ${element.x}, ${element.y});`,
      `  lv_obj_remove_flag(${root}, LV_OBJ_FLAG_SCROLLABLE);`, `  lv_obj_set_style_border_width(${root}, 0, LV_PART_MAIN);`,
      `  lv_obj_set_style_radius(${root}, ${element.radius}, LV_PART_MAIN);`, `  lv_obj_set_style_clip_corner(${root}, true, LV_PART_MAIN);`,
      `  lv_obj_set_style_bg_opa(${root}, LV_OPA_COVER, LV_PART_MAIN);`, `  lv_obj_set_style_pad_all(${root}, ${element.padding}, LV_PART_MAIN);`,
      `  lv_obj_set_style_pad_row(${root}, ${element.gap}, LV_PART_MAIN);`, `  lv_obj_set_style_pad_column(${root}, ${element.gap}, LV_PART_MAIN);`,
      `  lv_obj_set_flex_flow(${root}, ${flow});`, `  lv_obj_set_flex_align(${root}, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);`,
      ...(element.dotVisible?[`  lv_obj_t *${dot} = lv_obj_create(${root});`, `  clex_indicators[${slot}].dot = ${dot};`, `  lv_obj_set_size(${dot}, ${element.dotSize}, ${element.dotSize});`, `  lv_obj_set_style_radius(${dot}, LV_RADIUS_CIRCLE, LV_PART_MAIN);`, `  lv_obj_set_style_border_width(${dot}, 0, LV_PART_MAIN);`, `  lv_obj_set_style_bg_opa(${dot}, LV_OPA_COVER, LV_PART_MAIN);`, `  lv_obj_remove_flag(${dot}, LV_OBJ_FLAG_SCROLLABLE);`]:[]),
      `  lv_obj_t *${label} = lv_label_create(${root});`, `  clex_indicators[${slot}].label = ${label};`,
      `  lv_label_set_long_mode(${label}, LV_LABEL_LONG_CLIP);`, `  lv_obj_set_width(${label}, ${layout.labelWidth});`,
      `  lv_obj_set_height(${label}, LV_SIZE_CONTENT);`, `  lv_obj_set_style_max_height(${label}, ${layout.labelHeight}, LV_PART_MAIN);`,
      `  lv_obj_set_style_text_font(${label}, &${fontSymbols[element.fontId]}, LV_PART_MAIN);`,
      `  lv_obj_set_style_text_line_space(${label}, 0, LV_PART_MAIN);`, `  lv_obj_set_style_text_align(${label}, LV_TEXT_ALIGN_${element.align.toUpperCase()}, LV_PART_MAIN);`,
      `  lv_label_set_text(${label}, ${cString(element.captionDynamic?element.initialCaption:state.text)});`,
      `  clex_graphics_set_indicator_state(${cString(component.id)}, ${cString(element.id)}, ${cString(String(state.value))});`
    ];
  }
  return {source,initialize};
}
