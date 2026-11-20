import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
test('household table changes trigger refresh; only Realtime-published tables are subscribed',async()=>{
 const handlers=[],statuses=[];let refreshed=0;
 const channel={on:(event,filter,callback)=>{handlers.push({event,filter,callback});return channel},subscribe:callback=>statuses.push(callback)};
 const tables=['shopping_lists','shopping_items','list_members','store_profiles','shared_recipes','shared_meal_plan_entries','sharing_group_members'];
 const liveTables=tables.filter(t=>t!=='sharing_group_members');
 const context=vm.createContext({client:{channel:()=>channel},user:{id:'test'},epoch:1,tables,liveTables,scheduleRefresh:()=>refreshed++,document:{querySelector:()=>null}});
 vm.runInContext('let channel=null,syncState="";'+source.slice(source.indexOf('async function subscribe()'),source.indexOf('async function changeUser')),context);
 await vm.runInContext('subscribe()',context);
 assert.deepEqual(handlers.map(h=>h.filter.table),liveTables);
 assert.ok(!handlers.some(h=>h.filter.table==='sharing_group_members'));
 for(const handler of handlers){assert.equal(handler.event,'postgres_changes');assert.equal(handler.filter.event,'*');handler.callback({eventType:'INSERT'});handler.callback({eventType:'UPDATE'});handler.callback({eventType:'DELETE'});}
 assert.equal(refreshed,18);statuses[0]('SUBSCRIBED');assert.equal(refreshed,19);
});
test('no timer downloads unchanged household data or resets photo cache',()=>{
 const timers=[];
 const context=vm.createContext({setInterval:(...args)=>timers.push(args),window:{addEventListener(){}},document:{addEventListener(){}}});
 vm.runInContext(source.slice(source.indexOf('render();',source.indexOf("await changeUser(initial.data.session"))+9,source.indexOf('function field(')),context);
 assert.equal(timers.length,0);
});
test('liveTables matches the Realtime publication',async()=>{
 const src=readFileSync(new URL('../src/data.js',import.meta.url),'utf8');
 assert.match(src,/liveTables = tables\.filter\(table => table !== 'sharing_group_members'\)/);
});
