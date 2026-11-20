import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseKey } from './config.js';
export const client = createClient(supabaseUrl,supabaseKey);
export const tables = ['shopping_lists','shopping_items','list_members','store_profiles','shared_recipes','shared_meal_plan_entries','sharing_group_members'];
// Only tables in the supabase_realtime publication. Subscribing to a table outside it
// makes Realtime register none of the channel's bindings while still reporting SUBSCRIBED.
export const liveTables = tables.filter(table => table !== 'sharing_group_members');
export async function rows(table,connection=client) {
  const result = [];
  for (let start=0;;start+=500) {
    const order = table === 'list_members' || table === 'sharing_group_members' ? 'user_id' : table === 'shared_meal_plan_entries' ? 'slot_key' : 'id';
    let query = connection.from(table).select('*').order(order).range(start,start+499);
    if (table === 'list_members') query = query.order('list_id');
    const {data,error} = await query;
    if (error) throw error;
    result.push(...data);
    if (data.length < 500) return result;
  }
}
export async function snapshot() {
  const results = await Promise.all(tables.map(async table => [table,await rows(table)]));
  return Object.fromEntries(results);
}
export async function rpc(name,args={}) {
  const {data,error} = await client.rpc(name,args);
  if (error) throw error;
  return data;
}
export async function insert(table,payload,connection=client) {
  const {data,error} = await connection.from(table).insert(payload).select().single();
  if (error) throw error;
  return data;
}
// Stable IDs make a retry after a lost response safe. Never overwrite an
// existing item, including one another device has subsequently edited.
export async function addRecipeItems(payload,connection=client) {
  if(!Array.isArray(payload)||!payload.length||payload.length>200)throw new Error('Select between 1 and 200 ingredients.');
  const listId=payload[0].list_id;
  if(!listId||payload.some(row=>row.list_id!==listId||!row.id)||new Set(payload.map(row=>row.id)).size!==payload.length)throw new Error('Ingredients must belong to one shopping list and have unique IDs.');
  const {error}=await connection.from('shopping_items').upsert(payload,{onConflict:'id',ignoreDuplicates:true});
  if(error)throw error;
  const result=await connection.from('shopping_items').select('id').eq('list_id',listId).is('deleted_at',null).in('id',payload.map(row=>row.id));
  if(result.error)throw result.error;
  if(new Set((result.data||[]).map(row=>row.id)).size!==payload.length)throw new Error('Some ingredients changed or could not be confirmed. Close this dialog and check the shopping list before adding them again.');
  return {listId,count:payload.length};
}
// Only changed fields are sent. Compare the observed timestamp to avoid replacing
// a newer Android/household edit. Server timestamps keep Android's LWW sync intact.
export async function update(table,before,patch,connection=client) {
  let query = connection.from(table).update(patch).eq('updated_at',before.updated_at);
  query = table === 'shared_meal_plan_entries' ? query.eq('group_id',before.group_id).eq('slot_key',before.slot_key) : query.eq('id',before.id);
  const {data,error} = await query.select().maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This record changed or your access changed. Refresh and reopen it before saving.');
  return data;
}
export async function remove(table,before,connection=client) {
  return update(table,before,{deleted_at:new Date().toISOString()},connection);
}
export async function imageUrl(bucket,row,connection=client) {
  if (!row.image_path) return row.image_url || '';
  const {data,error} = await connection.storage.from(bucket).createSignedUrl(row.image_path,1800);
  if(error)throw error;
  return data.signedUrl;
}
export async function uploadImage(bucket,path,file) {
  if (!['image/jpeg','image/png','image/webp','image/avif','image/heic','image/heif'].includes(file.type)) throw new Error('Choose a JPEG, PNG, WebP, AVIF or HEIC image.');
  if (file.size > 10*1024*1024) throw new Error('Choose an image smaller than 10 MB.');
  const {error} = await client.storage.from(bucket).upload(path,file,{upsert:false,contentType:file.type});
  if (error) throw error;
  return path;
}
