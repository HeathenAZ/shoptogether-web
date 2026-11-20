import test from 'node:test';
import assert from 'node:assert/strict';
import {recipeIngredientLines,ingredientAlreadyListed,recipeShoppingItems} from '../src/recipe-shopping.js';

test('ingredient lines retain amounts, units and repeated ingredients for separate steps',()=>{
  assert.deepEqual(recipeIngredientLines('  • ½ cup milk\r\n\n- 2 eggs\n1 onion\n1 onion\nFor the sauce:'),['½ cup milk','2 eggs','1 onion','1 onion','For the sauce:']);
});
test('only an exact unchecked ingredient on the target list is marked already present',()=>{
  const items=[{list_id:'a',name:'  ½ CUP   milk ',checked:false},{list_id:'a',name:'2 eggs',checked:true},{list_id:'b',name:'1 onion',checked:false},{list_id:'a',name:'Salt',checked:false,deleted_at:'2026-10-26'}];
  assert.equal(ingredientAlreadyListed('½ cup milk','a',items),true);
  assert.equal(ingredientAlreadyListed('milk','a',items),false);
  assert.equal(ingredientAlreadyListed('2 eggs','a',items),false);
  assert.equal(ingredientAlreadyListed('1 onion','a',items),false);
  assert.equal(ingredientAlreadyListed('Salt','a',items),false);
});
test('selected ingredients become normal Android-compatible shopping items, preserving text',()=>{
  let counter=0;
  const rows=recipeShoppingItems({name:'Pancakes',servings:4},'list-a',['½ cup milk','2 eggs'],()=>`new-${++counter}`);
  assert.equal(rows.length,2);assert.equal(rows[0].id,'new-1');assert.equal(rows[0].list_id,'list-a');
  assert.equal(rows[0].name,'½ cup milk');assert.equal(rows[0].quantity,1);assert.equal(rows[0].checked,false);
  assert.equal(rows[0].notes,'Recipe: Pancakes (4 servings)');assert.equal(rows[0].category,'Other');
  assert.equal(rows[0].barcode,null);assert.equal(rows[0].price,null);
  assert.throws(()=>recipeShoppingItems({name:'Soup'},'list-a',[]),/Select at least one/);
  assert.throws(()=>recipeShoppingItems({name:'Soup'},'', ['Salt']),/Choose a shopping list/);
});
