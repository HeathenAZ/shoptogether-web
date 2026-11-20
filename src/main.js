import './style.css';
import {client,snapshot,rpc,insert,update,remove,imageUrl,uploadImage,tables,addRecipeItems} from './data.js';
import {escapeHtml as h,safeImageUrl,itemPayload,recipePayload,mealSlotKey,canEditList,rememberedAisle,todayLocal,changedFields,photoSource} from './domain.js';
import {recipeIngredientLines,ingredientAlreadyListed,recipeShoppingItems} from './recipe-shopping.js';

const app = document.querySelector('#app');
const dialog = document.querySelector('#editor');
const blank = () => Object.fromEntries(tables.map(t => [t,[]]));
let db=blank(), user=null, group=null, view='lists', selectedList=null, channel=null;
let epoch=0, refreshCounter=0, refreshTimer=null, ready=false, syncState='Connecting', query='', filter='all', week=todayLocal();
let authMode='signin', recovery=false, images=new Map(), imagePromises=new Map();
let syncing=false, resyncRequested=false, imageEpoch=0;
const live = table => db[table].filter(row => !row.deleted_at);
const names={lists:'Shopping Lists',stores:'Stores',recipes:'Recipes',meals:'Meal Plans',account:'Account & Sharing'};
const icons={lists:'▤',stores:'⌂',recipes:'♧',meals:'▦',account:'♙'};
const logo=`<img class="logo" src="${import.meta.env.BASE_URL}shoptogether-header.png" alt="ShopTogether">`;
const money=value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
const notice=(message,error=false)=>{
  const el=document.querySelector('#notice'); el.textContent=message; el.className=error?'show error':'show';
  clearTimeout(notice.timer); notice.timer=setTimeout(()=>el.className='',6500);
};
async function task(action) { try { await action(); } catch(error) { notice(error.message || 'Something went wrong. Please try again.',true); } }
function applyTheme(theme) {
  localStorage.setItem('shoptogether-theme',theme);
  document.documentElement.dataset.theme=theme==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):theme;
}
applyTheme(localStorage.getItem('shoptogether-theme') || 'system');
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if((localStorage.getItem('shoptogether-theme')||'system')==='system')applyTheme('system');});
const themeButton=()=>`<button class="icon-button" data-action="theme" aria-label="Toggle light and dark mode" title="Toggle appearance">◐</button>`;
function render() {
  if(!user || recovery) { renderAuth(); return; }
  const body=!ready?'<div class="empty"><span class="eyebrow">YOUR HOUSEHOLD</span><h2>Bringing everything together…</h2><p>Loading your shared ShopTogether data.</p><button data-action="refresh">Try again</button></div>':({lists:renderLists,stores:renderStores,recipes:renderRecipes,meals:renderMeals,account:renderAccount}[view])();
  app.innerHTML=`<div class="shell"><aside class="sidebar"><a class="brand" href="#lists">${logo}</a><span class="sidebar-label">YOUR HOUSEHOLD</span><nav aria-label="Main navigation">${Object.entries(names).map(([key,name])=>`<button class="nav-link ${view===key?'active':''}" data-action="navigate" data-value="${key}"><span aria-hidden="true">${icons[key]}</span>${name}${key==='lists'?`<small>${live('shopping_lists').length}</small>`:''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="household-note"><span class="gold">✦</span><strong>Better, together.</strong><p>One household. Every screen.</p></div><button class="profile" data-action="navigate" data-value="account"><span class="avatar">${h(user.email?.[0]?.toUpperCase()||'S')}</span><span><strong>Your account</strong><small>${h(user.email)}</small></span></button></div></aside><div class="workspace"><header class="topbar"><span class="breadcrumb">Your household <span>/</span> ${names[view]}</span><div class="top-actions"><span id="sync" class="sync ${syncState==='Live'?'online':''}"><i></i>${h(syncState)}</span>${syncButton()}${themeButton()}</div></header><main>${body}</main><footer>ShopTogether <span>Made for the way you shop, cook, and share.</span></footer></div></div>`;
  hydrateImages();
}
function renderAuth() {
  const title=recovery?'Choose a new password':authMode==='signup'?'Make room for together.':authMode==='reset'?'Let’s get you back in.':'Welcome back.';
  const button=recovery?'Save new password':authMode==='signup'?'Create account':authMode==='reset'?'Send reset email':'Sign in to your household';
  app.innerHTML=`<div class="auth-page"><header class="auth-header"><a href="#">${logo}</a><div><span class="domain">shop-together.app</span>${themeButton()}</div></header><div class="auth-layout"><section class="auth-story"><span class="eyebrow gold">LIFE’S BETTER TOGETHER</span><h1>A little less planning.<br>A lot more <em>together.</em></h1><p>Your lists, your recipes, your week.<br>All in one place. Shared with your people.</p><div class="story-art" aria-hidden="true"><div class="art-list"><div class="art-label">THIS WEEK’S LITTLE WINS <span>✦</span></div><div><i>✓</i> A list everyone can add to</div><div><i>✓</i> Your go-to recipes, ready</div><div><i>✓</i> Dinner, already decided</div><div class="art-line"></div><small>Phone, tablet, or desktop. Always together.</small></div><div class="art-tag">One household. Every screen.</div></div><div class="story-footer"><span>▤ Shared shopping</span><span>♧ Favorite recipes</span><span>▦ Meal planning</span></div></section><section class="auth-card"><span class="eyebrow">YOUR SHOPTOGETHER ACCOUNT</span><h2>${title}</h2><p>${recovery?'Use at least 8 characters.':authMode==='reset'?'We’ll send a secure link to your account email.':'Use the same account you use on your phone.'}</p><form id="auth-form">${!recovery?'<label>Email address<input type="email" name="email" autocomplete="email" placeholder="you@example.com" required></label>':''}${recovery||authMode!=='reset'?`<label>Password<input type="password" name="password" autocomplete="${recovery||authMode==='signup'?'new-password':'current-password'}" minlength="${authMode==='signup'||recovery?'8':'1'}" required placeholder="Enter your password"></label>`:''}<button class="primary auth-submit" type="submit">${button} <span>→</span></button><div id="auth-message" role="status" aria-live="polite"></div></form>${!recovery?`<div class="auth-links">${authMode==='signin'?'<button class="text-button" data-action="auth-mode" data-value="reset">Forgot password?</button>':''}<span>${authMode==='signin'?'New to ShopTogether?':''} <button class="text-button" data-action="auth-mode" data-value="${authMode==='signin'?'signup':'signin'}">${authMode==='signin'?'Create an account':'Back to sign in'}</button></span></div>`:''}<div class="auth-trust"><span>♙</span><div><strong>Your household stays yours.</strong><p>Sign in to access your shared lists and recipes across both phones and the web.</p></div></div></section></div><footer class="auth-footer">ShopTogether <span>Shopping • Cooking • Sharing</span></footer></div>`;
}
function pageHeading(kicker,title,description,action='',label='') {
  return `<div class="page-heading"><div><span class="eyebrow">${h(kicker)}</span><h1>${h(title)}</h1><p>${h(description)}</p></div>${action?`<button class="primary" data-action="${action}">＋ ${h(label)}</button>`:''}</div>`;
}
function empty(title,description,action,label) {
  return `<div class="empty"><div class="empty-icon">✦</div><h2>${h(title)}</h2><p>${h(description)}</p>${action?`<button class="primary" data-action="${action}">＋ ${h(label)}</button>`:''}</div>`;
}
function photo(table,row,bucket,css='thumb') {
  const source=photoSource(table,row,db.store_profiles);
  table=source.table;row=source.row;bucket=source.bucket;
  const key=`${bucket}:${row.image_path || row.image_url || row.id}`;
  return `<div class="${css}" data-photo-table="${table}" data-photo-id="${h(row.id)}" data-photo-key="${h(key)}"><span aria-hidden="true">${table==='shared_recipes'?'♧':table==='store_profiles'?'⌂':'▤'}</span></div>`;
}
function paintPhoto(key,url,row) {
  for(const target of app.querySelectorAll('[data-photo-key]')) {
    if(target.dataset.photoKey!==key)continue;
    target.querySelector('.photo-error')?.remove();target.classList.remove('image-unavailable');
    const previous=target.querySelector('img');
    if(previous?.getAttribute('src')===url)continue;
    previous?.remove();
    const img=document.createElement('img');img.src=url;img.alt=row.name;img.loading='lazy';img.referrerPolicy='no-referrer';
    img.addEventListener('error',()=>{if(target.dataset.photoKey===key){images.delete(key);img.remove();showPhotoError(key);}}, {once:true});
    target.append(img);
  }
}
function showPhotoError(key) {
  for(const target of app.querySelectorAll('[data-photo-key]')) {
    if(target.dataset.photoKey!==key)continue;
    target.classList.add('image-unavailable');
    if(!target.querySelector('.photo-error')){const label=document.createElement('small');label.className='photo-error';label.textContent='Photo unavailable';label.title='Use Sync Everything to retry loading this photo.';target.append(label);}
  }
}
function resetImages() {imageEpoch++;images.clear();imagePromises.clear();}
async function hydrateImages() {
  const requests=new Map(),generation=epoch,photoGeneration=imageEpoch;
  for(const el of app.querySelectorAll('[data-photo-id]')) {
    const table=el.dataset.photoTable,row=db[table].find(r=>r.id===el.dataset.photoId);
    if(!row || !(row.image_path || row.image_url))continue;
    const bucket={shopping_lists:'list-images',shopping_items:'item-images',store_profiles:'store-images',shared_recipes:'recipe-images'}[table];
    const key=el.dataset.photoKey;
    if(images.has(key)){paintPhoto(key,images.get(key),row);continue;}
    let pending=imagePromises.get(key);
    if(!pending){
      pending=(async()=>{
        try {
          const url=safeImageUrl(await imageUrl(bucket,row));
          if(generation!==epoch||photoGeneration!==imageEpoch)return;
          if(!url)throw new Error('This photo has no usable image URL.');
          images.set(key,url);paintPhoto(key,url,row);
        } catch(error) {if(generation===epoch&&photoGeneration===imageEpoch)showPhotoError(key);return error;}
        finally {if(imagePromises.get(key)===pending)imagePromises.delete(key);}
      })();
      imagePromises.set(key,pending);
    }
    requests.set(key,pending);
  }
  return (await Promise.all(requests.values())).filter(Boolean).length;
}
function renderLists() {
  const lists=live('shopping_lists');
  if(selectedList && !lists.some(l=>l.id===selectedList))selectedList=null;
  if(selectedList)return renderListDetail(lists.find(l=>l.id===selectedList));
  const items=live('shopping_items').filter(i=>lists.some(l=>l.id===i.list_id));
  return pageHeading('SHOPPING, SHARED','A good shop starts here.','Everyone’s essentials. One shared list.','new-list','New list')+`<div class="stats"><div><span>YOUR LISTS</span><strong>${lists.length}</strong></div><div><span>STILL TO PICK UP</span><strong>${items.filter(i=>!i.checked).length}</strong></div><div><span>CHECKED OFF</span><strong>${items.filter(i=>i.checked).length}<small> little wins</small></strong></div></div><div class="section-heading"><h2>Your shopping lists</h2><span>Shared across your devices</span></div>${lists.length?`<div class="list-grid">${lists.map(list=>{
    const its=items.filter(i=>i.list_id===list.id),done=its.filter(i=>i.checked).length,store=live('store_profiles').find(s=>s.id===list.store_id),role=list.owner_id===user.id?'Owner':canEditList(list,user.id,db.list_members)?'Editor':'Viewer';
    return `<button class="list-card" data-action="open-list" data-id="${h(list.id)}">${photo('shopping_lists',list,'list-images','list-cover')}<div class="card-content"><div class="card-meta"><span>${h(store?.name||'Any store')}</span><span class="badge">${role}</span></div><h3>${h(list.name)}</h3><p>${its.length?its.slice(0,3).map(i=>h(i.name)).join(' · '):'Ready for your first item'}</p><div class="progress"><i style="width:${its.length?done/its.length*100:0}%"></i></div><div class="card-bottom"><span>${done} of ${its.length} picked up</span><span class="card-arrow">↗</span></div></div></button>`;
  }).join('')}</div>`:empty('Your next shop starts here.','Create a list and start adding the things you need.','new-list','Create your first list')}`;
}
function renderListDetail(list) {
  const editable=canEditList(list,user.id,db.list_members),owner=list.owner_id===user.id;
  const all=live('shopping_items').filter(i=>i.list_id===list.id),store=live('store_profiles').find(s=>s.id===list.store_id);
  const selected=all.filter(i=>(filter==='all'||(filter==='checked'?i.checked:!i.checked))&&`${i.name} ${i.brand||''} ${i.barcode||''}`.toLowerCase().includes(query.toLowerCase()));
  selected.sort((a,b)=>Number(a.checked)-Number(b.checked)||(a.category||'Other').localeCompare(b.category||'Other')||(a.aisle||'').localeCompare(b.aisle||'',undefined,{numeric:true})||a.name.localeCompare(b.name));
  const total=all.reduce((sum,i)=>sum+(i.price??0)*i.quantity,0);
  return `<button class="text-button back" data-action="back-lists">← All lists</button>${pageHeading(store?.name||'ANY STORE',list.name,`${all.filter(i=>i.checked).length} of ${all.length} picked up · ${money(total)} estimated total`,editable?'new-item':'', 'Add item')}<div class="detail-actions">${owner?`<button data-action="edit-list" data-id="${h(list.id)}">Edit list</button><button data-action="share-list" data-id="${h(list.id)}">Share list</button>`:`<span class="badge">${editable?'Shared • Editor':'Shared • View only'}</span><button data-action="leave-list" data-id="${h(list.id)}">Leave list</button>`}</div><div class="toolbar"><label class="search"><span>⌕</span><input id="search" type="search" value="${h(query)}" placeholder="Find an item, brand or barcode" aria-label="Search items"></label><div class="tabs">${[['all','All'],['unchecked','To pick up'],['checked','Checked']].map(([id,label])=>`<button data-action="filter" data-value="${id}" class="${filter===id?'active':''}">${label}</button>`).join('')}</div></div>${selected.length?`<section class="items-panel">${selected.map((i,index)=>`${index===0||selected[index-1].category!==i.category?`<div class="category-heading">${h(i.category||'Other')}</div>`:''}<article class="item-row ${i.checked?'checked':''}"><input class="check-item" type="checkbox" aria-label="Mark ${h(i.name)} ${i.checked?'unchecked':'checked'}" data-check-id="${h(i.id)}" ${i.checked?'checked':''} ${editable?'':'disabled'}>${photo('shopping_items',i,'item-images')}<button class="item-text" data-action="edit-item" data-id="${h(i.id)}"><strong>${h(i.name)}</strong><small>${h([i.brand,i.package_size,i.aisle?`Aisle ${i.aisle}`:''].filter(Boolean).join(' · '))||'View item details'}</small>${i.notes?`<span class="item-note">${h(i.notes)}</span>`:''}</button><span class="quantity">×${i.quantity}</span><span class="item-price">${i.price!=null?money(i.price):'—'}</span><button class="icon-button" data-action="edit-item" data-id="${h(i.id)}" aria-label="Details for ${h(i.name)}">↗</button></article>`).join('')}</section>`:empty(all.length?'No matching items.':'Let’s fill this list.',all.length?'Try a different search or filter.':'Add an item. Your household will see it too.',editable&&!all.length?'new-item':'','Add your first item')}`;
}
function renderStores() {
  const stores=live('store_profiles');
  return pageHeading('KNOW YOUR WAY AROUND','Your familiar places.','Stores and aisle details, ready for the next shop.','new-store','Add store')+(stores.length?`<div class="store-grid">${stores.map(store=>{
    const ids=new Set(db.shopping_lists.filter(l=>l.store_id===store.id).map(l=>l.id));
    const memory=new Map();
    db.shopping_items.filter(i=>ids.has(i.list_id)&&i.aisle).sort((a,b)=>new Date(a.updated_at)-new Date(b.updated_at)).forEach(i=>memory.set((i.barcode||i.name).toLowerCase(),i));
    return `<article class="store-card">${photo('store_profiles',store,'store-images','store-cover')}<div class="card-content"><span class="eyebrow">${h(store.location||'YOUR STORE')}</span><h2>${h(store.name)}</h2><p>${h(store.notes||'A familiar stop on your shopping route.')}</p><button data-action="edit-store" data-id="${h(store.id)}">${store.owner_id===user.id?'Edit store':'View details'}</button><details><summary>${memory.size} remembered aisle${memory.size===1?'':'s'}</summary><p class="muted">From your accessible synced shopping items.</p>${[...memory.values()].map(i=>`<div class="memory-row"><span>${h(i.name)}</span><strong>Aisle ${h(i.aisle)}</strong></div>`).join('')||'<p>Add an aisle to a shopping item to remember it here.</p>'}</details></div></article>`;
  }).join('')}</div>`:empty('Make yourself at home.','Add the stores where you shop.','new-store','Add your first store'));
}
function renderRecipes() {
  const recipes=live('shared_recipes').filter(r=>(filter!=='favorites'||r.favorite)&&`${r.name} ${r.category} ${r.ingredients}`.toLowerCase().includes(query.toLowerCase()));
  return pageHeading('FROM YOUR KITCHEN','Good food. Great company.','Keep the recipes your household loves close at hand.','new-recipe','New recipe')+'<div class="recipe-import-actions"><button data-action="import-recipe">↗ Import from website</button><span>Bring a recipe from a website into your shared kitchen.</span></div>'+`<div class="toolbar"><label class="search"><span>⌕</span><input id="search" type="search" value="${h(query)}" placeholder="Find a recipe, category or ingredient" aria-label="Search recipes"></label><div class="tabs"><button data-action="filter" data-value="all" class="${filter==='all'?'active':''}">All recipes</button><button data-action="filter" data-value="favorites" class="${filter==='favorites'?'active':''}">♡ Favorites</button></div></div>`+(recipes.length?`<div class="recipe-grid">${recipes.map(recipe=>`<article class="recipe-card"><button class="recipe-image-button" data-action="view-recipe" data-id="${h(recipe.id)}">${photo('shared_recipes',recipe,'recipe-images','recipe-cover')}</button><button class="favorite ${recipe.favorite?'selected':''}" data-action="favorite" data-id="${h(recipe.id)}" aria-label="${recipe.favorite?'Unfavorite':'Favorite'} ${h(recipe.name)}">${recipe.favorite?'♥':'♡'}</button><div class="card-content"><span class="eyebrow">${h(recipe.category||'FROM YOUR KITCHEN')}</span><button class="title-button" data-action="view-recipe" data-id="${h(recipe.id)}"><h3>${h(recipe.name)}</h3></button><p>${h(recipe.description||'A recipe to come back to.')}</p><div class="card-bottom"><span>${recipe.prep_minutes+recipe.cook_minutes} min · ${recipe.servings} serving${recipe.servings===1?'':'s'}</span><span class="stars" aria-label="${recipe.rating} of 5 stars">${'★'.repeat(recipe.rating)}${'☆'.repeat(5-recipe.rating)}</span></div></div></article>`).join('')}</div>`:empty('Something delicious starts here.','Add a recipe or try a different search.','new-recipe','Add a recipe'));
}
function renderMeals() {
  const dates=Array.from({length:7},(_,i)=>{const d=new Date(`${week}T12:00:00`);d.setDate(d.getDate()+i);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;});
  return pageHeading('A LITTLE PLANNING, A LOT LESS GUESSING','What’s cooking this week?','Plan the meals. Leave more room for the good stuff.')+`<div class="week-toolbar"><button data-action="week" data-value="-7" aria-label="Previous week">←</button><label>Week starting<input type="date" id="week-date" value="${week}"></label><button data-action="week" data-value="7" aria-label="Next week">→</button><button data-action="today">Today</button></div><div class="meal-grid">${dates.map(date=>`<section class="meal-day"><header><span>${new Date(`${date}T12:00:00`).toLocaleDateString(undefined,{weekday:'short'})}</span><strong>${new Date(`${date}T12:00:00`).getDate()}</strong><small>${new Date(`${date}T12:00:00`).toLocaleDateString(undefined,{month:'short'})}</small></header>${['Breakfast','Lunch','Dinner'].map(type=>{const entry=live('shared_meal_plan_entries').find(m=>m.slot_key===mealSlotKey(date,type));return `<button class="meal-slot ${entry?'filled':''}" data-action="edit-meal" data-date="${date}" data-type="${type}"><span class="eyebrow">${type}</span><strong>${entry?h(entry.title):'＋ Add meal'}</strong>${entry?.notes?`<small>${h(entry.notes)}</small>`:''}</button>`;}).join('')}</section>`).join('')}</div><p class="muted meal-tip">✦ Choose one of your shared recipes or add a meal of your own.</p>`;
}
function renderAccount() {
  return pageHeading('YOUR PEOPLE, YOUR PREFERENCES','At home, together.','Manage your account, household sharing, and appearance.')+`<div class="account-grid"><section class="panel"><span class="eyebrow">YOUR ACCOUNT</span><h2>${h(user.email)}</h2><p>You’re signed in to the same ShopTogether account used on your phone.</p><button data-action="signout">Sign out</button><hr><h3>Appearance</h3><label>Color mode<select id="theme-select">${['system','light','dark'].map(mode=>`<option value="${mode}" ${(localStorage.getItem('shoptogether-theme')||'system')===mode?'selected':''}>${mode[0].toUpperCase()+mode.slice(1)}</option>`).join('')}</select></label></section><section class="panel"><span class="eyebrow">ACCOUNT & SHARING</span><h2>Your household</h2><p>Share shopping lists, recipes, and meal plans with another existing ShopTogether account.</p><button class="primary" data-action="share-household">Share everything</button><div id="partners">Loading sharing partners…</div><hr><h3>Share just one list</h3><p>Open a list you own and choose “Share list”.</p></section></div>`;
}
async function refresh({quiet=false,strict=false}={}) {
  if(!user)return;
  const generation=epoch,serial=++refreshCounter;
  try {
    const next=await snapshot();
    if(generation!==epoch||serial!==refreshCounter)return;
    db=next;group=next.sharing_group_members.find(m=>m.user_id===user.id)?.group_id||null;ready=true;
    if(!navigator.onLine)syncState='Offline';
    render();
    if(view==='account')loadPartners();
    return true;
  } catch(error) {if(generation===epoch){syncState='Sync unavailable';render();if(strict)throw error;if(!quiet)notice(`Could not load shared data: ${error.message}`,true);}return false;}
}
function scheduleRefresh(){if(syncing){resyncRequested=true;return;}clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refresh({quiet:true}),300);}
function syncButton() {return `<button class="sync-everything" data-action="sync-everything" ${syncing?'disabled':''} aria-busy="${syncing}"><span aria-hidden="true">↻</span> ${syncing?'Syncing…':'Sync Everything'}</button>`;}
async function syncEverything() {
  if(syncing||!user)return;
  if(!navigator.onLine)throw new Error('You’re offline. Connect to the internet, then try Sync Everything again.');
  const generation=epoch;syncing=true;resyncRequested=false;clearTimeout(refreshTimer);resetImages();render();
  try {
    await subscribe();
    if(!await refresh({strict:true}))throw new Error('Shared data changed during sync. Please try again.');
    const failed=await hydrateImages();
    if(generation===epoch)notice(failed?`Shared data synced. ${failed} photo${failed===1?'':'s'} could not reload. Try Sync Everything again.`:'Everything synced. Your shared data is up to date.',failed>0);
  } finally {if(generation===epoch){syncing=false;render();if(resyncRequested)scheduleRefresh();}}
}
async function subscribe() {
  if(channel)await client.removeChannel(channel);
  if(!user)return;
  const generation=epoch;
  channel=client.channel(`web-household-${user.id}-${generation}`);
  // React only to this app's data, not other apps sharing the database.
  for(const table of tables)channel.on('postgres_changes',{event:'*',schema:'public',table},scheduleRefresh);
  channel.subscribe(status=>{
    if(generation!==epoch)return;
    syncState=status==='SUBSCRIBED'?'Live':status==='CHANNEL_ERROR'||status==='TIMED_OUT'?'Reconnecting':'Connecting';
    const el=document.querySelector('#sync');if(el){el.className=`sync ${syncState==='Live'?'online':''}`;el.innerHTML=`<i></i>${h(syncState)}`;}
    if(status==='SUBSCRIBED')scheduleRefresh();
  });
}
async function changeUser(session,event) {
  if(event==='PASSWORD_RECOVERY'){recovery=true;renderAuth();return;}
  const next=session?.user||null;
  if(next?.id===user?.id){user=next;if(recovery)renderAuth();return;}
  epoch++;user=next;syncing=false;if(!next)recovery=false;db=blank();resetImages();group=null;ready=false;selectedList=null;dialog.close();render();
  if(channel){await client.removeChannel(channel);channel=null;}
  if(user){await subscribe();await refresh();}
}
client.auth.onAuthStateChange((event,session)=>{setTimeout(()=>task(()=>changeUser(session,event)),0);});
const initial=await client.auth.getSession();
if(initial.error)notice(initial.error.message,true);
await changeUser(initial.data.session,'INITIAL_SESSION');
render();
// Realtime changes trigger refreshes. Keep reconnect/resume catch-up and the
// manual recovery button, without repeatedly downloading unchanged snapshots.
window.addEventListener('online',()=>{syncState='Connecting';task(subscribe);refresh();});
window.addEventListener('offline',()=>{syncState='Offline';render();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&user&&!syncing)refresh({quiet:true});});

function field(name,label,value='',type='text',extras='') {
  if(type==='textarea')return `<label class="wide">${label}<textarea name="${name}" rows="4" ${extras}>${h(value)}</textarea></label>`;
  if(type==='checkbox')return `<label class="checkbox-label wide"><input type="checkbox" name="${name}" ${value?'checked':''} ${extras}>${label}</label>`;
  return `<label>${label}<input name="${name}" type="${type}" value="${h(value)}" ${extras}></label>`;
}
function selectField(name,label,value,options) {
  return `<label>${label}<select name="${name}">${options.map(([id,name])=>`<option value="${h(id)}" ${id===value?'selected':''}>${h(name)}</option>`).join('')}</select></label>`;
}
function imageField(){return '<label class="wide">Upload image<input name="image_file" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"><small>Up to 10 MB. Stored privately with your existing ShopTogether images.</small></label>';}
let saveHandler=null,afterSaveHandler=null,saveSuccessMessage='Saved to your household.',saveBusyLabel='Saving…',editorVersion=0;
function openEditor(title,content,handler,{readOnly=false,deletable=false,onDelete=null,description='',saveLabel='Save changes',busyLabel='Saving…',successMessage='Saved to your household.',afterSave=null}={}) {
  saveHandler=handler;afterSaveHandler=afterSave;saveSuccessMessage=successMessage;saveBusyLabel=busyLabel;editorVersion++;
  dialog.innerHTML=`<div class="dialog-header"><div><span class="eyebrow">SHOPTOGETHER</span><h2>${h(title)}</h2></div><button class="icon-button" type="button" data-action="close" aria-label="Close dialog">×</button></div>${description?`<p>${h(description)}</p>`:''}<form id="editor-form"><fieldset class="form-grid" ${readOnly?'disabled':''}>${content}</fieldset><div id="editor-error" role="alert"></div><div class="dialog-actions">${deletable?'<button class="danger" type="button" id="delete-record">Delete</button>':''}<button type="button" data-action="close">${readOnly?'Close':'Cancel'}</button>${readOnly?'':'<button class="primary" type="submit">Save changes</button>'}</div></form>`;
  const submitButton=dialog.querySelector('button[type="submit"]');if(submitButton)submitButton.textContent=saveLabel;
  if(!dialog.open)dialog.showModal();
  dialog.querySelector('#delete-record')?.addEventListener('click',()=>{
    openEditor('Delete this record?', '<p class="wide">This removes it from your shared household and synced devices.</p>',onDelete,{description:'You can cancel to keep it.'});
  });
}
async function ensureGroup(){if(!group)group=await rpc('get_my_sharing_group');return group;}
async function uploaded(form,bucket,id,listId=null) {
  const file=form.get('image_file');
  if(!file?.size)return null;
  const version=`${Date.now()}-${crypto.randomUUID()}`;
  const path=bucket==='recipe-images'?`${await ensureGroup()}/${id}/${version}`:bucket==='item-images'?`${user.id}/${listId}/${id}/${version}`:`${user.id}/${id}/${version}`;
  return uploadImage(bucket,path,file);
}
async function saveRow(table,before,payload,form,bucket,listId=null) {
  const id=before?.id||crypto.randomUUID();
  const patch=before?changedFields(before,payload):{id,...payload};
  const path=await uploaded(form,bucket,id,listId);
  if(path)patch.image_path=path;
  try {
    if(before) {if(Object.keys(patch).length)await update(table,before,patch);}
    else await insert(table,patch);
  } catch(error) {
    // Only remove a newly uploaded, unreferenced object after a failed row save.
    if(path)await client.storage.from(bucket).remove([path]);
    throw error;
  }
}
function listEditor(before=null) {
  openEditor(before?'Edit shopping list':'Create a shopping list',field('name','List name',before?.name||'','text','required maxlength="200"')+selectField('store_id','Store',before?.store_id||'',[['','Any store'],...live('store_profiles').map(s=>[s.id,s.name])])+imageField(),async form=>{
    const name=String(form.get('name')).trim();if(!name)throw new Error('Enter a list name.');
    await saveRow('shopping_lists',before,{name,store_id:form.get('store_id')||null,...(!before?{owner_id:user.id}:{})},form,'list-images');
  },{deletable:!!before,onDelete:()=>remove('shopping_lists',before)});
}
function itemEditor(before=null) {
  const list=live('shopping_lists').find(l=>l.id===(before?.list_id||selectedList));
  if(!list)throw new Error('Choose a shopping list first.');
  const editable=canEditList(list,user.id,db.list_members);
  const value=before||{quantity:1,category:'Other'};
  openEditor(before?'Item details':'Add a shopping item',field('name','Item name',value.name||'','text','required maxlength="300"')+field('quantity','Quantity',value.quantity,'number','min="1" step="1" required')+field('barcode','Barcode',value.barcode,'text','inputmode="numeric"')+field('brand','Brand',value.brand)+field('category','Category',value.category||'Other')+field('aisle','Aisle',value.aisle)+field('price','Unit price ($)',value.price??'','number','min="0" step="0.01"')+field('package_size','Package size',value.package_size)+field('image_url','Image URL',value.image_url,'url')+imageField()+field('notes','Notes',value.notes,'textarea')+field('checked','Already picked up',value.checked,'checkbox'),async form=>{
    const payload=itemPayload({...Object.fromEntries(form),checked:form.has('checked')});
    await saveRow('shopping_items',before,{...payload,...(!before?{list_id:list.id}:{})},form,'item-images',list.id);
  },{readOnly:!editable,deletable:!!before&&editable,onDelete:()=>remove('shopping_items',before),description:list.store_id?'Aisle suggestions come from items at this store.':''});
  if(!before&&editable){
    const applyAisle=()=>{const form=dialog.querySelector('form'),aisle=form.elements.aisle;if(!aisle.value||aisle.dataset.suggested==='true'){aisle.value=rememberedAisle(list.store_id,{name:form.elements.name.value,barcode:form.elements.barcode.value},db.shopping_lists,db.shopping_items);aisle.dataset.suggested='true';}};
    dialog.querySelector('[name="name"]').addEventListener('change',applyAisle);dialog.querySelector('[name="barcode"]').addEventListener('change',applyAisle);dialog.querySelector('[name="aisle"]').addEventListener('input',e=>e.target.dataset.suggested='false');
  }
}
function storeEditor(before=null) {
  const owner=!before||before.owner_id===user.id;
  openEditor(before?'Store details':'Add a store',field('name','Store name',before?.name,'text','required')+field('location','Location',before?.location)+field('notes','Notes',before?.notes,'textarea')+imageField(),async form=>{
    const name=String(form.get('name')).trim();if(!name)throw new Error('Enter a store name.');
    await saveRow('store_profiles',before,{name,location:form.get('location')||null,notes:form.get('notes')||null,...(!before?{owner_id:user.id}:{})},form,'store-images');
  },{readOnly:!owner});
}
function recipeEditor(before=null,draft=null,warnings=[]) {
  const value=before||draft||{servings:1,prep_minutes:0,cook_minutes:0,rating:0};
  openEditor(before?'Edit recipe':draft?'Review imported recipe':'Add a recipe',field('name','Recipe name',value.name,'text','required')+field('category','Category',value.category)+field('servings','Servings',value.servings,'number','min="1" required')+field('rating','Rating (0–5)',value.rating,'number','min="0" max="5" step="1"')+field('prep_minutes','Prep time (minutes)',value.prep_minutes,'number','min="0" step="1"')+field('cook_minutes','Cook time (minutes)',value.cook_minutes,'number','min="0" step="1"')+field('description','Description',value.description,'textarea')+field('ingredients','Ingredients — one per line',value.ingredients,'textarea')+field('instructions','Instructions',value.instructions,'textarea')+field('image_url','Image URL',value.image_url,'url')+imageField()+field('source_name','Source name',value.source_name)+field('source_url','Source URL',value.source_url,'url')+field('favorite','A household favorite',value.favorite,'checkbox'),async form=>{
    const payload=recipePayload({...Object.fromEntries(form),favorite:form.has('favorite')});
    await saveRow('shared_recipes',before,{...payload,...(!before?{group_id:await ensureGroup(),created_by:user.id}:{})},form,'recipe-images');
  },{deletable:!!before,onDelete:()=>remove('shared_recipes',before),description:draft?`Review the website’s recipe details before saving. ${warnings.join(' ')}`:''});
}
function importRecipeEditor() {
  openEditor('Import from website',field('url','Recipe website URL','','text','required inputmode="url" placeholder="https://example.com/your-recipe"'),async form=>{
    const {data,error}=await client.functions.invoke('import-recipe',{body:{url:String(form.get('url')).trim()}});
    if(error){let message=error.message;try{const details=await error.context?.json();if(details?.error)message=details.error;}catch{}throw new Error(message);}
    if(!data?.recipe?.name)throw new Error('The website did not return a usable recipe.');
    return data;
  },{description:'Paste a public recipe link. We’ll read the recipe details for you to review. Nothing is saved until you choose Save changes.',saveLabel:'Read recipe',busyLabel:'Reading recipe…',successMessage:'',afterSave:data=>recipeEditor(null,data.recipe,data.warnings||[])});
}
function ingredientsEditor(recipe) {
  const lines=recipeIngredientLines(recipe.ingredients);
  if(!lines.length)throw new Error('Add ingredients to this recipe before creating a shopping list.');
  const editableLists=live('shopping_lists').filter(list=>canEditList(list,user.id,db.list_members));
  if(!editableLists.length)throw new Error('Create a shopping list you can edit, then return to add these ingredients.');
  const initialList=editableLists.find(list=>list.id===selectedList)||editableLists[0];
  let pending=null;
  openEditor('Add ingredients to shopping list',selectField('list_id','Shopping list',initialList.id,editableLists.map(list=>[list.id,list.name]))+`<p class="wide ingredient-help">Keep the ingredients you need and untick pantry items. Amounts and units stay in the item names; each line becomes one shopping entry.</p><div class="wide ingredient-tools"><button type="button" id="select-needed">Select missing ingredients</button><button type="button" id="select-none">Clear selection</button><span id="ingredient-count" role="status" aria-live="polite"></span></div><div class="wide ingredient-selection">${lines.map((line,index)=>`<div class="ingredient-choice"><input type="checkbox" name="include" value="${index}" aria-label="Include ingredient ${index+1}"><label><span class="sr-only">Ingredient ${index+1}</span><input type="text" name="ingredient-${index}" value="${h(line)}" maxlength="300" aria-label="Ingredient ${index+1}"><small data-ingredient-status="${index}"></small></label></div>`).join('')}</div>`,async form=>{
    if(!pending){
      const list=live('shopping_lists').find(list=>list.id===form.get('list_id'));
      if(!list||!canEditList(list,user.id,db.list_members))throw new Error('Choose a shopping list you can edit.');
      const chosen=form.getAll('include').map(index=>String(form.get(`ingredient-${index}`)||'').trim());
      pending=recipeShoppingItems(recipe,list.id,chosen);
      // Once a save starts, retain the exact selection for safe retries even
      // if a response is lost after the database has committed the batch.
      dialog.querySelector('fieldset').disabled=true;
    }
    try{return await addRecipeItems(pending);}catch(error){throw new Error(`${error.message} Retry this addition, or close and check the shopping list.`);}
  },{description:recipe.name,saveLabel:'Add selected ingredients',busyLabel:'Adding ingredients…',successMessage:'Ingredients added to your shared shopping list.',afterSave:result=>{view='lists';selectedList=result.listId;query='';filter='all';refresh();}});
  const form=dialog.querySelector('form');
  const count=()=>{const selected=form.querySelectorAll('[name="include"]:checked').length;form.querySelector('#ingredient-count').textContent=`${selected} of ${lines.length} selected`;form.querySelector('[type="submit"]').disabled=selected===0;};
  const status=index=>{
    const text=form.elements[`ingredient-${index}`].value;
    const listed=ingredientAlreadyListed(text,form.elements.list_id.value,db.shopping_items),heading=text.trim().endsWith(':');
    form.querySelector(`[data-ingredient-status="${index}"]`).textContent=listed?'Already on this list (unchecked)':heading?'Section heading — not selected by default':'';
    return !listed&&!heading;
  };
  const selectNeeded=()=>{for(let index=0;index<lines.length;index++)form.querySelector(`[name="include"][value="${index}"]`).checked=status(index);count();};
  form.elements.list_id.addEventListener('change',selectNeeded);
  form.addEventListener('input',event=>{const name=event.target.name;if(name?.startsWith('ingredient-'))status(Number(name.slice(11)));count();});
  form.querySelector('#select-needed').addEventListener('click',selectNeeded);
  form.querySelector('#select-none').addEventListener('click',()=>{for(const checkbox of form.querySelectorAll('[name="include"]'))checkbox.checked=false;count();});
  selectNeeded();
}
function viewRecipe(recipe) {
  const url=images.get(`recipe-images:${recipe.image_path||recipe.image_url||recipe.id}`)||safeImageUrl(recipe.image_url);
  dialog.innerHTML=`<div class="dialog-header"><div><span class="eyebrow">${h(recipe.category||'YOUR RECIPE')}</span><h2>${h(recipe.name)}</h2></div><button class="icon-button" data-action="close" aria-label="Close">×</button></div>${url?`<img class="recipe-detail-image" src="${h(url)}" alt="${h(recipe.name)}" referrerpolicy="no-referrer">`:''}<p>${h(recipe.description)}</p><div class="recipe-facts"><span>${recipe.servings} servings</span><span>${recipe.prep_minutes} min prep</span><span>${recipe.cook_minutes} min cook</span><span class="stars">${'★'.repeat(recipe.rating)}${'☆'.repeat(5-recipe.rating)}</span></div><h3>Ingredients</h3><div class="recipe-text">${h(recipe.ingredients)||'No ingredients added yet.'}</div><h3>Instructions</h3><div class="recipe-text">${h(recipe.instructions)||'No instructions added yet.'}</div>${safeImageUrl(recipe.source_url)?`<p><a href="${h(safeImageUrl(recipe.source_url))}" target="_blank" rel="noopener noreferrer">${h(recipe.source_name||'Original recipe')} ↗</a></p>`:''}<div class="dialog-actions recipe-detail-actions"><button data-action="recipe-shopping" data-id="${h(recipe.id)}">Add ingredients to list</button><button data-action="edit-recipe" data-id="${h(recipe.id)}">Edit recipe</button><button class="primary" data-action="plan-recipe" data-id="${h(recipe.id)}">Add to meal plan</button></div>`;
  if(!dialog.open)dialog.showModal();
}
function mealEditor(date,type,recipe=null) {
  const slot=mealSlotKey(date,type),before=db.shared_meal_plan_entries.find(m=>m.slot_key===slot&&m.group_id===group),value=before&&!before.deleted_at?before:{recipe_id:recipe?.id||'',title:recipe?.name||'',notes:''};
  openEditor(`${type} · ${new Date(`${date}T12:00:00`).toLocaleDateString()}`,selectField('recipe_id','Recipe',value.recipe_id||'',[['','A meal of your own'],...live('shared_recipes').map(r=>[r.id,r.name])])+field('title','Meal title',value.title,'text','required')+field('notes','Notes',value.notes,'textarea'),async form=>{
    const title=String(form.get('title')).trim();if(!title)throw new Error('Enter a meal title.');
    const payload={title,notes:String(form.get('notes')),recipe_id:form.get('recipe_id')||null,deleted_at:null};
    if(before)await update('shared_meal_plan_entries',before,changedFields(before,payload));
    else await insert('shared_meal_plan_entries',{...payload,group_id:await ensureGroup(),slot_key:slot,date,meal_type:type});
  },{deletable:!!before&&!before.deleted_at,onDelete:()=>remove('shared_meal_plan_entries',before)});
  dialog.querySelector('[name="recipe_id"]').addEventListener('change',e=>{const recipe=live('shared_recipes').find(r=>r.id===e.target.value);if(recipe)dialog.querySelector('[name="title"]').value=recipe.name;});
}
async function loadPartners() {
  const generation=epoch;
  try {const partners=await rpc('get_sharing_partners');const el=document.querySelector('#partners');if(el&&generation===epoch)el.innerHTML=partners.length?partners.map(p=>`<div class="partner"><span class="avatar">${h(p.email[0].toUpperCase())}</span><div><strong>${h(p.email)}</strong><small>${p.lists_shared_by_me} lists shared by you · ${p.lists_shared_with_me} shared with you</small></div></div>`).join(''):'<p class="muted">No household partners yet.</p>';}catch(error){if(generation===epoch){const el=document.querySelector('#partners');if(el)el.textContent=error.message;}}
}
function shareEditor(list=null) {
  openEditor(list?'Share this list':'Share everything',field('email','Their ShopTogether email','','email','required'),async form=>{
    await rpc(list?'share_list_with_email':'share_everything_with_email',list?{p_list_id:list.id,p_email:String(form.get('email')).trim()}:{p_email:String(form.get('email')).trim()});
  },{description:list?'They’ll be able to add, edit, and check off items in this list.':'This connects your households and shares lists, recipes, and meal plans with the account you enter. Existing recipe and meal-plan data may be combined. Only continue with someone you trust.'});
}
document.addEventListener('submit',async event=>{
  if(event.target.id==='auth-form') {
    event.preventDefault();const form=event.target,button=form.querySelector('button[type="submit"]'),message=form.querySelector('#auth-message'),values=Object.fromEntries(new FormData(form));button.disabled=true;message.textContent='';
    try {
      let result;
      if(recovery)result=await client.auth.updateUser({password:values.password});
      else if(authMode==='signup')result=await client.auth.signUp({...values,options:{emailRedirectTo:location.origin}});
      else if(authMode==='reset')result=await client.auth.resetPasswordForEmail(values.email,{redirectTo:location.origin});
      else result=await client.auth.signInWithPassword(values);
      if(result.error)throw result.error;
      if(recovery){recovery=false;notice('Password updated.');render();}
      else if(authMode==='reset')message.textContent='If this account exists, a reset email is on its way.';
      else if(authMode==='signup'&&!result.data.session)message.textContent='Check your email to confirm your account, then sign in.';
    }catch(error){message.textContent=error.message;}finally{button.disabled=false;}
  } else if(event.target.id==='editor-form') {
    event.preventDefault();const form=event.target,button=form.querySelector('button[type="submit"]'),generation=epoch,version=editorVersion,handler=saveHandler,afterSave=afterSaveHandler,successMessage=saveSuccessMessage;if(!handler||!user)return;button.disabled=true;
    const data=new FormData(form);
    const previousLabel=button.textContent;button.textContent=saveBusyLabel;form.querySelector('#editor-error').textContent='';
    try {const result=await handler(data);if(generation===epoch&&version===editorVersion&&dialog.open){dialog.close();if(successMessage)notice(successMessage);if(afterSave)afterSave(result);else await refresh();}}
    catch(error){if(generation===epoch){form.querySelector('#editor-error').textContent=error.message;}}
    finally{button.disabled=false;button.textContent=previousLabel;}
  }
});
document.addEventListener('change',event=>{
  const el=event.target;
  if(el.dataset.checkId) {const before=live('shopping_items').find(i=>i.id===el.dataset.checkId);el.disabled=true;task(async()=>{try{await update('shopping_items',before,{checked:el.checked});await refresh();}catch(error){el.checked=before.checked;throw error;}finally{el.disabled=false;}});}
  if(el.id==='theme-select')applyTheme(el.value);
  if(el.id==='week-date'){week=el.value||todayLocal();render();}
});
document.addEventListener('input',event=>{
  if(event.target.id==='search'){const input=event.target,selection=input.selectionStart;query=input.value;render();const next=document.querySelector('#search');next.focus();next.setSelectionRange(selection,selection);}
});
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-action]');if(!button)return;
  const {action,id,value,date,type}=button.dataset;
  task(async()=>{
    if(action==='theme'){applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');return;}
    if(action==='auth-mode'){authMode=value;recovery=false;renderAuth();return;}
    if(action==='close'){dialog.close();return;}
    if(!user)return;
    if(action==='navigate'){view=value;query='';filter='all';render();if(view==='account')loadPartners();}
    if(action==='sync-everything'||action==='refresh')await syncEverything();
    if(action==='signout'){const {error}=await client.auth.signOut();if(error)throw error;}
    if(action==='open-list'){selectedList=id;query='';filter='all';render();}
    if(action==='back-lists'){selectedList=null;query='';filter='all';render();}
    if(action==='filter'){filter=value;render();}
    if(action==='new-list')listEditor();
    if(action==='edit-list')listEditor(live('shopping_lists').find(l=>l.id===id));
    if(action==='new-item')itemEditor();
    if(action==='edit-item')itemEditor(live('shopping_items').find(i=>i.id===id));
    if(action==='new-store')storeEditor();
    if(action==='edit-store')storeEditor(live('store_profiles').find(s=>s.id===id));
    if(action==='new-recipe')recipeEditor();
    if(action==='import-recipe')importRecipeEditor();
    if(action==='edit-recipe')recipeEditor(live('shared_recipes').find(r=>r.id===id));
    if(action==='view-recipe')viewRecipe(live('shared_recipes').find(r=>r.id===id));
    if(action==='recipe-shopping')ingredientsEditor(live('shared_recipes').find(r=>r.id===id));
    if(action==='favorite'){const before=live('shared_recipes').find(r=>r.id===id);await update('shared_recipes',before,{favorite:!before.favorite});await refresh();}
    if(action==='share-list')shareEditor(live('shopping_lists').find(l=>l.id===id));
    if(action==='share-household')shareEditor();
    if(action==='leave-list')openEditor('Leave this shared list?','<p class="wide">You will lose access to this list. The owner and other members keep their access.</p>',async()=>{const {error}=await client.from('list_members').delete().eq('list_id',id).eq('user_id',user.id);if(error)throw error;});
    if(action==='edit-meal')mealEditor(date,type);
    if(action==='plan-recipe'){
      const recipe=live('shared_recipes').find(r=>r.id===id);
      openEditor('Choose a meal slot',field('date','Date',todayLocal(),'date','required')+selectField('meal_type','Meal','Dinner',[['Breakfast','Breakfast'],['Lunch','Lunch'],['Dinner','Dinner']]),async form=>{setTimeout(()=>mealEditor(String(form.get('date')),String(form.get('meal_type')),recipe),0);});
    }
    if(action==='week'){const d=new Date(`${week}T12:00:00`);d.setDate(d.getDate()+Number(value));week=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;render();}
    if(action==='today'){week=todayLocal();render();}
  });
});
