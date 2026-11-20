import test from 'node:test';
import assert from 'node:assert/strict';
import {extractRecipe,normalizeRecipeUrl,publicAddress,downloadRecipePage,decodeHttpResponse} from '../supabase/functions/import-recipe/recipe.js';
const page=node=>`<html><script type="application/ld+json">${JSON.stringify(node)}</script></html>`;
test('imports JSON-LD graph, image objects, durations and nested instruction sections',()=>{
  const result=extractRecipe(page({'@graph':[{'@type':'WebPage'},{'@type':['Thing','Recipe'],name:'Soup &amp; bread',recipeYield:'4 servings',prepTime:'PT1H5M',cookTime:'PT30M',image:[{'@type':'ImageObject',url:'/soup.jpg'}],recipeIngredient:['1 onion','&frac12; cup milk'],recipeInstructions:[{'@type':'HowToSection',name:'Cook',itemListElement:[{'@type':'HowToStep',text:'<p>Boil.</p>'},{text:'Serve.'}]}]}]}),'https://recipes.example.org/soup');
  assert.equal(result.recipe.name,'Soup & bread');assert.equal(result.recipe.servings,4);assert.equal(result.recipe.prep_minutes,65);
  assert.equal(result.recipe.image_url,'https://recipes.example.org/soup.jpg');assert.equal(result.recipe.ingredients,'1 onion\n½ cup milk');assert.equal(result.recipe.instructions,'Cook\n\nBoil.\n\nServe.');assert.deepEqual(result.warnings,[]);
});
test('unrelated or malformed JSON does not hide a later recipe and missing fields are flagged',()=>{
  const result=extractRecipe('<script type="application/ld+json">{broken}</script>'+page({'@type':'Recipe',name:'Toast',image:'javascript:alert(1)'}),'https://recipes.example.org/toast');
  assert.equal(result.recipe.image_url,null);assert.equal(result.warnings.length,2);assert.throws(()=>extractRecipe('<h1>Not a recipe</h1>','https://recipes.example.org'),/No supported recipe/);
  assert.equal(extractRecipe(page({'@type':'Recipe',name:'Toast'}),'https://recipes.example.org/toast').recipe.image_url,null);
});
test('URL validation blocks credentials, private/literal addresses and non-HTTPS requests',()=>{
  assert.equal(normalizeRecipeUrl('recipes.example.org/soup').href,'https://recipes.example.org/soup');
  for(const url of ['http://example.org','https://127.0.0.1','https://2130706433','https://[::1]','https://foo.local/','https://user:pass@example.org','https://example.org:8443','file:///etc/passwd'])assert.throws(()=>normalizeRecipeUrl(url));
});
test('network validation rejects private, link-local, mapped, multicast and reserved addresses',()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','172.16.1.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','198.18.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1'])assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700::1111'),true);
});
test('redirect targets are validated before any download to them',async()=>{
  let downloads=0;
  await assert.rejects(downloadRecipePage('https://recipes.example.org',{resolve:async()=>[{address:'8.8.8.8',family:4}],download:async()=>{downloads++;return {redirect:'https://127.0.0.1/secret'};}}),/public recipe website/);
  assert.equal(downloads,1);
  await assert.rejects(downloadRecipePage('https://recipes.example.org',{resolve:async()=>[{address:'10.1.2.3',family:4}],download:async()=>{throw new Error('Must never fetch');}}),/blocked network/);
});
test('pinned TLS downloader decodes bounded HTTP chunked and content-length responses',()=>{
  const raw=Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n');
  assert.equal(decodeHttpResponse(raw).html,'hello');
  assert.throws(()=>decodeHttpResponse(Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 10\r\n\r\nshort')),/incomplete/);
  assert.deepEqual(decodeHttpResponse(Buffer.from('HTTP/1.1 302 Found\r\nLocation: /recipe\r\nContent-Length: 0\r\n\r\n')),{redirect:'/recipe'});
});
