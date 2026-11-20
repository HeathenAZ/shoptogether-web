import {downloadRecipePage,extractRecipe} from './recipe.js';

const origins=new Set(['https://shoptogether-household.drchapman42.chatgpt.site','https://shop-together.app','https://www.shop-together.app','https://heathenaz.github.io','http://127.0.0.1:5173','http://localhost:5173']);
const requests=new Map<string,{time:number,count:number}>();
async function requestText(req:Request){
  const reader=req.body?.getReader();if(!reader)return '';
  const decoder=new TextDecoder();let text='',size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();throw new Error('The import request is too large.');}text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}
  finally{reader.releaseLock();}
}
export async function handler(req:Request):Promise<Response>{
  const origin=req.headers.get('origin');
  const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
  if(origin&&origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
  const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&!origins.has(origin))return reply({error:'This website origin is not allowed.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'Use POST to import a recipe.'},405);
  const auth=req.headers.get('authorization')||'';
  if(!/^Bearer \S+$/i.test(auth))return reply({error:'Sign in to import recipes.'},401);
  try {
    // Validate the actual user, not just a syntactically valid/anonymous JWT.
    const result=await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`,{headers:{Authorization:auth,apikey:Deno.env.get('SUPABASE_ANON_KEY')||''},signal:AbortSignal.timeout(8000)});
    if(!result.ok)return reply({error:'Your session expired. Sign in again.'},401);
    const user=await result.json();if(!user.id)return reply({error:'Sign in to import recipes.'},401);
    const now=Date.now();for(const [id,entry] of requests)if(now-entry.time>15*60*1000)requests.delete(id);
    if(requests.size>=1000&&!requests.has(user.id))return reply({error:'The importer is busy. Please try again shortly.'},429);
    const entry=requests.get(user.id)||{time:now,count:0};if(entry.count>=20)return reply({error:'Too many imports. Please try again in 15 minutes.'},429);
    entry.count++;requests.set(user.id,entry);
    if(Number(req.headers.get('content-length'))>4096)return reply({error:'The import request is too large.'},413);
    const text=await requestText(req);
    const body=JSON.parse(text);
    const page=await downloadRecipePage(body.url);
    return reply(extractRecipe(page.html,page.url));
  }catch(error){const message=error instanceof Error?error.message:'The recipe could not be imported.';console.log('import-recipe failed:',message);return reply({error:/abort|timed out|dns|ENOTFOUND|ECONN/i.test(message)?'The website could not be reached in time. Check the URL and try again.':message},422);}
}
Deno.serve(handler);
