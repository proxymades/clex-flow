export const colorValid = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export function displayDescription(component, catalog) {
  return catalog.modules.find(module => module.id === component?.moduleId)?.display || null;
}
export function emptyScreen() { return { formatVersion: 1, background: '#000000', elements: [] }; }
export function screenFor(project, componentId) { return project.screens?.[componentId] || emptyScreen(); }
export function screenIssues(screen, display) {
  const issues = [];
  if (!display) return ['Описание дисплея отсутствует.'];
  if (screen.formatVersion !== 1 || !colorValid(screen.background) || !Array.isArray(screen.elements) || screen.elements.length > display.graphics.maxElements) return ['Некорректный интерфейс экрана.'];
  const ids = new Set();
  for (const element of screen.elements) {
    const font = display.graphics.fonts.find(font => font.id === element.fontId);
    if (element.type !== 'text' || typeof element.id !== 'string' || !element.id || ids.has(element.id)) issues.push('Некорректный или повторяющийся элемент экрана.');
    ids.add(element.id);
    if (!Number.isInteger(element.x) || !Number.isInteger(element.y) || element.x < 0 || element.y < 0 || element.x >= display.resolution.width || element.y >= display.resolution.height) issues.push('Координаты текста находятся вне экрана.');
    if (!font || !colorValid(element.color) || typeof element.text !== 'string' || element.text.length > 500) issues.push('Проверьте текст, цвет и доступный шрифт.');
    else if ([...element.text].some(char => !font.ranges.some(([min,max]) => char.codePointAt(0) >= min && char.codePointAt(0) <= max))) issues.push('Выбранный шрифт не содержит некоторые символы текста.');
  }
  return issues;
}
export function saveScreen(project, componentId, screen) {
  return { ...project, screens: { ...project.screens, [componentId]: structuredClone(screen) } };
}
