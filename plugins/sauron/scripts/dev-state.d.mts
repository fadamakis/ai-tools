export function devPaths(root:string):{root:string;database:string;current:string;lock:string;runtimeLocks:string;marketplace:string};
export function assertLocalPath(root:string,target:string):void;
export function currentBuild(root:string):{buildId:string;build:string};
export function acquireDevLock(root:string,purpose:string,options?:{allowRuntimes?:boolean}):()=>void;
export function acquireDevRuntimeLock(root:string,options?:{buildId?:string}):()=>void;
export function lockStatus(path:string):{pid:number;purpose:string;token:string;buildId?:string;alive:boolean}|null;
export function runtimeStatuses(root:string):Array<{path:string;pid:number;purpose:string;token:string;buildId?:string;alive:boolean}>;
