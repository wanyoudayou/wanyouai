import test from 'node:test';
import assert from 'node:assert/strict';
import {gateHits, articleUrl} from '../src/lib/avatar/retrieve';
import type {ChunkHit} from '../src/lib/avatar/retrieve';
import type {Reader, ReadingArticle, ReadingSeries} from '../src/types/reading';

const OWNER='00000000-0000-4000-8000-000000000001';
const SINGLE_BUYER='00000000-0000-4000-8000-000000000005';
const reader=(userId:string|null,entitlements:Reader['entitlements']=[]):Reader=>({userId,owner:false,entitlements});
const sub=(userId:string)=>({user_id:userId,type:'subscription' as const,target_id:null,ends_at:'2027-01-01T00:00:00Z',revoked_at:null});

const seriesRow=(over:Partial<ReadingSeries>={}):ReadingSeries=>({id:1,slug:'demo-handbook',type:'handbook',title:'手册',readme_article_id:null,price:199,status:'published',tags:[],task:null,audiences:[],featured:false,created_at:'',updated_at:'',...over});
const articleRow=(over:Partial<ReadingArticle>):ReadingArticle=>({id:1,slug:'a1',series_id:null,type:'blog',title:'文章',summary:null,cover_url:null,tags:[],access:'public',price:null,status:'published',published_at:'2026-01-01',preview_md:'',...over});
const hit=(over:Partial<ChunkHit>):ChunkHit=>({chunk_id:1,article_id:1,series_id:null,access:'public',chunk_type:'body',chunk_no:0,content:'正文片段SECRET',...over});

test('avatar: 注入分级四身份矩阵（红线：未授权命中只给占位，付费正文零注入）',()=>{
  const paidBlog=articleRow({id:10,slug:'paid-blog',access:'paid',price:9.9});
  const paidChapter=articleRow({id:11,slug:'ch1',series_id:1,type:'chapter',access:'paid'});
  const publicBlog=articleRow({id:12,slug:'pub',access:'public'});
  const series=seriesRow({id:1});
  const articles=new Map([[10,paidBlog],[11,paidChapter],[12,publicBlog]]);
  const seriesMap=new Map([[1,series]]);
  const hits:ChunkHit[]=[
    hit({chunk_id:1,article_id:10,access:'paid'}),
    hit({chunk_id:2,article_id:11,series_id:1,access:'paid'}),
    hit({chunk_id:3,article_id:12}),
    hit({chunk_id:4,article_id:10,access:'paid',chunk_type:'catalog',content:'目录样品'}),
  ];
  // 匿名：公开全文 + 样品可注入；付费 body 只给占位
  let gated=gateHits(hits,reader(null),articles,seriesMap);
  assert.equal(gated.find(g=>g.articleId===10&&g.chunkType==='body')?.gated,true);
  assert.ok(!gated.some(g=>g.gated&&g.content.includes('SECRET')));
  assert.equal(gated.find(g=>g.articleId===12)?.content,'正文片段SECRET');
  assert.equal(gated.find(g=>g.chunkType==='catalog')?.content,'目录样品');
  // 占位含标题/访问级别/链接，不含价格
  const placeholder=gated.find(g=>g.articleId===10&&g.gated)!;
  assert.ok(placeholder.content.includes('付费可读')&&placeholder.content.includes('/blog/paid-blog'));
  assert.ok(!placeholder.content.includes('9.9'));
  // 订阅者：全部解锁
  gated=gateHits(hits,reader(SINGLE_BUYER,[sub(SINGLE_BUYER)]),articles,seriesMap);
  assert.ok(gated.every(g=>!g.gated));
  // 单篇买家：仅所购单篇解锁，专辑章节仍占位
  const buyer=reader(SINGLE_BUYER,[{user_id:SINGLE_BUYER,type:'single',target_id:10,ends_at:null,revoked_at:null}]);
  gated=gateHits(hits,buyer,articles,seriesMap);
  assert.equal(gated.find(g=>g.articleId===10&&g.chunkType==='body')?.gated,false);
  assert.equal(gated.find(g=>g.articleId===11)?.gated,true);
  // owner：全解锁
  gated=gateHits(hits,{userId:OWNER,owner:true,entitlements:[]},articles,seriesMap);
  assert.ok(gated.every(g=>!g.gated));
  // 草稿/归档不进入结果
  const draft=articleRow({id:13,status:'draft'});
  const g2=gateHits([hit({chunk_id:9,article_id:13})],reader(null),new Map([[13,draft]]),new Map());
  assert.equal(g2.length,0);
});

test('avatar: URL 构造覆盖各类专辑',()=>{
  assert.equal(articleUrl(articleRow({slug:'x'}),null),'/blog/x');
  for(const [type,path] of [['handbook','handbooks'],['skill','skills'],['collection','handbooks']] as const)
    assert.equal(articleUrl(articleRow({slug:'c',type:'chapter'}),seriesRow({slug:'demo',type})),`/${path}/demo?article=c`);
});
