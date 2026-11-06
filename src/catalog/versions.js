export function compareVersions(a,b){
 const left=a.split('.').map(Number),right=b.split('.').map(Number);
 for(let index=0;index<3;index++)if(left[index]!==right[index])return left[index]<right[index]?-1:1;
 return 0;
}
export function compatibleVersion(saved,installed){
 const valid=value=>typeof value==='string'&&/^\d+\.\d+\.\d+$/.test(value);
 return valid(saved)&&valid(installed)&&saved.split('.')[0]===installed.split('.')[0]&&compareVersions(saved,installed)<=0;
}
// Each instance keeps its own version; this index records the newest one in use.
export function moduleVersionIndex(elements){
 const versions={};
 for(const element of elements)if(!versions[element.moduleId]||compareVersions(versions[element.moduleId],element.moduleVersion)<0)versions[element.moduleId]=element.moduleVersion;
 return versions;
}
