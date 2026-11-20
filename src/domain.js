export function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
export function safeImageUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
export function integer(value, label, min = 0, max = 2147483647) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
}
const text = value => String(value ?? '').trim();
const nullable = value => text(value) || null;
export function itemPayload(form) {
  const name = text(form.name);
  if (!name) throw new Error('Enter an item name.');
  const price = text(form.price) === '' ? null : Number(form.price);
  if (price !== null && (!Number.isFinite(price) || price < 0)) throw new Error('Price must be zero or greater.');
  return {name, quantity:integer(form.quantity ?? 1,'Quantity',1),checked:!!form.checked,
    category:text(form.category) || 'Other', barcode:nullable(form.barcode),brand:nullable(form.brand),
    image_url:nullable(form.image_url),aisle:nullable(form.aisle),price,package_size:nullable(form.package_size),notes:nullable(form.notes)};
}
export function recipePayload(form) {
  const name = text(form.name);
  if (!name) throw new Error('Enter a recipe name.');
  return {name,description:text(form.description),servings:integer(form.servings ?? 1,'Servings',1),
    prep_minutes:integer(form.prep_minutes ?? 0,'Prep time'),cook_minutes:integer(form.cook_minutes ?? 0,'Cook time'),
    ingredients:String(form.ingredients ?? ''),instructions:String(form.instructions ?? ''),
    image_url:nullable(form.image_url),category:text(form.category),favorite:!!form.favorite,
    rating:integer(form.rating ?? 0,'Rating',0,5),source_url:nullable(form.source_url),source_name:nullable(form.source_name)};
}
export function mealSlotKey(date, mealType) {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date) throw new Error('Choose a valid date.');
  if (!['Breakfast','Lunch','Dinner'].includes(mealType)) throw new Error('Choose Breakfast, Lunch or Dinner.');
  return `${date}|${mealType}`;
}
export function canEditList(list,userId,members) {
  return !!list && (list.owner_id === userId || members.some(m => m.list_id === list.id && m.user_id === userId && ['owner','editor'].includes(m.role)));
}
export function rememberedAisle(storeId, target, lists, items) {
  if (!storeId) return '';
  const ids = new Set(lists.filter(l => l.store_id === storeId).map(l => l.id));
  const normalize = name => text(name).toLowerCase().replace(/\s+/g,' ');
  const candidates = items.filter(i => ids.has(i.list_id) && text(i.aisle));
  const matches = target.barcode && candidates.filter(i => text(i.barcode) === text(target.barcode));
  const pool = matches?.length ? matches : candidates.filter(i => normalize(i.name) === normalize(target.name));
  return pool.sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at))[0]?.aisle ?? '';
}
export function todayLocal() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function changedFields(before,after) {
  return Object.fromEntries(Object.entries(after).filter(([key,value]) => value !== before[key]));
}
export function photoSource(table,row,stores=[]) {
  const buckets={shopping_lists:'list-images',shopping_items:'item-images',store_profiles:'store-images',shared_recipes:'recipe-images'};
  if(table==='shopping_lists' && !text(row.image_path) && !safeImageUrl(row.image_url)) {
    const store=stores.find(store=>store.id===row.store_id && !store.deleted_at);
    if(store && (text(store.image_path) || safeImageUrl(store.image_url)))return {table:'store_profiles',row:store,bucket:'store-images'};
  }
  return {table,row,bucket:buckets[table]};
}
