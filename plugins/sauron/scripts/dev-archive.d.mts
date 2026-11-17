import type {renameSync} from 'node:fs';
import type {ReviewState} from '../src/shared/review-contracts.js';
export function inspectDevDatabase(root:string):{storeId:string;review:ReviewState|null};
export function replaceDevDatabase(root:string,initialise:(path:string)=>void,options?:{move?:typeof renameSync;expectedStoreId?:string}):string;
