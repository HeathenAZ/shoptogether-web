import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createClient} from '@supabase/supabase-js';
import {update,remove,insert,rows,imageUrl,addRecipeItems} from '../src/data.js';

// Exercise the real Supabase SDK against a local HTTP boundary. This proves the
// wire contract; it deliberately does not claim to prove production RLS writes.
async function boundary(handler,run) {
  const requests=[];
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const request={method:req.method,url:new URL(req.url,'http://localhost'),body:body?JSON.parse(body):null,headers:req.headers};
    requests.push(request);
    const response=handler(request,requests.length);
    res.writeHead(response.status||200,{'Content-Type':'application/json'});
    res.end(JSON.stringify(response.data));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const sdk=createClient(`http://127.0.0.1:${server.address().port}`,'test-publishable-key',{auth:{persistSession:false,autoRefreshToken:false}});
  try {await run(sdk,requests);} finally {await new Promise(resolve=>server.close(resolve));}
}
const observed={id:'android-item',list_id:'existing-list',updated_at:'2026-10-11T12:00:00+00:00',checked:false};
test('checked writes target the observed row and timestamp, sending only changed fields',async()=>{
  await boundary(()=>({data:{...observed,checked:true}}),async(sdk,requests)=>{
    await update('shopping_items',observed,{checked:true},sdk);
    const req=requests[0];assert.equal(req.method,'PATCH');assert.equal(req.url.pathname,'/rest/v1/shopping_items');
    assert.deepEqual(req.body,{checked:true});assert.equal(req.url.searchParams.get('id'),'eq.android-item');
    assert.equal(req.url.searchParams.get('updated_at'),'eq.2026-10-11T12:00:00+00:00');
  });
});
test('zero-row writes are conflicts, never reported as saved',async()=>{
  await boundary(()=>({data:null}),async(sdk)=>{
    await assert.rejects(update('shopping_items',observed,{checked:true},sdk),/changed or your access changed/);
  });
});
test('RLS rejection propagates to caller',async()=>{
  await boundary(()=>({status:403,data:{code:'42501',message:'new row violates row-level security policy'}}),async sdk=>{
    await assert.rejects(insert('shopping_items',{list_id:'someone-elses-list',name:'Milk'},sdk),error => error.code==='42501' && /row-level security/.test(error.message));
  });
});
test('deletion is a timestamped tombstone compatible with Android',async()=>{
  await boundary(req=>({data:{...observed,...req.body}}),async(sdk,requests)=>{
    await remove('shopping_items',observed,sdk);
    assert.equal(requests[0].method,'PATCH');assert.deepEqual(Object.keys(requests[0].body),['deleted_at']);
    assert.ok(Number.isFinite(Date.parse(requests[0].body.deleted_at)));
  });
});
test('meal-plan writes use both keys and preserve Android slot identity',async()=>{
  const before={group_id:'household-a',slot_key:'2026-10-11|Dinner',updated_at:observed.updated_at};
  await boundary(req=>({data:{...before,...req.body}}),async(sdk,requests)=>{
    await update('shared_meal_plan_entries',before,{title:'Soup'},sdk);
    assert.equal(requests[0].url.searchParams.get('group_id'),'eq.household-a');
    assert.equal(requests[0].url.searchParams.get('slot_key'),'eq.2026-10-11|Dinner');
    assert.equal(requests[0].url.searchParams.has('id'),false);
  });
});
test('reads paginate beyond the first page without truncating household data',async()=>{
  await boundary((_,index)=>({data:index===1?Array.from({length:500},(_,i)=>({id:String(i)})):[{id:'500'}]}),async(sdk,requests)=>{
    const data=await rows('shopping_items',sdk);assert.equal(data.length,501);
    assert.equal(requests.length,2);assert.equal(requests[1].url.searchParams.get('offset'),'500');
  });
});
test('store fallback signs its photo through the existing private store bucket',async()=>{
  await boundary(()=>({data:{signedURL:'/object/sign/store-images/owner/store/photo?token=test'}}),async(sdk,requests)=>{
    const url=await imageUrl('store-images',{image_path:'owner/store/photo'},sdk);
    assert.equal(requests[0].url.pathname,'/storage/v1/object/sign/store-images/owner/store/photo');
    assert.equal(requests[0].body.expiresIn,1800);
    assert.ok(url.includes('/storage/v1/object/sign/store-images/'));
  });
});
test('photo signing failures propagate so retries are not permanently cached as blank',async()=>{
  await boundary(()=>({status:403,data:{message:'Not authorized',error:'Unauthorized',statusCode:'403'}}),async sdk=>{
    await assert.rejects(imageUrl('store-images',{image_path:'owner/store/photo'},sdk),error=>/Not authorized/.test(error.message));
  });
});
test('recipe additions are one batch with ignore-duplicate semantics, and retry cannot overwrite phone edits',async()=>{
  const items=[{id:'recipe-item-1',list_id:'existing-list',name:'1 onion',quantity:1},{id:'recipe-item-2',list_id:'existing-list',name:'2 eggs',quantity:1}];
  const saved=new Map();
  await boundary(req=>{
    if(req.method==='POST')for(const row of req.body)if(!saved.has(row.id))saved.set(row.id,{...row});
    return {data:req.method==='GET'?[...saved.values()].map(row=>({id:row.id})):null};
  },async(sdk,requests)=>{
    assert.deepEqual(await addRecipeItems(items,sdk),{listId:'existing-list',count:2});
    saved.get('recipe-item-1').name='Phone edited onion';
    await addRecipeItems(items,sdk);
    assert.equal(saved.size,2);assert.equal(saved.get('recipe-item-1').name,'Phone edited onion');
    const posts=requests.filter(req=>req.method==='POST');assert.equal(posts.length,2);
    for(const req of posts){assert.equal(req.url.pathname,'/rest/v1/shopping_items');assert.equal(req.url.searchParams.get('on_conflict'),'id');assert.match(req.headers.prefer,/resolution=ignore-duplicates/);assert.deepEqual(req.body,items);}
  });
});
test('batch permission denial never becomes a success or partial client-side fallback',async()=>{
  await boundary(()=>({status:403,data:{code:'42501',message:'permission denied'}}),async(sdk,requests)=>{
    await assert.rejects(addRecipeItems([{id:'new-item',list_id:'viewer-list',name:'Milk'}],sdk),error=>error.code==='42501');
    assert.equal(requests.length,1);
  });
});
test('recipe additions require confirmation of every ID before reporting success',async()=>{
  await boundary(req=>({data:req.method==='GET'?[]:null}),async sdk=>{
    await assert.rejects(addRecipeItems([{id:'new-item',list_id:'existing-list',name:'Milk'}],sdk),/could not be confirmed/);
  });
});
