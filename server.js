require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const dbFile = process.env.DB_FILE || './data/nicol.sqlite';
fs.mkdirSync(path.dirname(path.resolve(dbFile)), { recursive: true });
const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','staff')),
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS bookings (
 id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL,
 customer_name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT,
 court INTEGER NOT NULL CHECK(court BETWEEN 1 AND 3), booking_date TEXT NOT NULL,
 start_hour INTEGER NOT NULL CHECK(start_hour BETWEEN 5 AND 23), duration INTEGER NOT NULL DEFAULT 1 CHECK(duration=1),
 rate INTEGER NOT NULL, amount INTEGER NOT NULL,
 payment_method TEXT NOT NULL CHECK(payment_method IN ('GCash','Cash')),
 payment_reference TEXT, payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','pending_verification','paid')),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','completed','cancelled')),
 notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_booking_per_slot ON bookings(court, booking_date, start_hour) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS bookings_date_idx ON bookings(booking_date, status);
`);
const userCount = db.prepare('SELECT COUNT(*) n FROM users').get().n;
if (!userCount) {
 const add = db.prepare('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)');
 add.run(process.env.ADMIN_USERNAME || 'admin', bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'ChangeThisAdmin123!', 12), 'admin');
 add.run(process.env.STAFF_USERNAME || 'staff', bcrypt.hashSync(process.env.STAFF_PASSWORD || 'ChangeThisStaff123!', 12), 'staff');
 console.log('Initial admin/staff accounts created. Change their passwords before public launch.');
}

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({limit:'30kb'}));
app.use(express.urlencoded({extended:false}));
app.use(session({secret:process.env.SESSION_SECRET || 'development-only-change-this-secret',resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:8*60*60*1000}}));
app.use('/api/auth/login', rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:true,legacyHeaders:false}));
app.use(express.static(path.join(__dirname,'public')));

const money = n => Math.round(n);
function priceFor(hour){ return hour < 17 ? 150 : 250; }
function validDate(s){ return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s+'T00:00:00')); }
function auth(req,res,next){ if(!req.session.user) return res.status(401).json({error:'Please log in.'}); next(); }
function admin(req,res,next){ if(!req.session.user || req.session.user.role!=='admin') return res.status(403).json({error:'Admin access required.'}); next(); }
function clean(v,max=120){return String(v??'').trim().slice(0,max);}

app.get('/api/config',(req,res)=>res.json({venue:'Nicol Pickleball Complex, Bood, Ubay, Bohol',courts:3,dayRate:150,nightRate:250,openingHour:5,closingHour:24,slotHours:1}));
app.get('/api/availability',(req,res)=>{
 const date=clean(req.query.date,10); if(!validDate(date)) return res.status(400).json({error:'Choose a valid date.'});
 const rows=db.prepare("SELECT court,start_hour,status FROM bookings WHERE booking_date=? AND status<>'cancelled'").all(date);
 const occupied=rows.map(x=>({court:x.court,hour:x.start_hour,status:x.status}));
 res.json({date,occupied,slots:Array.from({length:19},(_,i)=>{const hour=i+5;return {hour,rate:priceFor(hour),courts:[1,2,3].map(c=>({court:c,available:!occupied.some(x=>x.court===c&&x.hour===hour)}))}})});
});
app.post('/api/bookings',(req,res)=>{
 const name=clean(req.body.name,100), phone=clean(req.body.phone,30), email=clean(req.body.email,120), date=clean(req.body.date,10);
 const court=Number(req.body.court), hour=Number(req.body.hour), method=clean(req.body.paymentMethod,20), reference=clean(req.body.paymentReference,100);
 if(name.length<2 || phone.length<7 || !validDate(date) || ![1,2,3].includes(court) || !Number.isInteger(hour)||hour<5||hour>23 || !['GCash','Cash'].includes(method)) return res.status(400).json({error:'Please complete all required booking details.'});
 const today=new Date(); const localToday = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(today);
 if(date<localToday || (date===localToday && hour<=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',hourCycle:'h23'}).format(today)))) return res.status(400).json({error:'That time has already passed. Please choose a future slot.'});
 const rate=priceFor(hour), code='NIC-'+crypto.randomBytes(3).toString('hex').toUpperCase();
 try {
  const info=db.prepare(`INSERT INTO bookings(code,customer_name,phone,email,court,booking_date,start_hour,duration,rate,amount,payment_method,payment_reference,payment_status,status) VALUES(?,?,?,?,?,?,?,1,?,?,?,?,?,'pending')`)
   .run(code,name,phone,email||null,court,date,hour,rate,rate,method,reference||null,method==='GCash'?'pending_verification':'unpaid');
  res.status(201).json({id:info.lastInsertRowid,code,name,date,court,hour,rate,amount:rate,paymentMethod:method,status:'pending',message:'Your reservation request has been received.'});
 } catch(e){ if(String(e.code).includes('SQLITE_CONSTRAINT')) return res.status(409).json({error:'Sorry, this court and time was just booked. Please select another available slot.'}); console.error(e);res.status(500).json({error:'Could not save booking.'}); }
});
app.post('/api/auth/login',(req,res)=>{
 const username=clean(req.body.username,60), password=String(req.body.password||'');
 const user=db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(username);
 if(!user || !bcrypt.compareSync(password,user.password_hash)) return res.status(401).json({error:'Incorrect username or password.'});
 req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Login failed.'});req.session.user={id:user.id,username:user.username,role:user.role};res.json({user:req.session.user});});
});
app.post('/api/auth/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/auth/me',(req,res)=>res.json({user:req.session.user||null}));
app.get('/api/admin/bookings',auth,(req,res)=>{
 const date=clean(req.query.date,10), status=clean(req.query.status,20);
 let sql='SELECT * FROM bookings WHERE 1=1', args=[];
 if(date&&validDate(date)){sql+=' AND booking_date=?';args.push(date)}
 if(status&&['pending','confirmed','completed','cancelled'].includes(status)){sql+=' AND status=?';args.push(status)}
 sql+=' ORDER BY booking_date DESC,start_hour,court';res.json(db.prepare(sql).all(...args));
});
app.patch('/api/admin/bookings/:id',auth,(req,res)=>{
 const id=Number(req.params.id), status=clean(req.body.status,20), paymentStatus=clean(req.body.paymentStatus,30);
 const current=db.prepare('SELECT * FROM bookings WHERE id=?').get(id);if(!current)return res.status(404).json({error:'Booking not found.'});
 if(status && !['pending','confirmed','completed','cancelled'].includes(status))return res.status(400).json({error:'Invalid booking status.'});
 if(paymentStatus && req.session.user.role!=='admin')return res.status(403).json({error:'Only admins can change payment verification.'});
 if(paymentStatus && !['unpaid','pending_verification','paid'].includes(paymentStatus))return res.status(400).json({error:'Invalid payment status.'});
 try{db.prepare('UPDATE bookings SET status=?,payment_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status||current.status,paymentStatus||current.payment_status,id);res.json(db.prepare('SELECT * FROM bookings WHERE id=?').get(id));}
 catch(e){if(String(e.code).includes('SQLITE_CONSTRAINT'))return res.status(409).json({error:'This slot cannot be reactivated because it has already been booked.'});res.status(500).json({error:'Update failed.'});}
});
app.get('/api/admin/summary',auth,(req,res)=>{
 const date=validDate(req.query.date)?req.query.date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date());
 const counts=db.prepare("SELECT COUNT(*) bookings, SUM(CASE WHEN status<>'cancelled' THEN amount ELSE 0 END) gross, SUM(CASE WHEN payment_status='paid' AND status<>'cancelled' THEN amount ELSE 0 END) collected, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending FROM bookings WHERE booking_date=?").get(date);
 const byCourt=db.prepare("SELECT court,COUNT(*) bookings,SUM(CASE WHEN status<>'cancelled' THEN amount ELSE 0 END) income FROM bookings WHERE booking_date=? GROUP BY court ORDER BY court").all(date);
 const byPayment=db.prepare("SELECT payment_method,COUNT(*) bookings,SUM(CASE WHEN payment_status='paid' THEN amount ELSE 0 END) collected FROM bookings WHERE booking_date=? AND status<>'cancelled' GROUP BY payment_method").all(date);
 res.json({date,counts,byCourt,byPayment});
});
app.get('/api/admin/users',admin,(req,res)=>res.json(db.prepare('SELECT id,username,role,active,created_at FROM users ORDER BY role,username').all()));
app.post('/api/admin/users',admin,(req,res)=>{
 const username=clean(req.body.username,40),password=String(req.body.password||''),role=clean(req.body.role,10);
 if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)||password.length<10||!['admin','staff'].includes(role))return res.status(400).json({error:'Use a 3–40 character username and a password of at least 10 characters.'});
 try{const r=db.prepare('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)').run(username,bcrypt.hashSync(password,12),role);res.status(201).json({id:r.lastInsertRowid,username,role});}catch(e){res.status(409).json({error:'That username already exists.'});}
});
app.patch('/api/admin/users/:id',admin,(req,res)=>{const active=req.body.active?1:0;if(Number(req.params.id)===req.session.user.id&&!active)return res.status(400).json({error:'You cannot deactivate your own account.'});db.prepare('UPDATE users SET active=? WHERE id=?').run(active,Number(req.params.id));res.json({ok:true});});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Nicol Pickleball system listening on ${PORT}`));
