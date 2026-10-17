// Capabilities belong to the module/platform description, not to the editor.
export function moduleSupportsBoard(module, board) {
 if(!module || !board || !module.compatibility?.targets.includes(board.target))return false;
 if(board.platform==='esp-idf')return module.compatibility.espIdf===board.espIdfVersion;
 return module.compatibility.platforms?.[board.platform]===board.coreVersion;
}

export function moduleIsEventSource(module,node){
 const condition=module?.firmware?.eventSourceWhen;
 return Boolean(module?.firmware?.eventSource&&(!condition||(condition.values||[condition.value]).includes(node.parameters[condition.field])));
}
