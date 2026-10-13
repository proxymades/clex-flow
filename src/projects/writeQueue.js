export function createWriteQueue(write) {
  let tail = Promise.resolve();
  const queue = value => {
    const result = tail.then(() => write(value));
    tail = result.catch(() => {});
    return result;
  };
  queue.setWriter = current => { write = current; };
  return queue;
}

export function acknowledgeWrite(current, snapshot, saved) {
  return current?.id === snapshot.id && JSON.stringify(current) === JSON.stringify(snapshot) ? saved : current;
}
