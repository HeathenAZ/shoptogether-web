import {request as httpsRequest} from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {Buffer} from 'node:buffer';

export function normalizeRecipeUrl(input) {
  if(typeof input!=='string'||!input.trim()||input.length>2048)throw new Error('Enter a recipe website URL.');
  const raw=input.trim();
  const url=new URL(/^[a-z][a-z\d+.-]*:/i.test(raw)?raw:`https://${raw}`);
  if(url.protocol!=='https:'||url.username||url.password||url.port)throw new Error('Use a public HTTPS recipe URL without a login or custom port.');
  const host=url.hostname.toLowerCase();
  if(isIP(host)||host.includes(':')||!host.includes('.')||!/^([a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z][a-z\d-]*$/i.test(host)||/\.(local|localhost|internal|lan|home|test|example|invalid|arpa)$/.test(host))throw new Error('Use a public recipe website address.');
  url.hash='';return url;
}
export function publicAddress(ip) {
  if(isIP(ip)===4){
    const [a,b,c]=ip.split('.').map(Number);
    return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||(b===88&&c===99)))||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113));
  }
  // Permit ordinary global IPv6 only; reject mapped/local/transition ranges.
  return isIP(ip)===6 && /^[23][\da-f]{3}:/i.test(ip) && !/^200[12]:/i.test(ip);
}
const MAX_PAGE=2*1024*1024;
function pageResult(status,headers,bytes){
  if([301,302,303,307,308].includes(status))return {redirect:headers.location};
  if(status<200||status>=300)throw new Error(`The website returned ${status}. It may block automatic imports.`);
  if(!/^(text\/html|application\/xhtml\+xml)/i.test(headers['content-type']||''))throw new Error('This URL does not return a recipe webpage.');
  if(headers['content-encoding']&&!/^identity$/i.test(headers['content-encoding']))throw new Error('This website returned an unsupported compressed page.');
  if(bytes.length>MAX_PAGE)throw new Error('This webpage is too large to import.');
  return {html:bytes.toString('utf8')};
}
export function decodeHttpResponse(raw){
  const split=raw.indexOf('\r\n\r\n');if(split<0||split>65536)throw new Error('The website returned invalid HTTP headers.');
  const lines=raw.subarray(0,split).toString('latin1').split('\r\n');
  const status=Number(lines.shift()?.match(/^HTTP\/1\.[01] (\d{3})/)?.[1]);
  if(!Number.isInteger(status)||status<100||status>599)throw new Error('The website returned an invalid HTTP status.');
  const headers={};for(const line of lines){const i=line.indexOf(':');if(i>0)headers[line.slice(0,i).toLowerCase()]=line.slice(i+1).trim();}
  let body=raw.subarray(split+4);
  if(/chunked/i.test(headers['transfer-encoding']||'')){
    const chunks=[];let cursor=0,size=0,ended=false;
    while(cursor<body.length){
      const end=body.indexOf('\r\n',cursor);if(end<0)throw new Error('The webpage download was incomplete.');
      const hex=body.subarray(cursor,end).toString().split(';')[0];if(!/^[\da-f]+$/i.test(hex))throw new Error('The website returned invalid HTTP chunks.');
      const length=parseInt(hex,16);cursor=end+2;if(!length){ended=true;break;}
      size+=length;if(size>MAX_PAGE)throw new Error('This webpage is too large to import.');
      if(cursor+length+2>body.length||body.subarray(cursor+length,cursor+length+2).toString()!=='\r\n')throw new Error('The webpage download was incomplete.');
      chunks.push(body.subarray(cursor,cursor+length));cursor+=length+2;
    }
    if(!ended)throw new Error('The webpage download was incomplete.');body=Buffer.concat(chunks);
  }else if(headers['content-length']){
    const length=Number(headers['content-length']);if(!Number.isSafeInteger(length)||length<0||body.length<length)throw new Error('The webpage download was incomplete.');body=body.subarray(0,length);
  }
  return pageResult(status,headers,body);
}
async function denoPage(url,chosen,signal){
  let connection;
  const abort=()=>{try{connection?.close();}catch{}};
  signal.addEventListener('abort',abort,{once:true});
  try{
    connection=await Deno.connect({hostname:chosen.address,port:443});
    if(signal.aborted)throw new Error('The website request timed out.');
    // TCP targets the validated IP; TLS validates and sends SNI for the original host.
    connection=await Deno.startTls(connection,{hostname:url.hostname,alpnProtocols:['http/1.1']});
    if(signal.aborted)throw new Error('The website request timed out.');
    const message=new TextEncoder().encode(`GET ${url.pathname+url.search} HTTP/1.1\r\nHost: ${url.host}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36\r\nAccept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8\r\nAccept-Language: en-US,en;q=0.9\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n`);
    let written=0;while(written<message.length)written+=await connection.write(message.subarray(written));
    const chunks=[];let size=0;const buffer=new Uint8Array(65536);
    while(true){
      let length;
      // Many CDNs close without a TLS close_notify. The HTTP framing check in
      // decodeHttpResponse still rejects truncated pages, so treat it as end of stream.
      try{length=await connection.read(buffer);}catch(error){if(chunks.length&&/close_notify|unexpected ?eof|UnexpectedEof/i.test(String(error?.message||error)))break;throw error;}
      if(length===null)break;size+=length;if(size>MAX_PAGE+131072)throw new Error('This webpage is too large to import.');chunks.push(Buffer.from(buffer.subarray(0,length)));}
    return decodeHttpResponse(Buffer.concat(chunks));
  }finally{signal.removeEventListener('abort',abort);abort();}
}
async function requestPage(url,addresses,signal) {
  const chosen=addresses.find(a=>a.family===4)||addresses[0];
  if(typeof Deno!=='undefined')return denoPage(url,chosen,signal);
  return new Promise((resolve,reject)=>{
    // Pin the validated IP at the connection boundary while retaining normal
    // hostname certificate verification and SNI. DNS cannot rebind this request.
    const req=httpsRequest({protocol:'https:',hostname:chosen.address,port:443,path:url.pathname+url.search,agent:false,servername:url.hostname,signal,
      headers:{Host:url.host,'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9','Accept-Encoding':'identity'}
    },response=>{
      const status=response.statusCode||0;
      if([301,302,303,307,308].includes(status)){response.destroy();resolve({redirect:response.headers.location});return;}
      if(status<200||status>=300){response.destroy();reject(new Error(`The website returned ${status}. It may block automatic imports.`));return;}
      if(!/^(text\/html|application\/xhtml\+xml)/i.test(response.headers['content-type']||'')){response.destroy();reject(new Error('This URL does not return a recipe webpage.'));return;}
      if(response.headers['content-encoding']&&!/^identity$/i.test(response.headers['content-encoding'])){response.destroy();reject(new Error('This website returned an unsupported compressed page.'));return;}
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>MAX_PAGE){req.destroy();reject(new Error('This webpage is too large to import.'));}else chunks.push(chunk);});
      response.on('end',()=>resolve({html:Buffer.concat(chunks).toString('utf8')}));
      response.on('error',reject);
    });
    req.on('error',reject);req.end();
  });
}
export async function downloadRecipePage(input,{resolve=lookup,download=requestPage,signal=AbortSignal.timeout(15000)}={}) {
  let url=normalizeRecipeUrl(input);
  for(let hop=0;hop<=3;hop++){
    const addresses=await resolve(url.hostname,{all:true});
    if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error('This website resolves to a blocked network address.');
    const result=await download(url,addresses,signal);
    if(result.redirect){url=normalizeRecipeUrl(new URL(result.redirect,url).href);continue;}
    if(!result.html)throw new Error('The website did not return a recipe webpage.');
    return {html:result.html,url:url.href};
  }
  throw new Error('This website redirects too many times.');
}
export function cleanText(value) {
  const named={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',ndash:'–',mdash:'—',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“',frac12:'½',frac14:'¼',frac34:'¾',deg:'°'};
  return String(value??'').replace(/<\s*(br\b[^>]*|\/p|\/li)\s*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&(#x[\da-f]+|#\d+|[a-z\d]+);/gi,(match,key)=>{
    if(key[0]==='#'){const code=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):match;}
    return named[key.toLowerCase()]??match;
  }).replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n').trim();
}
function recipeNode(root){
  const stack=[{node:root,depth:0}];let visited=0;
  while(stack.length&&visited++<10000){
    const {node,depth}=stack.pop();if(!node||typeof node!=='object'||depth>40)continue;
    const types=Array.isArray(node['@type'])?node['@type']:[node['@type']];
    if(types.some(t=>typeof t==='string'&&/(^|[/#])Recipe$/i.test(t)))return node;
    const values=Array.isArray(node)?node:Object.values(node);
    for(let i=values.length-1;i>=0;i--)if(typeof values[i]==='object')stack.push({node:values[i],depth:depth+1});
  }
}
function duration(value){
  const m=String(value??'').match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  return m?Math.min(100000,Math.round(Number(m[1]||0)*1440+Number(m[2]||0)*60+Number(m[3]||0)+Number(m[4]||0)/60)):0;
}
function steps(value,depth=0){
  if(depth>30)return [];
  if(Array.isArray(value))return value.flatMap(v=>steps(v,depth+1));
  if(typeof value==='string')return [cleanText(value)];
  if(value&&typeof value==='object'){
    if(value.itemListElement)return [cleanText(value.name),...steps(value.itemListElement,depth+1)].filter(Boolean);
    return [cleanText(value.text||value.name)].filter(Boolean);
  }return [];
}
function recipeImage(value,base){
  const candidate=Array.isArray(value)?value[0]:value;
  const raw=typeof candidate==='string'?candidate:candidate?.url||candidate?.contentUrl;
  if(typeof raw!=='string'||!raw.trim())return null;
  try{const url=new URL(raw,base);return ['http:','https:'].includes(url.protocol)?url.href:null;}catch{return null;}
}
export function extractRecipe(html,sourceUrl) {
  let node;
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
    if(!/\btype\s*=\s*["']application\/ld\+json["']/i.test(match[1]))continue;
    try{node=recipeNode(JSON.parse(match[2].trim().replace(/^<!--/,'').replace(/-->$/,'')));}catch{continue;}
    if(node)break;
  }
  if(!node){
    const title=cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').slice(0,80);
    const blocked=/access denied|attention required|just a moment|are you a robot|captcha|forbidden|blocked/i.test(title+' '+html.slice(0,4000));
    console.log('import-recipe no recipe node; title:',title,'length:',html.length,'ld+json blocks:',(html.match(/application\/ld\+json/gi)||[]).length);
    throw new Error(blocked
      ?`This website blocked the automatic import${title?` ("${title}")`:''}. You can still add the recipe manually or import it from the phone app.`
      :`No supported recipe information was found${title?` on "${title}"`:''}. This page may require a login or may not publish structured recipe data. You can still add it manually.`);
  }
  const name=cleanText(node.name);if(!name)throw new Error('The recipe title could not be read.');
  const ingredients=(Array.isArray(node.recipeIngredient)?node.recipeIngredient:[node.recipeIngredient]).filter(v=>typeof v==='string').map(cleanText).filter(Boolean).join('\n');
  const instructions=steps(node.recipeInstructions).filter(Boolean).join('\n\n');
  const yieldValue=Array.isArray(node.recipeYield)?node.recipeYield[0]:node.recipeYield;
  const servings=Math.max(1,Math.min(1000,parseInt(String(yieldValue??'1').match(/\d+/)?.[0]||'1')));
  const warnings=[];if(!ingredients)warnings.push('Ingredients were not found.');if(!instructions)warnings.push('Instructions were not found.');
  const category=(Array.isArray(node.recipeCategory)?node.recipeCategory:[node.recipeCategory]).map(cleanText).filter(Boolean).join(', ');
  const publisher=Array.isArray(node.publisher)?node.publisher[0]:node.publisher;
  return {recipe:{name,description:cleanText(node.description),servings,prep_minutes:duration(node.prepTime),cook_minutes:duration(node.cookTime),ingredients,instructions,image_url:recipeImage(node.image,sourceUrl),source_url:sourceUrl,source_name:cleanText(publisher?.name)||new URL(sourceUrl).hostname.replace(/^www\./,''),category,favorite:false,rating:0},warnings};
}
