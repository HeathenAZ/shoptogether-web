import {itemPayload} from './domain.js';

export function recipeIngredientLines(ingredients) {
  return String(ingredients??'').split(/\r?\n/).map(line=>line.trim().replace(/^[-*•]\s+/, '')).filter(Boolean);
}
export function ingredientAlreadyListed(line,listId,items) {
  const normalized=value=>String(value??'').trim().toLowerCase().replace(/\s+/g,' ');
  return items.some(item=>item.list_id===listId&&!item.checked&&!item.deleted_at&&normalized(item.name)===normalized(line));
}
export function recipeShoppingItems(recipe,listId,lines,makeId=()=>crypto.randomUUID()) {
  if(!listId)throw new Error('Choose a shopping list.');
  if(!Array.isArray(lines)||!lines.length)throw new Error('Select at least one ingredient.');
  if(lines.length>200)throw new Error('Add up to 200 ingredients at a time.');
  return lines.map(line=>({id:makeId(),list_id:listId,...itemPayload({name:line,quantity:1,category:'Other',notes:`Recipe: ${recipe.name}${recipe.servings?` (${recipe.servings} servings)`:''}`})}));
}
