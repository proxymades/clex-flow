// Capabilities belong to the module/platform description, not to the editor.
export function moduleSupportsBoard(module, board) {
 if(!module || !board || !module.compatibility?.targets.includes(board.target))return false;
 if(board.platform==='esp-idf')return module.compatibility.espIdf===board.espIdfVersion;
 return module.compatibility.platforms?.[board.platform]===board.coreVersion;
}
