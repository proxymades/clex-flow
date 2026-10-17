// Both platforms select exactly one event branch from the value sampled now.
export function selectNumberCode(node, expression, emit, integer = false) {
  const type = integer ? 'int64_t' : 'double';
  const literal = value => `${value}${integer ? 'LL' : '.0'}`;
  return `  ${type} selected = (${type})(${expression});
  if (selected == ${literal(node.parameters.firstValue)}) {
${emit('first')}
  } else if (selected == ${literal(node.parameters.secondValue)}) {
${emit('second')}
  } else {
${emit('other')}
  }`;
}
