const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase('ru').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function boardFamily(board) {
  if (board.platform === 'esp-idf') return 'ESP32';
  if (board.platform === 'arduino-avr') return 'Arduino AVR';
  return board.family || board.platform || board.target || board.mcu;
}
export function selectableBoards(boards, { query = '', family = '', manufacturer = '' } = {}) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return boards.filter(board => board.pins?.length && (!family || boardFamily(board) === family) && (!manufacturer || board.manufacturer === manufacturer) && words.every(word => normalize([board.name, board.id, board.mcu, board.target, board.manufacturer, board.revision, boardFamily(board)].join(' ')).includes(word)));
}
