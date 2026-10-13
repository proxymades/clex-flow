const russianPlurals = new Intl.PluralRules('ru');

// Forms: one (компонент), few (компонента), many (компонентов).
// Fractional quantities use the genitive singular, like 1,5 компонента.
export function pluralForm(count, [one, few, many]) {
  const category = russianPlurals.select(count);
  return category === 'one' ? one : category === 'many' ? many : few;
}

export function formatCount(count, forms) {
  return count + ' ' + pluralForm(count, forms);
}
