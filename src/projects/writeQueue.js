export function createWriteQueue(write) {
  let tail = Promise.resolve();
  return value => {
    const result = tail.then(() => write(value));
    tail = result.catch(() => {});
    return result;
  };
}

export function acknowledgeWrite(current, snapshot, saved) {
  return current?.id === snapshot.id && JSON.stringify(current) === JSON.stringify(snapshot) ? saved : current;
}
