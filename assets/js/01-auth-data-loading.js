const KILL_GID = 224036219;

async function checkKillSwitch() {
  try {
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?key=${API_KEY}&fields=sheets.properties`;
    const metaRes = await fetch(metaUrl);
    const meta    = await metaRes.json();
    const sheet   = (meta.sheets || []).find(s => s.properties.sheetId === KILL_GID);
    if (!sheet) return false;
    const tabName = sheet.properties.title;
    const dataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tabName + '!B2')}?key=${API_KEY}`;
    const dataRes = await fetch(dataUrl);
    const data    = await dataRes.json();
    const val = (data.values || [])[0]?.[0] || '';
    return val.trim().toUpperCase() === 'TRUE';
  } catch (e) {
    console.warn('Kill switch check failed, defaulting to open:', e);
    return false;
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const killed = await checkKillSwitch();
  if (killed) {
    document.getElementById('kill-screen').classList.add('visible');
    return;
  }
  initLogin();
  fetchWeather();
});

/* =====================================================
   LOGIN
   ===================================================== */
const PASSWORD_TAB = 'Password & Kill Switch';

function initLogin(){
  const _authedAt = parseInt(sessionStorage.getItem('cert_authed_at')||'0');
  if(_authedAt && (Date.now() - _authedAt) < 60*60*1000){
    document.getElementById('login-screen').classList.add('hidden');
    startLoad();
    return;
  } else {
    sessionStorage.removeItem('cert_authed_at');
  }
  document.getElementById('login-pw').addEventListener('keydown', e=>{
    if(e.key==='Enter') submitLogin();
  });
}

function toggleLoginEye(){
  const inp = document.getElementById('login-pw');
  const btn = document.getElementById('login-eye-btn');
  const showing = inp.type === 'password';
  inp.type = showing ? 'text' : 'password';
  btn.textContent = showing ? 'Hide' : 'Show';
}

function submitLogin(){
  const btn   = document.getElementById('login-btn');
  const input = document.getElementById('login-pw');
  const errEl = document.getElementById('login-error');
  const typed = input.value.trim();
  if(!typed){ shakeEl(input); errEl.textContent='Please enter a password.'; return; }
  btn.disabled = true;
  btn.textContent = 'Checking…';
  errEl.textContent = '';
  const pwUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(PASSWORD_TAB)}?key=${API_KEY}`;
  fetch(pwUrl)
    .then(r=>{ if(!r.ok) throw new Error('Could not reach server.'); return r.json(); })
    .then(d=>{
      const rows = d.values || [];
      const correct = rows.slice(1).map(r=>(r[0]||'').trim()).find(p=>p.length>0);
      if(!correct) throw new Error('No password configured.');
      if(typed === correct){
        sessionStorage.setItem('cert_authed_at', Date.now().toString());
        document.getElementById('login-screen').classList.add('hidden');
        startLoad();
      } else {
        shakeEl(input);
        errEl.textContent = 'Incorrect password. Please try again.';
        input.value = '';
        input.focus();
        btn.disabled = false;
        btn.textContent = 'Unlock Map';
      }
    })
    .catch(err=>{
      errEl.textContent = 'Error: ' + err.message;
      btn.disabled = false;
      btn.textContent = 'Unlock Map';
    });
}

/* =====================================================
   DATA LOADING
   ===================================================== */
function apiUrl(sheet){
  return `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(sheet)}?key=${API_KEY}`;
}

function startLoad(){
  hideError();
  showLoadingScreen();
  fetch(apiUrl(SHEET_NAME))
    .then(r=>{ if(!r.ok) return r.json().then(e=>{throw new Error(e.error?.message||('HTTP '+r.status));}); return r.json(); })
    .then(d=>{ const rows=d.values||[]; if(rows.length<2) throw new Error('No data rows found.'); initMap(rowsToSirens(rows)); })
    .catch(err=>showError(err.message));
}

function rowsToSirens(rows){
  return rows.slice(1).filter(r=>r[0]).map(r=>({
    id:             r[0],
    friendlyName:   r[1]  ||'TBD',
    systemName:     r[2]  ||'TBD',
    lat:            parseFloat(r[3]),
    lng:            parseFloat(r[4]),
    status:         r[5]  ||'Unknown',
    lastTested:     r[6]  ||'N/A',
    nextTest:       r[7]  ||'N/A',
    signUpNeeded:   r[8]  ||'Yes',
    daysSinceSignup:parseFloat(r[9]) ||0,
    lastSignUpDate: r[10] ||'N/A',
    daysSinceVisit: parseFloat(r[11])||0,
    lastVisitDate:  r[12] ||'N/A',
    description:    r[13] ||'',
    instructions:   r[14] ||'',
    population:     parseInt(String(r[15]||'0').replace(/,/g,''))||0,
    imageUrl:       r[16] ||'',
    currentSignup:  r[17] ||'',
  }));
}

function driveImgSrc(url, size){
  if(!url) return '';
  size = size||'w400';
  let id = '';
  const m1 = url.match(/\/file\/d\/([^\/\?&]+)/);
  const m2 = url.match(/[?&]id=([^&]+)/);
  if(m1) id = m1[1];
  else if(m2) id = m2[1];
  if(!id) return '';
  return `https://drive.google.com/thumbnail?id=${id}&sz=${size}`;
}

/* =====================================================
   URGENCY
   ===================================================== */
function urgencyDays(s){
  const a=isNaN(s.daysSinceSignup)?9999:s.daysSinceSignup;
  const b=isNaN(s.daysSinceVisit) ?9999:s.daysSinceVisit;
  return Math.min(a,b);
}
function sirenColor(s){
  if((s.signUpNeeded||'').toLowerCase()!=='yes') return '#6b7280';
  const d=urgencyDays(s);
  if(d<=7)  return '#10b981';
  if(d<=14) return '#f59e0b';
  if(d<=21) return '#f97316';
  return '#dc2626';
}
function urgencyLabel(s){
  if((s.signUpNeeded||'').toLowerCase()!=='yes') return null;
  const d=urgencyDays(s);
  if(d<=7)  return{text:'Recent Activity ✓',      bg:'#d1fae5',color:'#065f46'};
  if(d<=14) return{text:'Needs Attention',          bg:'#fef3c7',color:'#92400e'};
  if(d<=21) return{text:'Action Required!',         bg:'#ffedd5',color:'#9a3412'};
  return          {text:'URGENT — No Recent Activity',bg:'#fee2e2',color:'#991b1b'};
}

/* =====================================================
   LIVES PROTECTED
   ===================================================== */
function calcLivesProtected(sirens){
  return sirens.filter(s=>s.daysSinceVisit<=21).reduce((sum,s)=>sum+s.population,0);
}

function animateCount(el, target, duration){
  const start = performance.now();
  function step(now){
    const p = Math.min((now-start)/duration,1);
    const ease = 1-Math.pow(1-p,3);
    el.textContent = Math.floor(target*ease).toLocaleString();
    if(p<1) requestAnimationFrame(step);
    else el.textContent = target.toLocaleString();
  }
  requestAnimationFrame(step);
}

/* =====================================================
   MAP INIT
   ===================================================== */
