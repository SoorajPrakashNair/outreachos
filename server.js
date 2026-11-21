require('dotenv').config();
const express=require('express'),Database=require('better-sqlite3'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),nodemailer=require('nodemailer');
const db=new Database(process.env.DB_PATH||'data.db');
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE,name TEXT,hash TEXT);
CREATE TABLE IF NOT EXISTS mails(id INTEGER PRIMARY KEY,user_id INT,to_addr TEXT,subject TEXT,body TEXT,status TEXT,reply TEXT,created DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS wa(id INTEGER PRIMARY KEY,user_id INT,number TEXT,has_wa INT,created DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS leads(id INTEGER PRIMARY KEY,user_id INT,name TEXT,email TEXT,phone TEXT,need TEXT,budget TEXT,timeline TEXT,location TEXT,score INT,summary TEXT,source TEXT,created DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS kb(id INTEGER PRIMARY KEY,user_id INT UNIQUE,content TEXT);`);
const app=express();app.use(express.json({limit:'2mb'}));app.use(express.static('public'));
const SECRET=process.env.JWT_SECRET||'dev-secret',J=t=>JSON.parse(t.replace(/```json|```/g,'').trim());
const auth=(q,s,n)=>{try{q.uid=jwt.verify((q.headers.authorization||'').slice(7),SECRET).id;n()}catch{s.status(401).json({error:'Please sign in again'})}};
const wrap=f=>(q,s)=>f(q,s).catch(e=>s.status(500).json({error:e.message}));
const n=(sql,...a)=>db.prepare(sql).get(...a).c;

async function ai(prompt,system='You are a precise business assistant.'){
 if(process.env.AI_PROVIDER==='anthropic'){
  const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:process.env.ANTHROPIC_MODEL||'claude-sonnet-4-6',max_tokens:1500,system,messages:[{role:'user',content:prompt}]})});
  const j=await r.json();if(!j.content)throw new Error(j.error?.message||'AI error');return j.content[0].text}
 const m=process.env.GEMINI_MODEL||'gemini-2.0-flash';
 const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${process.env.GEMINI_API_KEY}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents:[{parts:[{text:prompt}]}]})});
 const j=await r.json();const t=j.candidates?.[0]?.content?.parts?.[0]?.text;if(!t)throw new Error(j.error?.message||'AI error');return t}

// ---- auth
const tok=u=>jwt.sign({id:u.id},SECRET,{expiresIn:'7d'});
app.post('/api/auth/register',wrap(async(q,s)=>{const{email,password,name}=q.body;if(!email||!password||password.length<6)return s.status(400).json({error:'Enter an email and a password of 6+ characters'});
 try{const r=db.prepare('insert into users(email,name,hash) values(?,?,?)').run(email.toLowerCase(),name||'',bcrypt.hashSync(password,10));s.json({token:tok({id:r.lastInsertRowid})})}catch{s.status(400).json({error:'That email is already registered'})}}));
app.post('/api/auth/login',wrap(async(q,s)=>{const u=db.prepare('select * from users where email=?').get((q.body.email||'').toLowerCase());
 if(!u||!bcrypt.compareSync(q.body.password||'',u.hash))return s.status(401).json({error:'Wrong email or password'});s.json({token:tok(u)})}));
app.get('/api/me',auth,wrap(async(q,s)=>s.json(db.prepare('select id,name,email from users where id=?').get(q.uid))));

// ---- dashboard
app.get('/api/stats',auth,wrap(async(q,s)=>{const u=q.uid,a=sql=>db.prepare(sql).all(u);s.json({
 sent:n("select count(*) c from mails where user_id=? and status in('sent','replied')",u),replied:n("select count(*) c from mails where user_id=? and status='replied'",u),
 failed:n("select count(*) c from mails where user_id=? and status='failed'",u),leads:n("select count(*) c from leads where user_id=?",u),
 waYes:n("select count(*) c from wa where user_id=? and has_wa=1",u),waNo:n("select count(*) c from wa where user_id=? and has_wa=0",u),
 byDay:a("select date(created) d,count(*) c from mails where user_id=? group by d order by d desc limit 14").reverse(),
 scores:a("select case when score>=70 then 'Hot' when score>=40 then 'Warm' else 'Cold' end k,count(*) c from leads where user_id=? group by k"),
 recent:a("select id,to_addr,subject,status,created from mails where user_id=? order by id desc limit 15")})}));

// ---- AI mail
app.post('/api/ai/email',auth,wrap(async(q,s)=>{const{details,tone,language}=q.body;
 s.json(J(await ai(`Write a ${tone||'professional'} cold outreach email in ${language||'English'} to a company, from my side, based on these details:\n${details}\nKeep it under 150 words, specific, with one clear call to action. Return ONLY JSON {"subject":"...","body":"..."}`)))}));
async function sendMail(uid,to,subject,body){
 if(!/^\S+@\S+\.\S+$/.test(to))throw new Error('Enter a valid email address');
 const tr=nodemailer.createTransport({host:process.env.SMTP_HOST,port:+process.env.SMTP_PORT||587,secure:process.env.SMTP_PORT==465,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
 let st='sent',err;try{await tr.sendMail({from:process.env.MAIL_FROM||process.env.SMTP_USER,to,subject,text:body})}catch(e){st='failed';err=e.message}
 db.prepare('insert into mails(user_id,to_addr,subject,body,status) values(?,?,?,?,?)').run(uid,to,subject,body,st);if(err)throw new Error(err)}
app.post('/api/mail/send',auth,wrap(async(q,s)=>{await sendMail(q.uid,q.body.to,q.body.subject,q.body.body);s.json({ok:1})}));
app.post('/api/mail/auto',auth,wrap(async(q,s)=>{const m=J(await ai(`Write a ${q.body.tone||'professional'} cold outreach email to a company based on:\n${q.body.details}\nUnder 150 words, one call to action. Return ONLY JSON {"subject":"...","body":"..."}`));
 await sendMail(q.uid,q.body.to,m.subject,m.body);s.json(m)}));
app.post('/api/mail/sync',auth,wrap(async(q,s)=>{const{ImapFlow}=require('imapflow');
 const c=new ImapFlow({host:process.env.IMAP_HOST,port:993,secure:true,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS},logger:false});await c.connect();const lock=await c.getMailboxLock('INBOX');let cnt=0;
 try{for(const m of db.prepare("select * from mails where user_id=? and status='sent'").all(q.uid)){const ids=await c.search({from:m.to_addr});
  if(ids.length){const msg=await c.fetchOne(ids[ids.length-1],{source:true});const txt=msg.source.toString().split('\r\n\r\n').slice(1).join(' ').slice(0,1500);db.prepare("update mails set status='replied',reply=? where id=?").run(txt,m.id);cnt++}}}finally{lock.release()}
 await c.logout();s.json({replied:cnt})}));

// ---- WhatsApp checker (whatsapp-web.js, local only)
let wa=null,waQR=null,waReady=false;
function startWA(){try{const{Client,LocalAuth}=require('whatsapp-web.js'),QR=require('qrcode');wa=new Client({authStrategy:new LocalAuth(),puppeteer:{args:['--no-sandbox']}});
 wa.on('qr',async x=>waQR=await QR.toDataURL(x));wa.on('ready',()=>{waReady=true;waQR=null});wa.initialize()}catch{console.log('whatsapp-web.js not installed')}}
app.post('/api/whatsapp/connect',auth,(q,s)=>{if(!wa)startWA();s.json({ok:1})});
app.get('/api/whatsapp/status',auth,(q,s)=>s.json({ready:waReady,qr:waQR,installed:!!wa}));
app.post('/api/whatsapp/check',auth,wrap(async(q,s)=>{if(!waReady)throw new Error('Connect WhatsApp first by scanning the QR code');const out=[];
 for(const raw of (q.body.numbers||[]).slice(0,200)){const num=String(raw).replace(/\D/g,'');if(num.length<8)continue;let has=false;try{has=await wa.isRegisteredUser(num+'@c.us')}catch{}
  db.prepare('insert into wa(user_id,number,has_wa) values(?,?,?)').run(q.uid,num,has?1:0);out.push({number:num,has_wa:has});await new Promise(r=>setTimeout(r,1500))}s.json(out)}));

// ---- AI insights
app.post('/api/ai/insights',auth,wrap(async(q,s)=>{const u=q.uid;
 const data={sent:n("select count(*) c from mails where user_id=? and status in('sent','replied')",u),replied:n("select count(*) c from mails where user_id=? and status='replied'",u),failed:n("select count(*) c from mails where user_id=? and status='failed'",u),
  leads:db.prepare("select score,need,budget,timeline from leads where user_id=? limit 50").all(u),
  subjects:db.prepare("select subject,status from mails where user_id=? order by id desc limit 30").all(u),
  replies:db.prepare("select reply from mails where user_id=? and reply is not null order by id desc limit 10").all(u).map(r=>(r.reply||'').slice(0,300))};
 s.json(J(await ai(`Analyze this outreach data. Return ONLY JSON {"summary":"...","drawbacks":["..."],"suggestions":["..."],"ideas":["..."],"reply_sentiment":"..."}\n${JSON.stringify(data)}`,'You are a senior growth analyst. Be concrete and honest.')))}));

// ---- leads, follow-ups
async function scoreLead(l){try{return J(await ai(`Score this sales lead 0-100 on fit (service need, budget, location, timeline) and flag likely spam. Return ONLY JSON {"score":0,"summary":"2 sentences","spam":false}\n${JSON.stringify(l)}`))}catch{return{score:50,summary:'',spam:false}}}
async function addLead(uid,l,source){if(l.email&&n('select count(*) c from leads where user_id=? and email=?',uid,l.email))return{duplicate:true};
 const r=await scoreLead(l);if(r.spam)return{spam:true};
 db.prepare('insert into leads(user_id,name,email,phone,need,budget,timeline,location,score,summary,source) values(?,?,?,?,?,?,?,?,?,?,?)').run(uid,l.name||'',l.email||'',l.phone||'',l.need||'',l.budget||'',l.timeline||'',l.location||'',r.score,r.summary,source);return{ok:true}}
app.get('/api/leads',auth,wrap(async(q,s)=>s.json(db.prepare('select * from leads where user_id=? order by score desc,id desc').all(q.uid))));
app.post('/api/leads',auth,wrap(async(q,s)=>s.json(await addLead(q.uid,q.body,'manual'))));
app.post('/api/ai/followup',auth,wrap(async(q,s)=>{const l=db.prepare('select * from leads where id=? and user_id=?').get(q.body.lead_id,q.uid);if(!l)throw new Error('Lead not found');
 s.json({text:await ai(`Draft a short, warm ${q.body.channel||'email'} follow-up for this lead. Mention their need and propose a next step. Plain text only.\n${JSON.stringify(l)}`)})}));

// ---- chatbot (public) + knowledge base
app.get('/api/kb',auth,wrap(async(q,s)=>s.json({content:db.prepare('select content from kb where user_id=?').get(q.uid)?.content||''})));
app.post('/api/kb',auth,wrap(async(q,s)=>{db.prepare('insert into kb(user_id,content) values(?,?) on conflict(user_id) do update set content=excluded.content').run(q.uid,q.body.content||'');s.json({ok:1})}));
app.post('/api/chat/:uid',wrap(async(q,s)=>{const uid=+q.params.uid,kb=(db.prepare('select content from kb where user_id=?').get(uid)?.content||'').slice(0,15000);
 const t=await ai(`Knowledge base:\n${kb}\n\nConversation so far:\n${JSON.stringify((q.body.history||[]).slice(-12))}\nVisitor: ${String(q.body.message).slice(0,800)}\n\nAnswer ONLY from the knowledge base, in the visitor's language; never invent prices. Naturally ask (one at a time) service needed, budget, location, timeline, then name and email or phone. When you have a name plus email or phone, fill "lead" (in English). Return ONLY JSON {"reply":"...","lead":null}`,'You are a friendly sales assistant.');
 let o;try{o=J(t)}catch{o={reply:t,lead:null}}if(o.lead&&(o.lead.email||o.lead.phone))addLead(uid,o.lead,'chatbot').catch(()=>{});s.json({reply:o.reply})}));

app.listen(process.env.PORT||3000,()=>console.log('OutreachOS running on http://localhost:'+(process.env.PORT||3000)));
