import {compatibleVersion,compareVersions} from '../catalog/versions.js';

export function logicVersionProblem(node,catalog){
 const module=catalog.modules.find(item=>item.id===node.moduleId&&item.kind==='logic');
 if(!module)return 'Блок недоступен в библиотеке. Замените его доступным блоком и проверьте соединения.';
 if(compatibleVersion(node.moduleVersion,module.version))return null;
 const versions='В проекте v'+node.moduleVersion+', в библиотеке v'+module.version+'. ';
 if(compareVersions(node.moduleVersion,module.version)>0)return versions+'Для этого блока нужна более новая версия CLEX Flow. Обновите приложение или замените блок и проверьте соединения.';
 return versions+'Блок изменился. Замените его и проверьте соединения. '+(module.versionChange||'Изменились настройки или контакты блока.');
}
