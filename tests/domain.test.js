import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, safeImageUrl, mealSlotKey, itemPayload, recipePayload, rememberedAisle, canEditList, photoSource } from '../src/domain.js';

test('untrusted names and image URLs cannot inject active HTML', () => {
  assert.equal(escapeHtml('<img onerror="alert(1)">'), '&lt;img onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(safeImageUrl('javascript:alert(1)'), '');
  assert.equal(safeImageUrl('file:///photo.jpg'), '');
  assert.equal(safeImageUrl('https://example.org/photo.jpg'), 'https://example.org/photo.jpg');
});
test('meal slot identity matches Android date|mealType', () => {
  assert.equal(mealSlotKey('2026-10-11', 'Dinner'), '2026-10-11|Dinner');
  assert.throws(() => mealSlotKey('2026-02-30', 'Dinner'));
  assert.throws(() => mealSlotKey('2026-10-11', 'Snack'));
});
test('item payload preserves barcode zeros and nullable price', () => {
  const row = itemPayload({name:' Milk ',quantity:'2',barcode:'001234567890',price:'',checked:true});
  assert.equal(row.barcode,'001234567890');
  assert.equal(row.price,null);
  assert.equal(row.quantity,2);
  assert.equal(row.name,'Milk');
  assert.throws(() => itemPayload({name:'Milk',quantity:'0',price:'-1'}));
  assert.throws(() => itemPayload({name:'',quantity:'1'}));
});
test('recipe text remains Android-compatible plain text and rating bounded', () => {
  const row = recipePayload({name:'Soup',servings:2,prep_minutes:5,cook_minutes:20,rating:5,ingredients:'1 onion\nWater',instructions:'Boil\nServe'});
  assert.equal(row.ingredients,'1 onion\nWater');
  assert.equal(row.instructions,'Boil\nServe');
  assert.throws(() => recipePayload({...row,rating:6}));
});
test('aisle memory stays within the chosen store and prefers the newest barcode match', () => {
  const lists = [{id:'a',store_id:'store-a'},{id:'b',store_id:'store-b'}];
  const items = [
    {list_id:'a',name:' Milk ',barcode:'001',aisle:'4',updated_at:'2026-10-10'},
    {list_id:'b',name:'Milk',barcode:'001',aisle:'8',updated_at:'2026-10-11'},
    {list_id:'a',name:'Milk',barcode:'001',aisle:'6',updated_at:'2026-10-11'}
  ];
  assert.equal(rememberedAisle('store-a',{name:'milk',barcode:'001'},lists,items),'6');
  assert.equal(rememberedAisle('store-c',{name:'milk'},lists,items),'');
});
test('viewers cannot edit, editors cannot change list ownership', () => {
  const list={id:'a',owner_id:'owner'};
  assert.equal(canEditList(list,'owner',[]),true);
  assert.equal(canEditList(list,'viewer',[{list_id:'a',user_id:'viewer',role:'viewer'}]),false);
  assert.equal(canEditList(list,'editor',[{list_id:'a',user_id:'editor',role:'editor'}]),true);
});
test('list covers use their assigned store image when there is no custom list photo',()=>{
  const store={id:'costco',name:'Costco',image_path:'owner/costco/photo'};
  const list={id:'weekly',name:'Weekly shop',store_id:'costco',image_path:null};
  assert.deepEqual(photoSource('shopping_lists',list,[store]),{table:'store_profiles',row:store,bucket:'store-images'});
});
test('custom list covers take priority; deleted and unassigned stores cannot supply a cover',()=>{
  const store={id:'costco',image_path:'owner/costco/photo'};
  const list={id:'weekly',store_id:'costco',image_path:'owner/weekly/photo'};
  assert.equal(photoSource('shopping_lists',list,[store]).bucket,'list-images');
  assert.equal(photoSource('shopping_lists',{...list,image_path:null},[{...store,deleted_at:'2026-10-11'}]).table,'shopping_lists');
  assert.equal(photoSource('shopping_lists',{...list,store_id:null,image_path:null},[store]).table,'shopping_lists');
});
