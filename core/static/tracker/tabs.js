/* tracker/tabs.js — Вкладки: Текущая загрузка, Планирование, Отсутствия, Дашборды и Песочница, мелкие правки.
   Файлы грузятся строго по порядку: boot → core → ui → task_card → tabs (см. templates/tracker.html). */
/* ============================================================
   PATCH tasks-6/5 — вкладка «План проверок» в ряд (между Свод и
   Статистика) + открытие задачи по ?open_task=ID на главной.
   append-only, guard-флаг, существующий код не трогаем.
   ============================================================ */
(function(){
'use strict';
if (window.__trkGanttTabAndOpenTaskV1) return;
window.__trkGanttTabAndOpenTaskV1 = true;

/* --- п.5: отдельная вкладка «План проверок» перед «Статистикой» --- */
function buildGanttTab(){
    var tabs = document.querySelector('.tracker-tabs');
    if (!tabs) return;
    if (tabs.querySelector('[data-tab-plugin="gantt"]')) return;
    var statsTab = tabs.querySelector('.tracker-tab[data-tab="stats"]');
    /* PATCH: «План проверок» ПОСЛЕ «Задачи» (перед «Тепловая карта») */
    var anchorTab = tabs.querySelector('.tracker-tab[data-tab="tasks"]')
                 || tabs.querySelector('.tracker-tab[data-tab="calendar"]')
                 || statsTab;
    var perms = window.REESTR_PERMS || {};
    /* право плагина: если задано в реестре — уважаем; иначе показываем */
    var reg = (window.__trkPluginRegistry || []).filter(function(p){ return p.id === 'gantt'; })[0];
    if (reg && reg.perm && perms[reg.perm] === false) return;
    var url = (reg && reg.url) || '/plugins/gantt/';
    var btn = document.createElement('button');
    btn.className = 'tracker-tab';
    btn.setAttribute('data-tab-plugin', 'gantt');
    btn.innerHTML = '<span>📅</span><span>Текущая загрузка</span>';
    btn.addEventListener('click', function(e){
        e.preventDefault();
        e.stopPropagation();
        window.location.href = url;
    });
    if (anchorTab && anchorTab.parentNode === tabs) {
        if (anchorTab.getAttribute('data-tab') === 'tasks') {
            tabs.insertBefore(btn, anchorTab.nextSibling);
        } else {
            tabs.insertBefore(btn, anchorTab);
        }
    } else {
        tabs.appendChild(btn);
    }
}

/* --- п.6: открыть модалку задачи по ?open_task=ID --- */
function openTaskFromUrl(){
    var m = /[?&]open_task=([^&#]+)/.exec(window.location.search || '');
    if (!m) return;
    var tid;
    try { tid = decodeURIComponent(m[1]); } catch (er) { tid = m[1]; }
    if (!tid) return;

    function clearParam(){
        try {
            var u = new URL(window.location.href);
            u.searchParams.delete('open_task');
            window.history.replaceState({}, '', u.pathname + (u.search || '') + (u.hash || ''));
        } catch (er) {}
    }

    var tries = 0;
    var timer = setInterval(function(){
        tries++;
        var st = window.__trkState;
        var opener = window.__trkOpenTaskModal;
        if (st && Array.isArray(st.tasks) && st.tasks.length && typeof opener === 'function') {
            var t = st.tasks.find(function(x){ return String(x.id) === String(tid); });
            clearInterval(timer);
            clearParam();
            if (t) {
                /* переключимся на вкладку «Задачи», если есть */
                var tasksTab = document.querySelector('.tracker-tab[data-tab="tasks"]');
                if (tasksTab) { try { tasksTab.click(); } catch (er) {} }
                try { opener(t); } catch (er) { console.error('[open_task]', er); }
            } else {
                try { if (window.notify) window.notify('Проверка не найдена: ' + tid, 'error'); } catch (er) {}
            }
        } else if (tries > 50) {   /* ~10s максимум */
            clearInterval(timer);
        }
    }, 200);
}

/* ===== PATCH heatmap-emp: Тепловая карта сотрудников (банк -> сотрудники) ===== */
(function(){
  var HM = { data:null, kind:{audit:true}, bank:{}, dir:{retail:true,corp:true},
             mode:'week', expanded:{}, banksInit:false };
  /* PATCH hm-emp-scope: esc/apiJson объявлены function-декларациями в другом
     скоупе и НЕ видны внутри этого IIFE (pageerror "esc/apiJson is not defined").
     Берём глобальную версию, если есть, иначе локальный фолбэк. */
  var esc = (typeof window.esc === 'function') ? window.esc : function(s){
    return String(s==null?'':s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  };
  var apiJson = (typeof window.apiJson === 'function') ? window.apiJson : function(url, options){
    options = options || {};
    options.headers = Object.assign({}, options.headers || {});
    if (window.CSRF && options.method && options.method !== 'GET')
      options.headers['X-CSRF-Token'] = window.CSRF;
    if (!options.credentials) options.credentials = 'same-origin';
    return fetch(url, options).then(function(r){ return r.json(); });
  };
  function dirEmoji(k){ return k==='retail'?'🔴':(k==='corp'?'🔵':(k==='hybrid'?'🟣':'⚪')); }
  function dirLabel(k){ return k==='retail'?'розн':(k==='corp'?'корп':(k==='hybrid'?'гибрид':'—')); }
  /* Красивое оформление численности: целые смайлики + половинка.
     retail -> 🔴, corp -> 🔵. round до 0.5. */
  function staffPips(n, emoji){
    n = Math.max(0, Math.round((Number(n)||0)*2)/2);
    var whole = Math.floor(n), hasHalf = (n - whole) >= 0.5;
    var s = '';
    for (var i=0;i<whole;i++) s += '<span class="hm-pip">'+emoji+'</span>';
    if (hasHalf) s += '<span class="hm-pip hm-pip-half">'+emoji+'</span>';
    if (!s) s = '<span class="hm-pip-none">–</span>';
    return s;
  }
  function ddRender(host, items, sel, onchange){
    if (!host) return;
    function btnText(){
      var c = items.filter(function(i){return sel[i.value];});
      var t = (!c.length||c.length>=items.length) ? ('Все ('+items.length+')') : c.map(function(x){return x.label;}).join(', ');
      if (t.length>26) t = c.length+' выбр.';
      return t;
    }
    var h = '<button type="button" class="hm-dd-btn">'+esc(btnText())+'</button><div class="hm-dd-panel">';
    if (!items.length) h += '<div class="hm-dd-empty">Нет вариантов</div>';
    items.forEach(function(i){
      h += '<label class="hm-dd-item"><input type="checkbox" value="'+esc(i.value)+'"'+(sel[i.value]?' checked':'')+'><span>'+esc(i.label)+'</span></label>';
    });
    h += '</div>';
    host.className = 'hm-dd'; host.innerHTML = h;
    host.querySelector('.hm-dd-btn').onclick = function(ev){
      ev.stopPropagation();
      var open = host.classList.contains('open');
      document.querySelectorAll('.hm-dd.open').forEach(function(x){x.classList.remove('open');});
      if (!open) host.classList.add('open');
    };
    host.querySelectorAll('.hm-dd-item input').forEach(function(cb){
      cb.onchange = function(){
        if (cb.checked) sel[cb.value]=true; else delete sel[cb.value];
        host.querySelector('.hm-dd-btn').textContent = btnText();
        onchange && onchange();
      };
    });
  }
  document.addEventListener('click', function(){
    document.querySelectorAll('.hm-dd.open').forEach(function(x){x.classList.remove('open');});
  });
  function buildFilters(){
    /* фильтр ТИП ЗАДАЧИ убран: он не влиял на таблицу нагрузки. HM.kind=audit фиксирован. */
    ddRender(document.getElementById('hmDirDd'),
      [{value:'retail',label:'Розница'},{value:'corp',label:'Корпорат'}],
      HM.dir, function(){ hmRender(); });
    var banks = (HM.data && HM.data.banks || []).map(function(b){return {value:b.id,label:b.name};});
    if (!HM.banksInit && banks.length){ banks.forEach(function(b){ HM.bank[b.value]=true; }); HM.banksInit=true; }
    ddRender(document.getElementById('hmBankDd'), banks, HM.bank, function(){ hmRender(); });
  }

  function hmDefaultDates(){
    function iso(dt){ return dt.getFullYear()+'-'+('0'+(dt.getMonth()+1)).slice(-2)+'-'+('0'+dt.getDate()).slice(-2); }
    var f=document.getElementById('hmeFrom'), t=document.getElementById('hmeTo');
    var today=new Date();
    if (f && !f.value){ f.value=iso(today); }
    if (t && !t.value){ var d2=new Date(today.getTime()+180*86400000); t.value=iso(d2); }
  }
  function hmLoad(){
    hmDefaultDates();
    var kinds = Object.keys(HM.kind).filter(function(k){return HM.kind[k];});
    if (!kinds.length) kinds=['audit'];
    var from = (document.getElementById('hmeFrom')||{}).value || '';
    var to   = (document.getElementById('hmeTo')||{}).value || '';
    var qs = '?mode='+encodeURIComponent(HM.mode);
    if (from) qs += '&from='+encodeURIComponent(from);
    if (to)   qs += '&to='+encodeURIComponent(to);
    kinds.forEach(function(k){ qs += '&task_kind='+encodeURIComponent(k); });
    var wrap = document.getElementById('hmeWrap');
    if (wrap) wrap.innerHTML = '<div class="sum-empty">Загрузка…</div>';
    apiJson('/api/plugins/gantt/heatmap'+qs)
      .then(function(d){
        HM.data = d;
        if (!document.getElementById('hmeFrom').value && d.from) document.getElementById('hmeFrom').value=d.from;
        if (!document.getElementById('hmeTo').value && d.to) document.getElementById('hmeTo').value=d.to;
        buildFilters();
        hmRender();
      })
      .catch(function(){ if(wrap) wrap.innerHTML='<div class="sum-empty">Ошибка загрузки</div>'; });
  }

  function hmRender(){
    var d = HM.data, wrap = document.getElementById('hmeWrap');
    if (!wrap) return;
    if (!d || !d.banks || !d.banks.length){ wrap.innerHTML='<div class="sum-empty">Нет данных</div>'; return; }
    var periods = d.periods || [];
    var dirOn = HM.dir, anyDir = Object.keys(dirOn).some(function(k){return dirOn[k];});
    function dirVisible(k){ if(!anyDir) return true; if(k==='hybrid') return true; return !!dirOn[k]; }
    var h = '<table class="hm-emp-table"><thead><tr><th class="hm-emp-name">Отдел / сотрудник</th>';
    periods.forEach(function(p){ h += '<th class="hm-emp-cell">'+esc(p)+'</th>'; });
    h += '</tr></thead><tbody>';
    d.banks.forEach(function(b){
      if (Object.keys(HM.bank).length && !HM.bank[b.id]) return;
      var exp = !!HM.expanded[b.id];
      var load = b.load || [];
      /* Левая ячейка (имя банка + штатная численность) объединена на 2 строки (rowspan=2),
         как «Объединить и поместить в центре» в Excel. Справа сверху — нагрузка банка. */
      h += '<tr class="hm-bank-row" data-bank="'+esc(b.id)+'">'
         + '<td class="hm-emp-name hm-bank-name" rowspan="2">'
         +   '<div class="hm-bank-title"><span class="hm-caret">'+(exp?'▾':'▸')+'</span> <b>'+esc(b.name)+'</b></div>'
         +   '<div class="hm-staff-meta">'
         +     '<span class="hm-staff-item">общая <b>'+b.total+'</b></span>'
         +     '<span class="hm-staff-item">розн '+staffPips(b.retail,'🔴')+' <b>'+b.retail+'</b></span>'
         +     '<span class="hm-staff-item">корп '+staffPips(b.corp,'🔵')+' <b>'+b.corp+'</b></span>'
         +   '</div>'
         + '</td>';
      periods.forEach(function(_p, i){
        var v = load[i];
        h += '<td class="hm-emp-cell hm-bank-cell">'+(v? (Math.round((+v)*100)/100) : '')+'</td>';
      });
      h += '</tr>';
      /* Вторая строка пары (пустая справа — слева её закрывает rowspan). */
      h += '<tr class="hm-bank-row2" data-bank="'+esc(b.id)+'">';
      periods.forEach(function(){ h += '<td class="hm-emp-cell hm-bank-cell2"></td>'; });
      h += '</tr>';
      if (exp){
        (b.rows||[]).forEach(function(r){
          if (!dirVisible(r.kind)) return;
          var _tc = +r.task_count || 0;
          h += '<tr class="hm-emp-row"><td class="hm-emp-name hm-emp-sub" title="Проверок и задач с нагрузкой за период: '+_tc+'">'
             + dirEmoji(r.kind)+' '+esc(r.name)+' <span class="hm-emp-dir">('+dirLabel(r.kind)+')</span>'
             + '<span class="hm-emp-cnt">· '+_tc+' '+(_tc%10===1&&_tc%100!==11?'проверка':(_tc%10>=2&&_tc%10<=4&&(_tc%100<10||_tc%100>=20)?'проверки':'проверок'))+'</span></td>';
          (r.cells||[]).forEach(function(c, i){
            var hot = (Number(c)||0) >= 1.5 ? ' hm-cell-hot' : '';
            var meta = (r.cell_flags && r.cell_flags[i]) || null;
            var inf = (r.cell_info && r.cell_info[i]) || {};
            var extra = '', tip = [];
            var fmt = function(x){ return String(Math.round((+x) * 100) / 100).replace('.', ','); };
            if (c) tip.push('Нагрузка: ' + fmt(c));
            if (meta && meta.holiday) { extra = ' hm-cell-off'; tip.push('Выходной / праздник'); }
            else if (meta && meta.absent) { extra = ' hm-cell-absent'; tip.push('Отсутствие (отпуск / больничный / командировка)'); }
            else if (HM.mode === 'week' && (+inf.abs || 0) >= 0.999) { extra = ' hm-cell-absent'; tip.push('Отсутствует всю неделю'); }
            else if (HM.mode === 'week' && (+inf.abs || 0) > 0) { extra = ' hm-cell-abs-part'; tip.push('Отсутствует ' + Math.round(inf.abs * 100) + '% рабочих дней недели'); }
            if ((+inf.ext || 0) > 0) { extra += ' hm-cell-extra'; tip.push('в т.ч. доп. задачи в проверке: ' + fmt(inf.ext)); }
            h += '<td class="hm-emp-cell'+hot+extra+'"'+(tip.length?' title="'+esc(tip.join('\n'))+'"':'')+'>'+(c? fmt(c) : '')+'</td>';
          });
          h += '</tr>';
        });
      }
    });
    h += '</tbody></table>';
    h += '<div class="hm-legend-mini"><span><i class="lg-abs"></i>отсутствие (штриховка; бледнее — часть недели)</span><span><i class="lg-ext"></i>есть нагрузка от доп. задач в проверке</span><span>Число проверок — рядом с ФИО, при наведении — подробности</span></div>';
    wrap.innerHTML = h;
    wrap.querySelectorAll('.hm-bank-row, .hm-bank-row2').forEach(function(tr){
      tr.onclick = function(){ var id=tr.getAttribute('data-bank'); HM.expanded[id]=!HM.expanded[id]; hmRender(); };
    });
  }

  // режим неделя/день
  document.addEventListener('click', function(e){
    var b = e.target.closest && e.target.closest('#hmeMode button');
    if (!b) return;
    document.querySelectorAll('#hmeMode button').forEach(function(x){x.classList.remove('active');});
    b.classList.add('active'); 
    HM.mode = b.getAttribute('data-m')||'week';
    var f = document.getElementById('hmeFrom'), t = document.getElementById('hmeTo');
    if (f && t && f.value) {
        var startDt = new Date(f.value);
        var days = (HM.mode === 'day') ? 60 : 180;
        var newEnd = new Date(startDt.getTime() + days * 86400000);
        function iso(dt){ return dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0'); }
        t.value = iso(newEnd);
    }
    hmLoad();
  });
  var ap = document.getElementById('hmeApply'); if (ap) ap.onclick = hmLoad;

  function hmInitDefaults(){
    var fromEl = document.getElementById('hmeFrom');
    var toEl = document.getElementById('hmeTo');
    if (!fromEl || !toEl) return;
    if (!fromEl.value || !toEl.value){
      var today = new Date();
      var days = (HM.mode === 'day') ? 60 : 180;
      var d2 = new Date(today.getTime() + days * 86400000);
      function iso(dt){ return dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0'); }
      fromEl.value = iso(today);
      toEl.value = iso(d2);
    }
    HM.mode = 'week';
    document.querySelectorAll('#hmeMode button').forEach(function(x){ x.classList.toggle('active', x.getAttribute('data-m') === 'week'); });
  }

  // единственные точки входа тепловой карты нагрузки (делегаты наверху файла зовут их)
  window.__hmEmpLoad = function(){ if(!HM.data) buildFilters(); hmInitDefaults(); hmLoad(); };
  window.__hmEmpRender = function(){ hmRender(); };
  /* PATCH hm-emp: автозапуск, если вкладка тепловой карты уже активна при загрузке */
  function hmBootIfActive(){
    var pnl = document.getElementById('panel-heatmap');
    var wrap = document.getElementById('hmeWrap');
    if (pnl && pnl.classList.contains('active') && wrap){ window.__hmEmpLoad(); }
  }
  if (document.readyState === 'loading'){ document.addEventListener('DOMContentLoaded', hmBootIfActive); }
  else { hmBootIfActive(); }
  setTimeout(hmBootIfActive, 400);
})();

function init(){
    buildGanttTab();
    openTaskFromUrl();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
/* повторная попытка — вкладки могут строиться асинхронно */
setTimeout(buildGanttTab, 600);
setTimeout(buildGanttTab, 1500);

})();


/* ===== PATCH planning: Вкладка «Планирование проверок» (две таблицы корп/розн) ===== */
(function(){
  var esc = (typeof window.esc === 'function') ? window.esc : function(s){
    return String(s==null?'':s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  };
  var apiJson = (typeof window.apiJson === 'function') ? window.apiJson : function(url, options){
    options = options || {};
    options.headers = Object.assign({}, options.headers || {});
    if (window.REESTR_CSRF && options.method && options.method !== 'GET')
      options.headers['X-CSRF-Token'] = window.REESTR_CSRF;
    if (!options.credentials) options.credentials = 'same-origin';
    return fetch(url, options).then(function(r){ return r.json(); });
  };
  function st(){ return window.__trkState || {}; }
  function num(v){ var n = Number(v); return isFinite(n) ? n : 0; }
  function fmt(v){ var r = Math.round(num(v)*100)/100; return (''+r); }

  /* фактическая численность по направлению: Σ dir_* не уволенных сотрудников банка */
  function factByDir(depId, dir){
    var emps = (st().employees || []);
    var s = 0;
    emps.forEach(function(e){
      if (e.department_id !== depId || e.fired) return;
      s += num(dir === 'retail' ? e.dir_retail : e.dir_corp);
    });
    return Math.round(s*100)/100;
  }
  /* нормативная (штатная) численность по направлению */
  function normByDir(dep, dir){
    var v = (dir === 'retail') ? dep.headcount_retail : dep.headcount_corp;
    return (v === null || v === undefined || v === '') ? null : num(v);
  }
  function coefByDir(dep, dir){
    var v = (dir === 'retail') ? dep.expert_coef_retail : dep.expert_coef_corp;
    return (v === null || v === undefined || v === '') ? null : num(v);
  }

  function planAbbr(name){
    var s = String(name||'').trim();
    if (!s) return '—';
    s = s.replace(/\s*банк\s*$/i,'').trim();   /* убираем хвост "банк" */
    if (!s) s = String(name||'').trim();
    /* первые 3 буквы, заглавными */
    var base = s.replace(/[^A-Za-zА-Яа-яЁё]/g,'');
    var ab = (base || s).slice(0,3).toUpperCase();
    return ab;
  }
  function buildTable(tableId, dir){
    var tbl = document.getElementById(tableId);
    if (!tbl) return;
    var deps = (st().departments || []);
    if (!deps.length){ tbl.innerHTML = '<tbody><tr><td class="plan-empty">Нет банков</td></tr></tbody>'; return; }
    /* шапка: тер банки по столбцам; угловая ячейка «Показатель» вырезана */
    var head = '<thead><tr><th class="plan-corner"></th>';
    deps.forEach(function(d){
      head += '<th class="plan-bankcol" title="'+esc(d.name)+'">'+'<span class="plan-dot" style="background:'+esc(d.color||'#7a9ab5')+';"></span>'+'<span class="plan-bankabbr">'+esc(planAbbr(d.name))+'</span></th>';
    });
    head += '</tr></thead>';
    /* строки */
    function row(label, cells, cls){
      var h = '<tr'+(cls?' class="'+cls+'"':'')+'><td class="plan-rowhead">'+label+'</td>';
      h += cells.join('');
      return h + '</tr>';
    }
    var normCells=[], factCells=[], coefCells=[], possCells=[];
    deps.forEach(function(d){
      var norm = normByDir(d, dir);
      var fact = factByDir(d.id, dir);
      var coef = coefByDir(d, dir);
      normCells.push('<td>'+(norm===null?'–':fmt(norm))+'</td>');
      factCells.push('<td>'+fmt(fact)+'</td>');
      coefCells.push('<td><input class="plan-coef-input" type="number" step="0.1" min="0" '
        + 'data-dep="'+esc(d.id)+'" data-dir="'+dir+'" '
        + 'value="'+(coef===null?'':fmt(coef))+'" placeholder="–"></td>');
      var poss = (norm===null || coef===null) ? null : (norm*coef);
      possCells.push('<td class="plan-poss">'+(poss===null?'–':fmt(poss))+'</td>');
    });
    var body = '<tbody>'
      + row('Нормативная численность', normCells)
      + row('Фактическая численность', factCells)
      + row('Экспертный коэффициент', coefCells, 'plan-coef-row')
      + row('Возможное число проверок', possCells, 'plan-poss-row')
      + '</tbody>';
    tbl.innerHTML = head + body;
  }


  /* ===== Календарь планирования: остаток ресурса по неделям/месяцам ===== */
  var PLAN_TYPE = { retail: 'розничная', corp: 'корпоративная' };
  var PLAN_MON_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  var planExpanded = {}; /* ключ 'dir:y-m' -> развёрнут ли месяц */

  function _pd(s){ var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(s||'')); return m?new Date(+m[1],+m[2]-1,+m[3]):null; }
  function _ymd(dt){ var mm=('0'+(dt.getMonth()+1)).slice(-2), dd=('0'+dt.getDate()).slice(-2); return dt.getFullYear()+'-'+mm+'-'+dd; }
  function _ovl(a,b,ps,pe){ return a&&b&&a<=pe&&b>=ps; }

  function planAuditWeight(t, ps, pe){
    var w=0;
    (t.stages||[]).forEach(function(s){
      if(!s.start) return;
      var a=_pd(s.start), b=_pd(s.end||t.deadline||s.start);
      if(_ovl(a,b,ps,pe)) w=Math.max(w, Number(s.weight)||0);
    });
    return w;
  }
  function planLeadCoef(t, bankId){
    if((t.lead_department||'')!==bankId) return 1.0;
    var tp=t.task_type||'';
    if(tp==='розничная') return 2.0;
    if(tp==='корпоративная') return 1.5;
    return 1.0;
  }
  /* нагрузка банка по направлению на неделю (понедельник mon) */
  function planBankDirLoad(bankId, dir, mon){
    var tasks=(st().tasks||[]);
    var ps=new Date(mon.getTime()), pe=new Date(mon.getTime()); pe.setDate(pe.getDate()+6);
    var bl=0;
    tasks.forEach(function(t){
      if((t.department_ids||[]).indexOf(bankId)<0) return;
      if((t.task_kind||'audit')!=='audit') return;
      if((t.task_type||'')!==PLAN_TYPE[dir]) return;
      var w=planAuditWeight(t,ps,pe);
      if(w>0) bl+=w*planLeadCoef(t,bankId);
    });
    return Math.round(bl*100)/100;
  }
  function planPossible(dep, dir){
    var norm=normByDir(dep,dir), coef=coefByDir(dep,dir);
    if(norm===null||coef===null) return null;
    return norm*coef;
  }
  /* ближайший будущий понедельник от сегодня (если сегодня пн — следующий) */
  function planNextMonday(){
    var t=new Date(); t.setHours(0,0,0,0);
    var wd=(t.getDay()+6)%7; /* 0=пн */
    var delta=(7-wd)%7; if(delta===0) delta=7;
    t.setDate(t.getDate()+delta);
    return t;
  }
  /* все понедельники, принадлежащие месяцу (y,m0) по своему понедельнику */
  function planWeeksOfMonth(y, m0){
    var first=new Date(y,m0,1);
    var mon=new Date(first.getTime()); mon.setDate(mon.getDate()-((mon.getDay()+6)%7));
    var res=[];
    while(mon.getFullYear()<y || (mon.getFullYear()===y && mon.getMonth()<=m0)){
      if(mon.getMonth()===m0 && mon.getFullYear()===y) res.push(new Date(mon.getTime()));
      mon.setDate(mon.getDate()+7);
      if(mon.getFullYear()>y+1) break;
    }
    return res;
  }
  /* 12 месяцев от месяца ближайшего понедельника */
  function planMonths(){
    var nm=planNextMonday(); var y=nm.getFullYear(), m=nm.getMonth(); var out=[];
    for(var i=0;i<12;i++){ out.push([y,m]); m++; if(m>11){m=0;y++;} }
    return out;
  }
  function planCellClass(rem){
    if(rem===null) return '';
    if(rem<0) return 'plan-cal-red';
    if(rem>2) return 'plan-cal-green';
    return '';
  }
  function planFmtRem(rem){ return rem===null?'–':(''+(Math.round(rem*100)/100)); }

  function buildPlanCalendar(containerId, dir){
    var box=document.getElementById(containerId);
    if(!box) return;
    var deps=(st().departments||[]);
    if(!deps.length){ box.innerHTML='<div class="plan-empty">Нет банков</div>'; return; }
    var months=planMonths();
    /* шапка: угловая ячейка + банки (те же аббревиатуры, что в верхней таблице) */
    var head='<thead><tr><th class="plan-corner"></th>';
    deps.forEach(function(d){
      head+='<th class="plan-bankcol" title="'+esc(d.name)+'"><span class="plan-dot" style="background:'+esc(d.color||'#7a9ab5')+';"></span><span class="plan-bankabbr">'+esc(planAbbr(d.name))+'</span></th>';
    });
    head+='</tr></thead>';
    var body='<tbody>';
    months.forEach(function(ym){
      var y=ym[0], m0=ym[1];
      var key=dir+':'+y+'-'+m0;
      var open=!!planExpanded[key];
      var weeks=planWeeksOfMonth(y,m0);
      /* строка месяца: среднее остатка по неделям месяца для каждого банка */
      body+='<tr class="plan-cal-mrow" data-planmonth="'+key+'">';
      body+='<td class="plan-cal-mhead"><span class="plan-cal-caret">'+(open?'▾':'▸')+'</span>'
          + '<span class="plan-cal-mname">'+PLAN_MON_RU[m0]+'</span><span class="plan-cal-myear">'+y+'</span></td>';
      deps.forEach(function(d){
        var poss=planPossible(d,dir);
        if(poss===null){ body+='<td>–</td>'; return; }
        var sum=0,n=0;
        weeks.forEach(function(mon){ sum+=(poss-planBankDirLoad(d.id,dir,mon)); n++; });
        var avg=n?Math.round((sum/n)*100)/100:null;
        body+='<td class="'+planCellClass(avg)+'">'+planFmtRem(avg)+'</td>';
      });
      body+='</tr>';
      /* строки недель (видны, если месяц развёрнут) */
      if(open){
        weeks.forEach(function(mon){
          var we=new Date(mon.getTime()); we.setDate(we.getDate()+6);
          var lab=('0'+mon.getDate()).slice(-2)+'.'+('0'+(mon.getMonth()+1)).slice(-2)
                + '–'+('0'+we.getDate()).slice(-2)+'.'+('0'+(we.getMonth()+1)).slice(-2);
          body+='<tr class="plan-cal-wrow"><td class="plan-cal-whead">'+lab+'</td>';
          deps.forEach(function(d){
            var poss=planPossible(d,dir);
            if(poss===null){ body+='<td>–</td>'; return; }
            var rem=Math.round((poss-planBankDirLoad(d.id,dir,mon))*100)/100;
            body+='<td class="'+planCellClass(rem)+'">'+planFmtRem(rem)+'</td>';
          });
          body+='</tr>';
        });
      }
    });
    body+='</tbody>';
    box.innerHTML='<table class="plan-table plan-cal-table">'+head+body+'</table>';
  }

  /* делегированный клик по месяцу — разворот/сворот */
  document.addEventListener('click', function(e){
    var mh=e.target && e.target.closest && e.target.closest('.plan-cal-mrow');
    if(!mh) return;
    var key=mh.getAttribute('data-planmonth');
    if(!key) return;
    planExpanded[key]=!planExpanded[key];
    render();
  });

  function render(){
    buildTable('planCorpTable', 'corp');
    buildTable('planRetailTable', 'retail');
    buildPlanCalendar('planCorpCalendar', 'corp');
    buildPlanCalendar('planRetailCalendar', 'retail');
  }
  window.__trkPlanRender = render;

  /* сохранение экспертного коэффициента по blur / Enter */
  function saveCoef(inp){
    var depId = inp.getAttribute('data-dep');
    var dir = inp.getAttribute('data-dir');
    var deps = (st().departments || []);
    var dep = deps.filter(function(x){ return x.id === depId; })[0];
    if (!dep) return;
    var raw = inp.value.trim();
    var val = (raw === '') ? null : num(raw);
    /* локально обновим state, чтобы «возможное число» пересчиталось мгновенно */
    if (dir === 'retail') dep.expert_coef_retail = val; else dep.expert_coef_corp = val;
    var payload = {
      id: dep.id, name: dep.name, color: dep.color || '#00897b',
      head_employee_id: dep.head_employee_id || '',
      headcount_retail: (dep.headcount_retail===undefined?null:dep.headcount_retail),
      headcount_corp: (dep.headcount_corp===undefined?null:dep.headcount_corp),
      expert_coef_retail: (dep.expert_coef_retail===undefined?null:dep.expert_coef_retail),
      expert_coef_corp: (dep.expert_coef_corp===undefined?null:dep.expert_coef_corp)
    };
    apiJson('/api/tracker/department/save', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    }).then(function(d){
      if (!d || !d.success){ try{ if(window.notify) notify('❌ '+((d&&d.error)||'Ошибка'),'error'); }catch(e){} }
    }).catch(function(){});
    render();
  }

  document.addEventListener('blur', function(e){
    if (e.target && e.target.classList && e.target.classList.contains('plan-coef-input')) saveCoef(e.target);
  }, true);
  document.addEventListener('keydown', function(e){
    if (e.key === 'Enter' && e.target && e.target.classList && e.target.classList.contains('plan-coef-input')){
      e.preventDefault(); e.target.blur();
    }
  });

  /* автозапуск при открытии вкладки (panel-calendar теперь = планирование) */
  function bootIfActive(){
    var p = document.getElementById('panel-calendar');
    if (p && p.classList.contains('active') && document.getElementById('planCorpTable')) render();
  }
  document.addEventListener('click', function(e){
    if (e.target && e.target.closest && e.target.closest('.tracker-tab[data-tab="calendar"]')){
      setTimeout(render, 60);
    }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootIfActive);
  else bootIfActive();
  setTimeout(bootIfActive, 500);
})();

// --- VACATIONS TAB (clean rebuild v3) ---
(function(){
  'use strict';
  if (window.__trkVacTabV3) return;
  window.__trkVacTabV3 = true;
  var ABS_TYPES = [
    ['vacation','🌞 Отпуск'],
    ['sick_leave','🤒 Больничный'],
    ['business_trip','✈️ Командировка'],
    ['remote','🏠 Удаленка'],
    ['other','📝 Другое']
  ];
  var EMOJI_MAP = {
    'vacation': '🌞',
    'sick_leave': '🤒',
    'business_trip': '✈️',
    'remote': '🏠',
    'other': '📝'
  };
  var selEmp = null, selType = 'vacation', selYear = new Date().getFullYear(), bankStatsYear = new Date().getFullYear(), bankStatsBankId = '';
  function st(){ return window.__trkState || {departments:[], employees:[]}; }
  function ensureTab(){
    var tabs = document.querySelector('.tracker-tabs');
    if (!tabs) return;
    var oldBtn = tabs.querySelector('.tracker-tab[data-tab="vacations"]');
    if (oldBtn) oldBtn.remove();
    var drop = document.getElementById('employeesTabDropdown');
    if (drop && !drop.querySelector('[data-target-tab="vacations"]')) {
      var anchor = drop.querySelector('[data-target-tab="dicts"]');
      var btn = document.createElement('button');
      btn.className = 'tracker-tab-drop-item';
      btn.setAttribute('type', 'button');
      btn.setAttribute('data-target-tab', 'vacations');
      btn.innerHTML = '<span>🌞</span><span>Отсутствия</span>';
      if (anchor && anchor.parentNode === drop) drop.insertBefore(btn, anchor);
      else drop.appendChild(btn);
    }
    if (!document.getElementById('panel-vacations')){
      var host = document.querySelector('.tracker-panel');
      var panel = document.createElement('div');
      panel.className = 'tracker-panel'; panel.id = 'panel-vacations';
      panel.innerHTML =
        '<div class="vac-toolbar"><div class="vac-title">🌞 Ввод отсутствий</div></div>'+
        '<div class="vac-container">'+
          '<div class="vac-sidebar" id="vacBanksList"></div>'+
          '<div class="vac-workarea" id="vacWorkArea"><div class="vac-empty">Выберите сотрудника слева</div></div>'+
        '</div>';
      if (host && host.parentNode) host.parentNode.appendChild(panel);
      else document.body.appendChild(panel);
    }
  }
  function activate(){
    ensureTab();
    document.querySelectorAll('.tracker-tab').forEach(function(t){ t.classList.toggle('active', t.id==='employeesTabBtn'); });
    document.querySelectorAll('#employeesTabDropdown [data-target-tab]').forEach(function(t){ t.classList.toggle('active', t.getAttribute('data-target-tab')==='vacations'); });
    document.querySelectorAll('.tracker-panel').forEach(function(p){ p.classList.toggle('active', p.id==='panel-vacations'); });
    renderBanks();
    if(selEmp) renderForm();
    else {
      var wa = document.getElementById('vacWorkArea');
      if(wa && bankStatsBankId){
        var activeBank = Object.values(st().departments||{}).find(function(x){ return String(x.id)===String(bankStatsBankId); }) || null;
        if(activeBank) wa.innerHTML = renderBankStatsPanel(activeBank);
      }
    }
  }
  window.__trkVacTabV3Activate = activate;

function renderBanks(){
  var sb = document.getElementById('vacBanksList'); if(!sb) return;
  var s = st();
  var banks = Object.values(s.departments||{}).sort(function(a,b){return (a.name||'').localeCompare(b.name||'');});
  var emps  = Object.values(s.employees||{}).filter(function(e){return !e.fired;});
  var activeBankId = selEmp ? selEmp.department_id : (bankStatsBankId || '');
  sb.innerHTML = '';
  banks.forEach(function(b){
    var item=document.createElement('div'); item.className='vac-bank-item'; item.setAttribute('data-bank-id', String(b.id));
    var title=document.createElement('div'); title.className='vac-bank-title';
    var titleMain=document.createElement('div'); titleMain.className='vac-bank-title-main';
    var caret=document.createElement('span'); caret.className='vac-caret'; caret.textContent='▸';
    var label=document.createElement('span'); label.className='vac-bank-label'; label.textContent=b.name;
    titleMain.appendChild(caret); titleMain.appendChild(label);
    title.appendChild(titleMain);
    var statsBtn=document.createElement('button');
    statsBtn.type='button';
    statsBtn.className='vac-bank-stat-btn';
    statsBtn.setAttribute('title','Статистика по банку');
    statsBtn.setAttribute('aria-label','Статистика по банку');
    statsBtn.textContent='📊';
    title.appendChild(statsBtn);
    var list=document.createElement('div'); list.className='vac-emp-list';
    var mine=emps.filter(function(e){return e.department_id===b.id;}).sort(function(a,b){return (a.name||'').localeCompare(b.name||'');});
    mine.forEach(function(e){
      var row=document.createElement('div'); row.className='vac-emp-row'; row.textContent=e.name; row.setAttribute('data-emp-id', String(e.id));
      if(selEmp && selEmp.id===e.id) row.classList.add('active');
      row.onclick=function(){
        selEmp=e;
        if(bankStatsBankId && String(bankStatsBankId)!==String(e.department_id)) bankStatsBankId='';
        renderBanks(); renderForm();
      };
      list.appendChild(row);
    });
    if(!mine.length){ var em=document.createElement('div'); em.className='vac-emp-empty'; em.textContent='нет сотрудников'; list.appendChild(em); }
    // Клик по банку: раскрыть список и сразу показать статистику банка (сотрудник не выбирается)
    titleMain.onclick=function(){
      var willExpand = !item.classList.contains('expanded');
      item.classList.toggle('expanded'); caret.textContent=willExpand?'▾':'▸';
      if(willExpand && String(bankStatsBankId)!==String(b.id)){
        bankStatsBankId = b.id;
        if(selEmp && String(selEmp.department_id||'')!==String(b.id)) selEmp = null;
        markStatsBtns(); renderForm();
      }
    };
    // 📊 — переключатель статистики банка, без автоподстановки сотрудника
    statsBtn.onclick=function(ev){
      ev.stopPropagation();
      if(bankStatsBankId && String(bankStatsBankId)===String(b.id)){
        bankStatsBankId = '';
      } else {
        bankStatsBankId = b.id;
        if(selEmp && String(selEmp.department_id||'')!==String(b.id)) selEmp = null;
        if(!item.classList.contains('expanded')){ item.classList.add('expanded'); caret.textContent='▾'; }
      }
      markStatsBtns(); renderForm();
    };
    if(activeBankId && activeBankId===b.id){ item.classList.add('expanded'); caret.textContent='▾'; }
    if(bankStatsBankId && String(bankStatsBankId)===String(b.id)) statsBtn.classList.add('active');
    item.appendChild(title); item.appendChild(list); sb.appendChild(item);
  });
}
  function fmtDateRu(iso){
    if(!iso) return '';
    var p = iso.split('-');
    return p.length===3 ? (p[2]+'.'+p[1]+'.'+p[0]) : iso;
  }

function markStatsBtns(){
  document.querySelectorAll('#vacBanksList .vac-bank-item').forEach(function(it){
    var btn = it.querySelector('.vac-bank-stat-btn'); if(!btn) return;
    btn.classList.toggle('active', !!bankStatsBankId && it.getAttribute('data-bank-id')===String(bankStatsBankId));
  });
  document.querySelectorAll('#vacBanksList .vac-emp-row').forEach(function(r){
    r.classList.toggle('active', !!selEmp && r.getAttribute('data-emp-id')===String(selEmp.id));
  });
}
function bindBankStats(wa){
  if(!wa || wa.__vacStatsBound) return;
  wa.__vacStatsBound = true;
  wa.addEventListener('click', function(ev){
    var t = ev.target;
    if(t.closest('.vac-bank-collapse')){ bankStatsBankId=''; markStatsBtns(); renderForm(); return; }
    if(t.closest('.vacBankYPrev')){ bankStatsYear--; renderForm(); return; }
    if(t.closest('.vacBankYNext')){ bankStatsYear++; renderForm(); return; }
  });
}
function bankColor(bank){
  return (bank && bank.color) || '#60a5fa';
}
function escapeAttr(s){
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function parseISODate(iso){
  if(!iso) return null;
  var p = String(iso).split('-');
  return p.length===3 ? new Date(+p[0], +p[1]-1, +p[2]) : null;
}
function formatStatDate(iso){
  var d = parseISODate(iso);
  if(!d) return iso || '';
  var dd = String(d.getDate()).padStart(2,'0');
  var mm = String(d.getMonth()+1).padStart(2,'0');
  return dd + '.' + mm + '.' + d.getFullYear();
}
function bankEmployees(bankId){
  return Object.values(st().employees||{}).filter(function(e){ return !e.fired && e.department_id===bankId; })
    .sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); });
}
function bankVacations(bankId){
  var rows = [];
  bankEmployees(bankId).forEach(function(emp){
    (emp.vacations || []).forEach(function(v){
      rows.push({ employee_id: emp.id, employee_name: emp.name || '', type: v.type || 'vacation', from: v.from || '', to: v.to || '', comment: v.comment || '' });
    });
  });
  rows.sort(function(a,b){
    return String(a.from||'').localeCompare(String(b.from||'')) || (a.employee_name||'').localeCompare(b.employee_name||'');
  });
  return rows;
}
function countBankActiveHeadcount(bankId, year){
  var emps = bankEmployees(bankId), vals = [];
  for(var m=0; m<12; m++){
    var days = new Date(year, m+1, 0).getDate();
    for(var d=1; d<=days; d++){
      var iso = year + '-' + String(m+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
      var cnt = 0;
      emps.forEach(function(emp){
        var absent = false;
        (emp.vacations || []).forEach(function(v){
          var tp = v.type || 'vacation';
          if(tp === 'remote') return;
          if((v.from || '') <= iso && iso <= (v.to || '')) absent = true;
        });
        if(!absent) cnt += 1;
      });
      vals.push(cnt);
    }
  }
  return vals;
}
function sparklinePath(values, w, h, pad){
  if(!values || !values.length) return '';
  var min = Math.min.apply(null, values), max = Math.max.apply(null, values), span = Math.max(1, max - min);
  var innerW = Math.max(1, w - pad*2), innerH = Math.max(1, h - pad*2);
  var pts = values.map(function(v, i){
    var x = pad + (values.length === 1 ? innerW/2 : (i * innerW / (values.length - 1)));
    var y = h - pad - ((v - min) / span) * innerH;
    return [x, y];
  });
  var line = pts.map(function(p, i){ return (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2); }).join(' ');
  var area = 'M' + pts[0][0].toFixed(2) + ' ' + (h-pad).toFixed(2) + ' ' + pts.map(function(p){ return 'L' + p[0].toFixed(2) + ' ' + p[1].toFixed(2); }).join(' ') + ' L' + pts[pts.length-1][0].toFixed(2) + ' ' + (h-pad).toFixed(2) + ' Z';
  return { line: line, area: area, min: min, max: max, last: values[values.length-1] };
}
/* График фактической численности: шкала от 0 до максимума (целые), сетка, подписи месяцев прямо под осью X */
function vacHeadcountChartHtml(values, color, mNames){
  if(!values || !values.length) return '<div class="vac-list-empty">Нет данных для графика</div>';
  var W = 860, H = 190, PT = 10, PB = 2;
  var vmin = Math.min.apply(null, values), vmax = Math.max.apply(null, values), last = values[values.length-1];
  var top = Math.max(1, vmax), step = top <= 6 ? 1 : Math.ceil(top / 5);
  top = Math.ceil(top / step) * step;
  var innerH = H - PT - PB;
  var yOf = function(v){ return PT + (1 - v / top) * innerH; };
  var n = values.length;
  var pts = values.map(function(v, i){ return [(n === 1 ? W/2 : i * W / (n - 1)), yOf(v)]; });
  var line = pts.map(function(p, i){ return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
  var area = 'M0 ' + yOf(0).toFixed(1) + ' ' + pts.map(function(p){ return 'L' + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ') + ' L' + W + ' ' + yOf(0).toFixed(1) + ' Z';
  var grid = '', labels = '';
  for(var v = 0; v <= top; v += step){
    var y = yOf(v);
    grid += '<line x1="0" x2="' + W + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" class="vac-hc-grid' + (v === 0 ? ' zero' : '') + '" vector-effect="non-scaling-stroke"></line>';
    labels += '<span style="top:' + (y / H * 100).toFixed(2) + '%">' + v + '</span>';
  }
  var months = '';
  for(var m = 1; m < 12; m++){ months += '<line x1="' + (m * W / 12).toFixed(1) + '" x2="' + (m * W / 12).toFixed(1) + '" y1="' + PT + '" y2="' + yOf(0).toFixed(1) + '" class="vac-hc-mline" vector-effect="non-scaling-stroke"></line>'; }
  return '<div class="vac-hc">'
    + '<div class="vac-hc-y" title="Человек"><em>чел.</em>' + labels + '</div>'
    + '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-label="Фактическая численность банка">' + grid + months
    + '<path d="' + area + '" fill="' + color + '" opacity="0.18"></path>'
    + '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></path></svg>'
    + '<div class="vac-bank-chart-months">' + ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'].map(function(name, i){ return '<span title="' + (mNames[i] || name) + '">' + name + '</span>'; }).join('') + '</div>'
    + '</div>'
    + '<div class="vac-bank-chart-meta">Мин: ' + vmin + ' · Макс: ' + vmax + ' · На конец года: ' + last + '</div>';
}
function renderBankStatsPanel(bank){
  if(!bank) return '';
  var rows = bankVacations(bank.id), color = bankColor(bank), values = countBankActiveHeadcount(bank.id, bankStatsYear), spark = sparklinePath(values, 860, 190, 16);
  var mNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  var html = '<div class="vac-bank-stats" data-bank-stats="' + escapeAttr(bank.id) + '">';
  html += '<div class="vac-bank-stats-head"><div class="vac-bank-stats-title">Статистика по банку</div><button type="button" class="vac-bank-collapse" data-bank-collapse="' + escapeAttr(bank.id) + '">«</button></div>';
  html += '<div class="vac-bank-stats-body">';
  html += '<div class="vac-bank-stats-listwrap"><div class="vac-list-title">Список отсутствий (' + rows.length + ')</div><div class="vac-list-box vac-bank-list-box">';
  if(!rows.length){
    html += '<div class="vac-list-empty">Записей об отсутствиях пока нет</div>';
  } else {
    rows.forEach(function(v){
      var tPair = ABS_TYPES.find(function(x){ return x[0]===v.type; });
      var tLabel = tPair ? tPair[1] : ('🌞 ' + v.type);
      html += '<div class="vac-list-item vac-bank-stat-item"><div class="vac-list-main"><span class="vac-list-badge">' + tLabel + '</span><span class="vac-list-dates">' + formatStatDate(v.from) + ' — ' + formatStatDate(v.to) + '</span>' + (v.comment ? '<span class="vac-list-cm">· ' + String(v.comment).replace(/</g,'&lt;') + '</span>' : '') + '</div><div class="vac-bank-stat-emp">' + escapeAttr(v.employee_name) + '</div></div>';
    });
  }
  html += '</div></div>';
  html += '<div class="vac-bank-chart-wrap"><div class="vac-year-head"><span class="vac-year-title">Фактическая численность банка</span><div class="vac-year-ctrl"><button type="button" class="vacBankYPrev">◀</button><span class="vac-year-num">' + bankStatsYear + '</span><button type="button" class="vacBankYNext">▶</button></div></div>';
  html += '<div class="vac-bank-chart">';
  html += vacHeadcountChartHtml(values, color, mNames);
  html += '</div></div></div></div>';
  return html;
}
  function renderForm(){
    var wa = document.getElementById('vacWorkArea'); if(!wa) return;
    bindBankStats(wa);
    if(!selEmp){
      if(bankStatsBankId){
        var statsBank = Object.values(st().departments||{}).find(function(x){ return String(x.id)===String(bankStatsBankId); });
        if(statsBank){ wa.innerHTML = renderBankStatsPanel(statsBank); return; }
      }
      wa.innerHTML='<div class="vac-empty">Выберите сотрудника слева</div>'; return;
    }
    var freshEmp = Object.values(st().employees||{}).find(function(x){ return x.id===selEmp.id; });
    if(freshEmp) selEmp = freshEmp;

    var prevFrom = document.getElementById('vacFrom') ? document.getElementById('vacFrom').value : '';
    var prevTo   = document.getElementById('vacTo') ? document.getElementById('vacTo').value : '';
    var prevCm   = document.getElementById('vacComment') ? document.getElementById('vacComment').value : '';

    var html = '';
    var statsBankTop = bankStatsBankId ? Object.values(st().departments||{}).find(function(x){ return String(x.id)===String(bankStatsBankId); }) : null;
    if(statsBankTop){ html += renderBankStatsPanel(statsBankTop); }
    html += '<div class="vac-form-head">'+(selEmp.name||'')+'</div><div class="vac-types">';
    ABS_TYPES.forEach(function(t){
      html += '<button type="button" class="vac-type-btn '+(selType===t[0]?'active':'')+'" data-vtype="'+t[0]+'">'+t[1]+'</button>';
    });
    html += '</div>'+
      '<div class="vac-fields">'+
        '<label class="vac-fld"><span>С</span><input type="date" id="vacFrom" value="'+prevFrom+'"></label>'+
        '<label class="vac-fld"><span>По</span><input type="date" id="vacTo" value="'+prevTo+'"></label>'+
      '</div>'+
      '<div class="vac-fields"><label class="vac-fld vac-fld-wide"><span>Комментарий</span><input type="text" id="vacComment" placeholder="необязательно" value="'+prevCm.replace(/"/g,'&quot;')+'"></label></div>'+
      '<div class="vac-actions"><button type="button" class="vac-save-btn" id="vacSaveBtn">Сохранить</button><span class="vac-msg" id="vacMsg"></span></div>';

    var rawVacs = (selEmp.vacations||[]).map(function(v, origIdx){
      return { id: v.id, from: v.from||'', to: v.to||'', type: v.type||'vacation', comment: v.comment||'', origIdx: origIdx };
    });
    rawVacs.sort(function(a,b){ return a.from.localeCompare(b.from) || a.to.localeCompare(b.to); });

    var todayStr = (st().today) || new Date().toISOString().split('T')[0];

    html += '<div class="vac-list-wrap"><div class="vac-list-title">Список отсутствий ('+rawVacs.length+')</div><div class="vac-list-box">';
    if(!rawVacs.length){
      html += '<div class="vac-list-empty">Записей об отсутствиях пока нет</div>';
    } else {
      rawVacs.forEach(function(v){
        var tPair = ABS_TYPES.find(function(x){ return x[0]===v.type; });
        var tLabel = tPair ? tPair[1] : ('🌞 ' + v.type);
        var isPast = v.to && v.to < todayStr;
        var cls = 'vac-list-item' + (isPast ? ' past' : '');
        html += '<div class="'+cls+'">'+
          '<div class="vac-list-main">'+
            '<span class="vac-list-badge">'+tLabel+'</span>'+
            '<span class="vac-list-dates">'+fmtDateRu(v.from)+' — '+fmtDateRu(v.to)+'</span>'+
            (v.comment ? '<span class="vac-list-cm">· '+v.comment.replace(/</g,'&lt;')+'</span>' : '')+
          '</div>'+
          '<button type="button" class="vac-del-btn" data-idx="'+v.origIdx+'" data-vid="'+(v.id!=null?v.id:'')+'" title="Удалить">✕</button>'+
        '</div>';
      });
    }
    html += '</div></div>';

    var mNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    html += '<div class="vac-year-wrap">'+
      '<div class="vac-year-head">'+
        '<span class="vac-year-title">Календарь отсутствий</span>'+
        '<div class="vac-year-ctrl"><button type="button" id="vacYPrev">◀</button><span class="vac-year-num">'+selYear+'</span><button type="button" id="vacYNext">▶</button></div>'+
      '</div>'+
      '<div class="vac-year-grid">';

    var findDayEmoji = function(ds){
      for(var i=0; i<rawVacs.length; i++){
        if(rawVacs[i].from <= ds && ds <= rawVacs[i].to){
          return EMOJI_MAP[rawVacs[i].type] || '🌞';
        }
      }
      return '';
    };

    for(var m=1; m<=12; m++){
      var daysInMonth = new Date(selYear, m, 0).getDate();
      var mm = m<10 ? '0'+m : ''+m;
      for(var cell=1; cell<=15; cell++){
        var d1 = (cell-1)*2 + 1;
        var d2 = (cell===15) ? daysInMonth : (d1 + 1);
        var em = '';
        var tip = '';
        if(d1 <= daysInMonth){
          var daysList = [];
          for(var d=d1; d<=Math.min(d2, daysInMonth); d++) daysList.push(d);
          tip = daysList.map(function(d){ return (d<10?'0'+d:d)+'.'+mm+'.'+selYear; }).join(', ');
          for(var k=0; k<daysList.length; k++){
            var dd = daysList[k]<10 ? '0'+daysList[k] : ''+daysList[k];
            var ds = selYear + '-' + mm + '-' + dd;
            var found = findDayEmoji(ds);
            if(found){ em = found; break; }
          }
        } else {
          tip = '—';
        }
        var gr = Math.ceil(cell/3);
        var gc = (m-1)*3 + ((cell-1)%3) + 1;
        html += '<div class="vac-mcell'+(em?' has-em':'')+(d1>daysInMonth?' out-month':'')+'" style="grid-row:'+gr+';grid-column:'+gc+'" title="'+tip+'">'+em+'</div>';
      }
      html += '<div class="vac-mlabel" style="grid-row:6;grid-column:'+((m-1)*3+1)+' / span 3; font-size: 1.25rem; font-weight: bold;">'+mNames[m-1]+'</div>';
    }
    html += '</div></div>';

    wa.innerHTML = html;

    wa.querySelectorAll('.vac-type-btn').forEach(function(btn){
      btn.onclick = function(){ selType = btn.getAttribute('data-vtype'); renderForm(); };
    });
    wa.querySelector('#vacSaveBtn').onclick = save;
    wa.querySelectorAll('.vac-del-btn').forEach(function(btn){
      btn.onclick = function(){
        delVac(btn.getAttribute('data-vid'), btn.getAttribute('data-idx'));
      };
    });
    wa.querySelector('#vacYPrev').onclick = function(){ selYear--; renderForm(); };
    wa.querySelector('#vacYNext').onclick = function(){ selYear++; renderForm(); };
  }

  function getCsrfToken(){
    if(window.REESTR_CSRF) return window.REESTR_CSRF;
    var m = document.querySelector('meta[name="csrf-token"]');
    if(m && m.getAttribute('content')) return m.getAttribute('content');
    var i = document.querySelector('input[name="csrf_token"]');
    return i ? i.value : '';
  }

  function postJson(url, payload){
    if(typeof window.apiJson === 'function'){
      return window.apiJson(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
      });
    }
    var tok = getCsrfToken();
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': tok,
        'X-CSRFToken': tok
      },
      body: JSON.stringify(payload)
    }).then(function(r){ return r.json(); });
  }

  function delVac(vid, idx){
    if(!selEmp) return;
    var payload = { employee_id: selEmp.id };
    if(vid !== null && vid !== undefined && vid !== '' && vid !== 'undefined'){
      payload.id = parseInt(vid, 10);
    } else {
      payload.index = parseInt(idx, 10);
    }
    postJson('/api/tracker/employee/vacation/delete', payload).then(function(res){
      if(res && res.success){
        if(typeof window.trkRefreshAll === 'function'){
          window.trkRefreshAll().then(function(){
            renderBanks();
            renderForm();
            if (typeof window.refreshEmployeeVacationViews === 'function') {
              window.refreshEmployeeVacationViews(selEmp.id, false);
            }
          });
        } else if (typeof window.refreshEmployeeVacationViews === 'function') {
          window.refreshEmployeeVacationViews(selEmp.id, false).then(function(){
            renderBanks();
            renderForm();
          });
        } else {
          renderBanks();
          renderForm();
        }
      } else {
        var msg = document.getElementById('vacMsg');
        if(msg){ msg.textContent = (res && res.error) || 'Ошибка удаления'; msg.className = 'vac-msg err'; }
      }
    }).catch(function(e){
      var msg = document.getElementById('vacMsg');
      if(msg){ msg.textContent = (e && e.message) || 'Ошибка удаления'; msg.className = 'vac-msg err'; }
    });
  }

  function save(){
    var msg = document.getElementById('vacMsg');
    var fEl = document.getElementById('vacFrom'), tEl = document.getElementById('vacTo'), cEl = document.getElementById('vacComment');
    var frm = fEl ? fEl.value : '', to = tEl ? tEl.value : '', cm = cEl ? cEl.value : '';
    if(!selEmp) return;
    if(!frm || !to){
      if(msg){ msg.textContent = 'Укажите даты'; msg.className = 'vac-msg err'; }
      return;
    }
    if(to < frm){
      if(msg){ msg.textContent = 'Дата окончания раньше начала'; msg.className = 'vac-msg err'; }
      return;
    }
    var payload = {
      employee_id: selEmp.id,
      type: selType,
      from: frm,
      to: to,
      comment: cm
    };
    postJson('/api/tracker/employee/vacation/add', payload).then(function(res){
      if(res && (res.success || res.ok)){
        if(fEl) fEl.value = '';
        if(tEl) tEl.value = '';
        if(cEl) cEl.value = '';
        var afterRefresh = function(){
          renderBanks();
          renderForm();
          if (typeof window.refreshEmployeeVacationViews === 'function') {
            window.refreshEmployeeVacationViews(selEmp.id, false);
          }
          var m2 = document.getElementById('vacMsg');
          if(m2){ m2.textContent = 'Сохранено ✓'; m2.className = 'vac-msg ok'; }
        };
        if(typeof window.trkRefreshAll === 'function'){
          window.trkRefreshAll().then(afterRefresh);
        } else {
          afterRefresh();
        }
      } else {
        if(msg){ msg.textContent = (res && res.error) || 'Ошибка'; msg.className = 'vac-msg err'; }
      }
    }).catch(function(e){
      if(msg){ msg.textContent = (e && e.message) || 'Ошибка сети'; msg.className = 'vac-msg err'; }
    });
  }

  function boot(){ ensureTab(); }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  var _or = window.render;
  window.render = function(){
    if(_or) _or();
    if(selEmp){ renderBanks(); renderForm(); }
  };
})();



/* =========================================================================
   PATCH DASHBOARDS (Песочница планирования)
   ========================================================================= */
(function(){
    'use strict';
    if (window.__trkDashboardsV2) return;
    window.__trkDashboardsV2 = true;

    var stateDash = { task:null, mode:'medium', dir:'all', draft:null, lanes:[{task:null,draft:null,offset:0,pinned:false}], activeLane:0, globalOffset:0, leadPickerLane:null };
    var MODE_MONTHS = { small:12, medium:6, large:3 };
    // Compact geometry preserves the original fonts; use native browser zoom.
    var DASH_DENSITY = 0.6;
    // Measure actual rendered labels, not an assumed number of pixels per day.
    function dashFitTicks(){
        document.querySelectorAll('#dashGanttContainer .dash-tl-axis').forEach(function(axis){
            var right = -Infinity;
            axis.querySelectorAll('.dash-tl-tick').forEach(function(tick){
                tick.style.visibility = '';
                var r = tick.getBoundingClientRect();
                if (r.left < right + 8) tick.style.visibility = 'hidden';
                else right = r.right;
            });
        });
    }
    function dashScheduleTicks(){ window.requestAnimationFrame(dashFitTicks); }

    function syncLane(){ var l=stateDash.lanes[stateDash.activeLane]; if(l){ l.task=stateDash.task; l.draft=stateDash.draft; } }
    function switchLane(i){ stateDash.activeLane=i; var l=stateDash.lanes[i]; stateDash.task=l?l.task:null; stateDash.draft=l?l.draft:null; }
    function addLane(){ if(stateDash.lanes.length>=5) return false; stateDash.lanes.push({task:null,draft:null,offset:stateDash.globalOffset||0,pinned:false}); switchLane(stateDash.lanes.length-1); return true; }
    function findEmptyLane(){ for (var i=0;i<stateDash.lanes.length;i++){ var l=stateDash.lanes[i]; if (l && !l.task && !l.draft) return i; } return -1; }
    function removeLane(i){ if(stateDash.lanes.length<=1) return false; stateDash.lanes.splice(i,1); if(stateDash.activeLane>=stateDash.lanes.length) stateDash.activeLane=stateDash.lanes.length-1; switchLane(stateDash.activeLane); return true; }
    function laneOffset(lane){ lane=lane||stateDash.lanes[stateDash.activeLane]||{}; return lane && lane.pinned ? (lane.offset||0) : (stateDash.globalOffset||0); }
    function setLanePinned(i, pinned){ var lane=stateDash.lanes[i]; if(!lane) return; lane.pinned=!!pinned; if(lane.pinned) lane.offset=stateDash.globalOffset||0; }
    var DASH_DIR_LABEL = { retail:'Розничное', corp:'Корпоративное' };
    var DASH_STAGE_KEY_DEFAULT = 'проверка_нжя';

    var STAGE_ORDER = [
        'подготовка','проверка_нжя','проверка_соглЦА','ос_проф',
        'реализация_возражения','реализация_согласования','запас','оценка_тб'
    ];
    var STAGE_LABELS = {
        'подготовка':'Подготовка',
        'проверка_нжя':'Проверка НЖЯ',
        'проверка_соглЦА':'Проверка согл. ЦА',
        'ос_проф':'ОС проф.',
        'реализация_возражения':'Реализация возражения',
        'реализация_согласования':'Реализация согласования',
        'запас':'Запас',
        'оценка_тб':'Оценка ТБ'
    };
    var STAGE_WEIGHTS = {
        'подготовка': 0.7,
        'проверка_нжя': 1.0,
        'проверка_соглЦА': 1.0,
        'ос_проф': 0.0,
        'реализация_возражения': 1.0,
        'реализация_согласования': 0.5,
        'запас': 0.5,
        'оценка_тб': 0.0
    };
    var STAGE_COLORS = {
        'подготовка':'#5dade2',
        'проверка_нжя':'#48c9b0',
        'проверка_соглЦА':'#58d68d',
        'ос_проф':'#f4d03f',
        'реализация_возражения':'#eb984e',
        'реализация_согласования':'#e59866',
        'запас':'#af7ac5',
        'оценка_тб':'#ec7063'
    };
    var PLAN_TYPE_MAP = { retail:'розничная', corp:'корпоративная' };

    function st(){ return window.__trkState || { tasks:[], departments:[], employees:[] }; }
    function byId(id){ return document.getElementById(id); }
    function escapeHtml(s){
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
            return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
        });
    }
    function notify(msg, kind){
        if (typeof window.__trackerNotify === 'function') { window.__trackerNotify(msg, kind); return; }
        var t = document.getElementById('toast');
        if (t) {
            t.textContent = msg;
            t.className = 'toast show ' + (kind || 'info');
            setTimeout(function(){ t.classList.remove('show'); }, 2800);
            return;
        }
        try { console.log('[dashboards]', kind || 'info', msg); } catch(e){}
    }
    function apiJson(url, options){
        options = options || {};
        options.headers = Object.assign({}, options.headers || {});
        var csrf = window.REESTR_CSRF || '';
        if (!csrf) {
            var meta = document.querySelector('meta[name="csrf-token"]');
            if (meta) csrf = meta.getAttribute('content') || '';
        }
        if (csrf && options.method && options.method !== 'GET') {
            options.headers['X-CSRF-Token'] = csrf;
        }
        if (!options.credentials) options.credentials = 'same-origin';
        return fetch(url, options).then(function(r){ return r.json(); });
    }
    function fmtNum(v){
        return (v === null || v === undefined || isNaN(v)) ? '—' : String(Math.round(Number(v)*100)/100).replace('.', ',');
    }
    function num(v){ var n = Number(v); return isFinite(n) ? n : 0; }
    function ymd(d){
        return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }
    function todayISO(){
        var s = st().today;
        if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        return ymd(new Date());
    }
    function parse(s){
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
        return m ? new Date(+m[1], +m[2]-1, +m[3]) : null;
    }
    function addDays(d, n){
        var x = new Date(d.getTime());
        x.setDate(x.getDate() + n);
        return x;
    }
    function addDaysISO(iso, delta){
        var d = parse(iso) || new Date();
        d.setDate(d.getDate() + delta);
        return ymd(d);
    }
    var DASH_NEW_START_OFFSET_DAYS = 30, DASH_NEW_LENGTH_MONTHS = 2;
    function addMonthsISO(iso, months){
        var d = parse(iso) || new Date();
        var day = d.getDate();
        d.setDate(1);
        d.setMonth(d.getMonth() + months);
        var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(day, last));
        return ymd(d);
    }
    function ovl(a, b, ps, pe){
        return a && b && a <= pe && b >= ps;
    }
    function clone(x){ return JSON.parse(JSON.stringify(x || {})); }
    function deptById(id){
        return (st().departments || []).find(function(d){ return d.id === id; }) || null;
    }
    function stageLabel(key){ return STAGE_LABELS[key] || key; }
    function stageWeight(key){ return (STAGE_WEIGHTS[key] !== undefined) ? STAGE_WEIGHTS[key] : 1.0; }
    function dirTaskType(dir){ return PLAN_TYPE_MAP[dir] || (dir === 'corp' ? 'корпоративная' : 'розничная'); }
    function dashTaskDir(t){
        var tt = (t && t.task_type ? String(t.task_type) : '').toLowerCase();
        if (tt.indexOf('корп') !== -1) return 'corp';
        if (tt.indexOf('розн') !== -1) return 'retail';
        return '';
    }
    function dashDirMatch(t){
        if (stateDash.dir === 'all') return true;
        var d = dashTaskDir(t);
        return d === '' || d === stateDash.dir;
    }

    function normByDir(dep, dir){
        if (!dep) return null;
        var v = (dir === 'retail') ? dep.headcount_retail : dep.headcount_corp;
        return (v === null || v === undefined || v === '') ? null : num(v);
    }
    function coefByDir(dep, dir){
        if (!dep) return null;
        var v = (dir === 'retail') ? dep.expert_coef_retail : dep.expert_coef_corp;
        return (v === null || v === undefined || v === '') ? null : num(v);
    }
    function calcPossible(dep, dir){
        var obj = (typeof dep === 'object' && dep) ? dep : deptById(dep);
        if (!obj) return null;
        var n = normByDir(obj, dir), c = coefByDir(obj, dir);
        if (n === null || c === null) return null;
        return Math.round(n * c * 100) / 100;
    }
    function calcAuditWeight(t, ps, pe){
        /* Завершённые (с даты завершения) и отменённые проверки не дают нагрузку */
        if (t && (t.status === 'cancelled' || t.status === 'archived')) return 0;
        if (t && t.status === 'done') {
            var ca = String(t.completed_at || '').slice(0, 10);
            if (ca.length < 10) return 0;
            var cd = parse(ca), now0 = new Date(); now0.setHours(0,0,0,0);
            if (cd && cd > now0) cd = now0;
            if (!cd || cd <= ps) return 0;
            if (cd < pe) pe = new Date(cd.getTime() - 1);
        }
        var stages = (t && Array.isArray(t.stages)) ? t.stages.filter(function(s){ return s && s.start; }) : [];
        if (!stages.length) {
            var a0 = parse(t && t.start_date), b0 = parse((t && t.deadline) || (t && t.start_date));
            return ovl(a0, b0, ps, pe) ? 1.0 : 0;
        }
        var w = 0;
        stages.forEach(function(s){
            var a = parse(s.start), b = parse(s.end || (t && t.deadline) || s.start);
            if (ovl(a, b, ps, pe)) {
                var sw = (s.weight !== undefined && s.weight !== null) ? Number(s.weight) : stageWeight(s.key);
                if (sw > w) w = sw;
            }
        });
        return w;
    }
    function calcTaskLeadCoef(t, bankId){
        if (!t || (t.lead_department || '') !== bankId) return 1.0;
        var tp = t.task_type || '';
        if (tp === 'розничная') return 2.0;
        if (tp === 'корпоративная') return 1.5;
        return 1.0;
    }
    function calcTaskShareMult(t, bankId){
        if (!t || !t.department_shares) return 1.0;
        var v = t.department_shares[bankId];
        if (v === undefined || v === null || v === '') return 1.0;
        var n = Number(v);
        return isFinite(n) && n > 0 ? (n / 100.0) : 1.0;
    }

    function ensureDashboardsTab(){ return null; }
    function activateDashboardsTab(){
        document.querySelectorAll('.tracker-tab').forEach(function(t){
            t.classList.remove('active');
        });
        var calendarTab = document.querySelector('.tracker-tab[data-tab="calendar"]');
        if (calendarTab) calendarTab.classList.add('active');
        document.querySelectorAll('.tracker-panel').forEach(function(p){
            p.classList.toggle('active', p.id === 'panel-dashboards');
        });
        try { localStorage.setItem('tracker_activeTab', 'dashboards'); } catch(e){}
        renderSelector();
        syncControls();
        renderDashboardsLayout();
        renderGantt();
        renderLoad();
    }

    function dashNormalizeStages(task){
        var raw = (task && Array.isArray(task.stages)) ? clone(task.stages) : [];
        var stages = raw.filter(function(s){ return s && s.start; }).map(function(s){
            return { key:s.key, start:s.start, end:s.end || s.start, weight:(s.weight===undefined||s.weight===null)?stageWeight(s.key):s.weight };
        });
        stages.sort(function(a,b){ return STAGE_ORDER.indexOf(a.key) - STAGE_ORDER.indexOf(b.key); });
        if (!stages.length) {
            var ds = (task && task.start_date) || todayISO();
            var de = (task && task.deadline) || addDaysISO(ds, 90);
            if (de < ds) de = ds;
            stages = [{ key: DASH_STAGE_KEY_DEFAULT, start: ds, end: de, weight: 1.0 }];
        }
        for (var i = 0; i < stages.length; i++) {
            var s = stages[i];
            if (!s.end || s.end < s.start) s.end = s.start;
            if (s.weight === undefined || s.weight === null) s.weight = stageWeight(s.key);
        }
        for (var k = 1; k < stages.length; k++) {
            var prev = stages[k-1], cur = stages[k];
            var prevEnd = parse(prev.end || prev.start), curStart = parse(cur.start), curEnd = parse(cur.end || cur.start);
            if (prevEnd && curStart && curEnd && curStart <= prevEnd) {
                var len = Math.max(1, Math.round((curEnd - curStart) / 86400000));
                cur.start = addDaysISO(prev.end || prev.start, 1);
                cur.end = addDaysISO(cur.start, len);
            }
        }
        return stages;
    }

    function dashBuildDraft(task){
        var draft = clone(task || {});
        draft.id = task && task.id ? task.id : '';
        draft.name = draft.name || 'Проверка';
        draft.task_kind = draft.task_kind || 'audit';
        draft.task_type = draft.task_type || (stateDash.dir !== 'all' ? dirTaskType(stateDash.dir) : 'розничная');
        // Не переключаем фильтр, если выбрано «Все» — просто показываем проверку как есть
        if (stateDash.dir !== 'all') {
            if (draft.task_type === 'корпоративная') stateDash.dir = 'corp';
            else if (draft.task_type === 'розничная') stateDash.dir = 'retail';
        }
        draft.start_date = draft.start_date || todayISO();
        draft.deadline = draft.deadline || addDaysISO(draft.start_date, 90);
        if (draft.deadline < draft.start_date) draft.deadline = draft.start_date;
        draft.department_ids = Array.isArray(draft.department_ids) ? draft.department_ids.slice() : [];
        draft.department_shares = clone(draft.department_shares || {});
        draft.department_ids.forEach(function(depId){
            if (draft.department_shares[depId] == null) draft.department_shares[depId] = 100;
        });
        draft.stages = dashNormalizeStages(draft);
        draft.lead_department = draft.lead_department || (draft.department_ids[0] || '');
        return draft;
    }

    function dashCreateDraft(opts){
        opts = opts || {};
        var emptyIdx = findEmptyLane();
        if (emptyIdx >= 0) {
            switchLane(emptyIdx);
        } else if (stateDash.lanes.length < 5) {
            addLane();
        }
        // Новая колбаска: старт через 30 дней от сегодня, длина 2 календарных месяца
        var start = addDaysISO(todayISO(), DASH_NEW_START_OFFSET_DAYS);
        var end = addDaysISO(addMonthsISO(start, DASH_NEW_LENGTH_MONTHS), -1);
        var allDeps = (st().departments || []);
        var firstDepIds = allDeps.length ? [allDeps[0].id] : [];
        var shares = {};
        firstDepIds.forEach(function(id){ shares[id] = 100; });
        var dir = opts.dir === 'corp' ? 'corp' : 'retail';
        var draft = {
            id: '',
            name: opts.name,
            task_kind: 'audit',
            task_type: dirTaskType(dir),
            pocket: opts.pocket || '',
            start_date: start,
            deadline: end,
            department_ids: firstDepIds,
            department_shares: shares,
            lead_department: firstDepIds[0] || '',
            stages: [{ key: DASH_STAGE_KEY_DEFAULT, start: start, end: end, weight: 1.0 }]
        };
        // Чтобы созданная колбаска не отфильтровалась — выставляем направление фильтра под неё
        if (stateDash.dir !== 'all' && stateDash.dir !== dir) stateDash.dir = 'all';
        stateDash.task = null;
        stateDash.draft = draft;
        syncLane();
        syncControls();
        renderSelector();
        renderGantt();
        renderLoad();
        notify('Черновик «' + draft.name + '» добавлен на ось (' + DASH_DIR_LABEL[dir] + ', ' + DASH_NEW_LENGTH_MONTHS + ' мес: ' + dashFmtD(start) + ' → ' + dashFmtD(end) + '). В БД он попадёт после «Сохранить изменения»', 'info');
    }

    function dashCloseCreateModal(){
        var ov = byId('dashCreateModal');
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        document.removeEventListener('keydown', dashCreateModalEsc);
    }
    function dashCreateModalEsc(e){ if (e.key === 'Escape') dashCloseCreateModal(); }

    function dashOpenCreateModal(){
        dashCloseCreateModal();
        var existingCount = (st().tasks || []).filter(function(t){ return (t.task_kind || 'audit') === 'audit'; }).length;
        var defName = 'Новая проверка ' + (existingCount + 1);
        var defDir = stateDash.dir === 'corp' ? 'corp' : 'retail';
        // Список существующих карманов
        function pocketOptsFor(dir){
            var tt = dirTaskType(dir), o = ['<option value="">— Вне кармана —</option>'];
            (window.trkPocketsFor ? window.trkPocketsFor(tt, '') : (window.__trkPocketList || [])).forEach(function(p){ if (p.direction === tt && p.is_active) o.push('<option value="'+escapeHtml(p.name)+'">'+escapeHtml(p.name)+'</option>'); });
            return o.join('');
        }
        var pocketOpts = [pocketOptsFor(defDir)];

        var ov = document.createElement('div');
        ov.id = 'dashCreateModal';
        ov.className = 'dash-modal-overlay';
        ov.innerHTML = ''
            + '<div class="dash-modal" role="dialog" aria-modal="true">'
            +   '<div class="dash-modal-head">Новая проверка</div>'
            +   '<div class="dash-modal-body">'
            +     '<label class="dash-modal-label">Название проверки <span class="dash-req">*</span></label>'
            +     '<input type="text" id="dashCmName" class="form-control" value="'+escapeHtml(defName)+'" placeholder="Например: Проверка Байкальского банка">'
            +     '<div class="dash-modal-err" id="dashCmNameErr"></div>'
            +     '<label class="dash-modal-label">Направление <span class="dash-req">*</span></label>'
            +     '<div class="btn-seg dash-modal-seg" id="dashCmDir">'
            +       '<button class="btn-seg-btn'+(defDir==='corp'?' active':'')+'" type="button" data-dir="corp">Корп</button>'
            +       '<button class="btn-seg-btn'+(defDir==='retail'?' active':'')+'" type="button" data-dir="retail">Розн</button>'
            +     '</div>'
            +     '<label class="dash-modal-label">Карман</label>'
            +     '<select id="dashCmPocket" class="form-control">'+pocketOpts.join('')+'</select>'
            +   '</div>'
            +   '<div class="dash-modal-foot">'
            +     '<button class="btn btn-secondary" type="button" id="dashCmCancel">Отмена</button>'
            +     '<button class="btn" type="button" id="dashCmOk">Создать</button>'
            +   '</div>'
            + '</div>';
        document.body.appendChild(ov);

        var dirSel = defDir;
        var seg = byId('dashCmDir');
        seg.addEventListener('click', function(e){
            var b = e.target && e.target.closest ? e.target.closest('[data-dir]') : null;
            if (!b) return;
            dirSel = b.getAttribute('data-dir');
            seg.querySelectorAll('[data-dir]').forEach(function(x){ x.classList.toggle('active', x===b); });
            var ps = byId('dashCmPocket'); if (ps) ps.innerHTML = pocketOptsFor(dirSel);
        });
        ov.addEventListener('mousedown', function(e){ if (e.target === ov) dashCloseCreateModal(); });
        byId('dashCmCancel').addEventListener('click', dashCloseCreateModal);
        document.addEventListener('keydown', dashCreateModalEsc);
        byId('dashCmOk').addEventListener('click', function(){
            var nm = (byId('dashCmName').value || '').trim();
            if (!nm) { byId('dashCmNameErr').textContent = 'Укажите название проверки'; byId('dashCmName').focus(); return; }
            var pk = byId('dashCmPocket').value || '';
            dashCloseCreateModal();
            dashCreateDraft({ name: nm, dir: dirSel, pocket: pk });
        });
        setTimeout(function(){ var el=byId('dashCmName'); if(el){ el.focus(); el.select(); } }, 30);
    }

    function loadDraft(t){
        stateDash.task = t || null;
        stateDash.draft = t ? dashBuildDraft(t) : null;
        syncLane();
        syncControls();
        renderSelector();
        renderGantt();
        renderLoad();
    }

    function syncControls(){
        var sel = byId('dashTaskSelector');
        if (sel) {
            if (stateDash.task && stateDash.task.id) sel.value = stateDash.task.id;
            else if (stateDash.draft && !stateDash.draft.id) sel.value = '__new__';
            else sel.value = '';
        }
        var dirBox = byId('dashDirSwitch');
        if (dirBox) {
            dirBox.querySelectorAll('[data-dir]').forEach(function(btn){
                btn.classList.toggle('active', btn.getAttribute('data-dir') === stateDash.dir);
            });
        }
        var modeBox = byId('dashModeSwitch');
        if (modeBox) {
            modeBox.querySelectorAll('[data-mode]').forEach(function(btn){
                btn.classList.toggle('active', btn.getAttribute('data-mode') === stateDash.mode);
            });
        }
        var slider = byId('dashGlobalSlider');
        if (slider) {
            var cfg = dashGlobalSliderConfig();
            slider.min = cfg.min;
            slider.max = cfg.max;
            slider.step = 1;
            var v = stateDash.globalOffset || 0;
            if (v < cfg.min) v = cfg.min;
            if (v > cfg.max) v = cfg.max;
            slider.value = v;
        }
    }

    function renderSelector(){
        var sel = byId('dashTaskSelector');
        if (!sel) return;
        var allTasks = (st().tasks || []);
        var auditTasks = allTasks.filter(function(t){ return (t.task_kind || 'audit') === 'audit'; });
        var base = auditTasks.length ? auditTasks : allTasks;
        var list = base.filter(function(t){ return dashDirMatch(t); });
        var opts = ['<option value="">-- Выберите проверку (' + list.length + ') --</option>'];
        if (stateDash.draft && !stateDash.draft.id) {
            opts.push('<option value="__new__">✨ ' + escapeHtml(stateDash.draft.name || 'Новая проверка') + ' (черновик)</option>');
        }
        list.forEach(function(t){
            var meta = [];
            if (t.task_type) meta.push(t.task_type);
            if (t.start_date || t.deadline) meta.push((t.start_date || '…') + '→' + (t.deadline || '…'));
            if (Array.isArray(t.department_ids) && t.department_ids.length) meta.push('банков: ' + t.department_ids.length);
            opts.push('<option value="' + escapeHtml(t.id) + '">' + escapeHtml(t.name) + (meta.length ? ' · ' + escapeHtml(meta.join(' · ')) : '') + '</option>');
        });
        sel.innerHTML = opts.join('');
        if (stateDash.task && stateDash.task.id) sel.value = stateDash.task.id;
        else if (stateDash.draft && !stateDash.draft.id) sel.value = '__new__';
        else sel.value = '';
    }

    function dashGlobalSliderConfig(){
        if (stateDash.mode === 'small') return { min:-180, max:360 };
        if (stateDash.mode === 'large') return { min:-45, max:90 };
        return { min:-90, max:180 };
    }

    function dashClampGlobalOffset(v){
        var cfg = dashGlobalSliderConfig();
        v = Number(v) || 0;
        if (v < cfg.min) v = cfg.min;
        if (v > cfg.max) v = cfg.max;
        return Math.round(v);
    }

    function dashTimeBounds(offsetDays){
        var months = MODE_MONTHS[stateDash.mode] || 6;
        var totalDays = Math.round(months * 30.44);
        var center = addDaysISO(todayISO(), offsetDays || 0);
        var at20 = Math.floor(totalDays * 0.20);
        var startISO = addDaysISO(center, -at20);
        var endISO = addDaysISO(center, totalDays - at20);
        return { startISO: startISO, endISO: endISO, days: totalDays };
    }

    function dashSlots(offsetDays){
        var b = dashTimeBounds(offsetDays);
        var start = parse(b.startISO) || new Date(); start.setHours(0,0,0,0);
        var end = parse(b.endISO) || addDays(start, 180); end.setHours(0,0,0,0);
        if (end < start) { var tmp = start; start = end; end = tmp; }
        var slots = [];
        var useDays = (stateDash.mode === 'large');
        if (useDays) {
            var maxDays = 120, cnt = 0;
            for (var d = new Date(start.getTime()); d <= end && cnt < maxDays; d = addDays(d, 1), cnt++) {
                slots.push({ key: ymd(d), start: new Date(d.getTime()), end: new Date(d.getTime()),
                    label: String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') });
            }
        } else {
            var mon = new Date(start.getTime());
            var wd = (mon.getDay() + 6) % 7;
            mon.setDate(mon.getDate() - wd);
            var maxWeeks = 80, wcnt = 0;
            while (mon <= end && wcnt < maxWeeks) {
                var we = addDays(mon, 6);
                slots.push({ key: ymd(mon), start: new Date(mon.getTime()), end: we,
                    label: String(mon.getDate()).padStart(2,'0') + '.' + String(mon.getMonth()+1).padStart(2,'0') });
                mon = addDays(mon, 7);
                wcnt++;
            }
        }
        return slots;
    }
    function dashLoadOffsets(){
        var out = [];
        var seen = {};
        var lanes = Array.isArray(stateDash.lanes) ? stateDash.lanes : [];
        lanes.forEach(function(l){
            var off = laneOffset(l);
            var key = String(off);
            if (!seen[key]) { seen[key] = 1; out.push(off); }
        });
        if (!out.length) out.push(dashClampGlobalOffset(stateDash.globalOffset || 0));
        return out.sort(function(a,b){ return a - b; });
    }
    function dashDraftsForLoad(){
        var rows = [];
        var lanes = Array.isArray(stateDash.lanes) ? stateDash.lanes : [];
        lanes.forEach(function(l){
            if (l && l.draft) rows.push(l.draft);
        });
        if (!rows.length && stateDash.draft) rows.push(stateDash.draft);
        return rows;
    }

    function dashLeadCoef(depId){
        if (!stateDash.draft) return 1.0;
        if ((stateDash.draft.lead_department || '') !== depId) return 1.0;
        var tp = stateDash.draft.task_type || dirTaskType(stateDash.dir);
        if (tp === 'розничная') return 2.0;
        if (tp === 'корпоративная') return 1.5;
        return 1.0;
    }
    function dashShareMult(depId){
        if (!stateDash.draft || !stateDash.draft.department_shares) return 1.0;
        var v = stateDash.draft.department_shares[depId];
        if (v === undefined || v === null || v === '') return 1.0;
        var n = Number(v);
        return isFinite(n) && n > 0 ? (n / 100.0) : 1.0;
    }
    function dashDraftStageLoad(slotStart, slotEnd, depId){
        var drafts = dashDraftsForLoad();
        if (!drafts.length) return 0;
        var total = 0;
        drafts.forEach(function(draft){
            if (!draft || (draft.department_ids || []).indexOf(depId) < 0) return;
            var draftDir = dashTaskDir(draft) || ((draft.task_type || '').indexOf('корп') !== -1 ? 'corp' : 'retail');
            if (stateDash.dir !== 'all' && draftDir && draftDir !== stateDash.dir) return;
            var stages = dashNormalizeStages(draft);
            var maxW = 0;
            stages.forEach(function(s){
                if (!s.start) return;
                var a = parse(s.start), b = parse(s.end || draft.deadline || s.start);
                if (ovl(a, b, slotStart, slotEnd)) {
                    var sw = (s.weight !== undefined && s.weight !== null) ? Number(s.weight) : stageWeight(s.key);
                    if (sw > maxW) maxW = sw;
                }
            });
            if (maxW > 0) total += Math.round(maxW * calcTaskLeadCoef(draft, depId) * calcTaskShareMult(draft, depId) * 100) / 100;
        });
        return Math.round(total * 100) / 100;
    }
    function dashBaseLoad(depId, slot){
        var all = st().tasks || [];
        var editId = (stateDash.draft && stateDash.draft.id) || (stateDash.task && stateDash.task.id) || '';
        var dirType = dirTaskType(stateDash.dir);
        var ps = new Date(slot.start.getTime()); ps.setHours(0,0,0,0);
        var pe = new Date(slot.end.getTime()); pe.setHours(23,59,59,999);
        var base = 0;
        all.forEach(function(t){
            if (editId && t.id === editId) return;
            if ((t.department_ids || []).indexOf(depId) < 0) return;
            if ((t.task_kind || 'audit') !== 'audit') return;
            if ((t.task_type || '') !== dirType) return;
            var w = calcAuditWeight(t, ps, pe);
            if (w > 0) base += w * calcTaskLeadCoef(t, depId) * calcTaskShareMult(t, depId);
        });
        return Math.max(0, Math.round(base * 100) / 100);
    }

    function dashShiftAll(deltaDays){
        if (!stateDash.draft) return;
        var d = stateDash.draft, stg = dashNormalizeStages(d);
        stg.forEach(function(s){
            s.start = addDaysISO(s.start, deltaDays);
            s.end = addDaysISO(s.end || s.start, deltaDays);
        });
        d.stages = stg;
        d.start_date = addDaysISO(d.start_date, deltaDays);
        d.deadline = addDaysISO(d.deadline, deltaDays);
    }

    function dashAttachDrag(c){
        var track = byId('dashTlTrack');
        if (!track || !stateDash.draft) return;
        var rng = stateDash._range || {};
        var days = rng.days || 180;
        /* Cache track width at drag start — NOT re-read during move (it can be 0 after innerHTML swap) */
        var trackW = track.getBoundingClientRect().width || track.offsetWidth || 800;
        function pxToDays(px){
            return Math.round((px / trackW) * days);
        }
        var drag = null;
        function onDown(e){
            if (e.button !== undefined && e.button !== 0) return;
            var t = e.target;
            if (t.closest && t.closest('.dash-seg-del')) return;
            if (t.closest && t.closest('[data-lane]')) return;
            if (t.closest && t.closest('.dash-lane-close')) return;
            if (t.closest && t.closest('#dashAddLaneBtn')) return;
            var handle = t.closest ? t.closest('.dash-seg-h') : null;
            var seg = t.closest ? t.closest('.dash-seg') : null;
            if (handle) {
                drag = { type:'edge', idx:+handle.getAttribute('data-idx'), edge:handle.getAttribute('data-edge') };
            } else if (seg) {
                drag = { type:'seg', idx:+seg.getAttribute('data-idx') };
            } else {
                drag = { type:'all' };
            }
            drag.x0 = e.clientX;
            /* Snapshot the current stages ONCE at drag start */
            drag.snap = dashNormalizeStages(stateDash.draft).map(function(s){
                return { key:s.key, start:s.start, end:s.end, weight:s.weight };
            });
            drag.baseStart = stateDash.draft.start_date;
            drag.baseDeadline = stateDash.draft.deadline;
            /* Re-read track width in case layout changed */
            trackW = track.getBoundingClientRect().width || track.offsetWidth || 800;
            e.preventDefault();
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        }
        function onMove(e){
            if (!drag || !stateDash.draft) return;
            var dd = pxToDays(e.clientX - drag.x0);
            if (dd === 0) return;
            var snap = drag.snap;
            if (drag.type === 'all') {
                /* Apply delta from snapshot, not from current state */
                stateDash.draft.stages = snap.map(function(s){ return { key:s.key, start:addDaysISO(s.start, dd), end:addDaysISO(s.end||s.start, dd), weight:s.weight }; });
                stateDash.draft.start_date = addDaysISO(drag.baseStart, dd);
                stateDash.draft.deadline = addDaysISO(drag.baseDeadline, dd);
            } else {
                var i = drag.idx, s = snap[i];
                if (!s) return;
                var stg = snap.map(function(x){ return { key:x.key, start:x.start, end:x.end, weight:x.weight }; });
                if (drag.type === 'edge') {
                    if (drag.edge === 'start') {
                        var ns = addDaysISO(s.start, dd);
                        if (ns > stg[i].end) ns = stg[i].end;
                        stg[i].start = ns;
                    } else {
                        var ne = addDaysISO(s.end, dd);
                        if (ne < stg[i].start) ne = stg[i].start;
                        stg[i].end = ne;
                    }
                } else {
                    stg[i].start = addDaysISO(s.start, dd);
                    stg[i].end = addDaysISO(s.end, dd);
                }
                stg.sort(function(a,b){ return STAGE_ORDER.indexOf(a.key) - STAGE_ORDER.indexOf(b.key); });
                for (var k = 1; k < stg.length; k++) {
                    var prev = stg[k-1], cur = stg[k];
                    if (cur.start <= prev.end) {
                        var curLen = Math.max(1, Math.round((parse(cur.end||cur.start) - parse(cur.start)) / 86400000));
                        cur.start = addDaysISO(prev.end, 1);
                        cur.end = addDaysISO(cur.start, curLen);
                    }
                }
                stateDash.draft.stages = stg;
                stateDash.draft.start_date = stg[0].start;
                stateDash.draft.deadline = stg[stg.length-1].end;
            }
            syncLane();
            renderGantt();
            renderLoad();
        }
        function onUp(){
            drag = null;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        }
        track.addEventListener('pointerdown', onDown);
        c.querySelectorAll('.dash-seg-del').forEach(function(b){
            b.addEventListener('click', function(ev){
                ev.stopPropagation();
                var idx = +this.getAttribute('data-del');
                var stg = dashNormalizeStages(stateDash.draft);
                if (stg[idx] && stg[idx].key !== DASH_STAGE_KEY_DEFAULT) {
                    stg.splice(idx, 1);
                    stateDash.draft.stages = stg;
                    syncLane();
                    renderGantt(); renderLoad();
                }
            });
        });
    }

    function openAddStageDialog(){
        if (!stateDash.draft) { dashOpenCreateModal(); return; }
        var existing = {};
        dashNormalizeStages(stateDash.draft).forEach(function(s){ existing[s.key] = true; });
        var options = STAGE_ORDER.filter(function(k){ return k !== DASH_STAGE_KEY_DEFAULT && !existing[k]; });
        if (!options.length) { notify('Все 7 дополнительных этапов уже добавлены', 'info'); return; }
        var labels = options.map(function(k, i){ return (i+1) + '. ' + stageLabel(k) + ' (вес ' + stageWeight(k) + ')'; }).join('\n');
        var ans = window.prompt('Добавить этап в колбаску:\n' + labels + '\n\nВведите номер этапа (1–' + options.length + '):', '1');
        if (ans === null) return;
        var idx = parseInt(ans, 10) - 1;
        if (isNaN(idx) || idx < 0 || idx >= options.length) { notify('Некорректный номер этапа', 'error'); return; }
        var key = options[idx];
        var stg = dashNormalizeStages(stateDash.draft);
        var lastEnd = stateDash.draft.deadline || stateDash.draft.start_date || todayISO();
        stg.forEach(function(s){ if ((s.end || s.start) > lastEnd) lastEnd = s.end || s.start; });
        var newStart = addDaysISO(lastEnd, 1);
        var newEnd = addDaysISO(newStart, 13);
        stg.push({ key: key, start: newStart, end: newEnd, weight: stageWeight(key) });
        stateDash.draft.stages = stg;
        if (newEnd > stateDash.draft.deadline) stateDash.draft.deadline = newEnd;
        renderGantt();
        renderLoad();
    }

    function openAddBankDialog(){
        if (!stateDash.draft) { dashOpenCreateModal(); return; }
        var cur = stateDash.draft.department_ids || [];
        var avail = (st().departments || []).filter(function(dep){ return cur.indexOf(dep.id) < 0; });
        if (!avail.length) { notify('Все банки уже участвуют в проверке', 'info'); return; }
        var labels = avail.map(function(dep, i){ return (i+1) + '. ' + dep.name; }).join('\n');
        var ans = window.prompt('Добавить банк в проверку:\n' + labels + '\n\nВведите номер банка (1–' + avail.length + '):', '1');
        if (ans === null) return;
        var idx = parseInt(ans, 10) - 1;
        if (isNaN(idx) || idx < 0 || idx >= avail.length) { notify('Некорректный номер банка', 'error'); return; }
        var dep = avail[idx];
        stateDash.draft.department_ids = cur.concat([dep.id]);
        stateDash.draft.department_shares = stateDash.draft.department_shares || {};
        if (stateDash.draft.department_shares[dep.id] == null) stateDash.draft.department_shares[dep.id] = 100;
        if (!stateDash.draft.lead_department) stateDash.draft.lead_department = dep.id;
        renderGantt();
        renderLoad();
    }

    function renderLaneBlock(lane, laneIdx, isActive, b, canClose, canPin, isPinned){
        var hasDraft = !!lane.draft;
        var d = lane.draft || {
            name: 'Проверка не выбрана (линия жизни)',
            task_type: dirTaskType(stateDash.dir),
            start_date: todayISO(),
            deadline: addDaysISO(todayISO(), 90),
            department_ids: [],
            stages: []
        };
        var stages = hasDraft ? dashNormalizeStages(d) : [];
        b = b || dashTimeBounds(laneOffset(lane));
        var rangeStart = b.startISO, rangeEnd = b.endISO, totalDays = b.days || 180;

        function pctX(iso){
            var dd = Math.round((parse(iso) - parse(rangeStart)) / 86400000);
            return Math.max(-5, Math.min(105, (dd / totalDays) * 100));
        }

        var ticks = [];
        var useDays = (stateDash.mode === 'large');
        var step = useDays ? (totalDays > 60 ? 3 : 1) : 7;
        for (var ti = 0; ti <= totalDays; ti += step) {
            var iso = addDaysISO(rangeStart, ti);
            var dt = parse(iso);
            var lbl = String(dt.getDate()).padStart(2,'0') + '.' + String(dt.getMonth()+1).padStart(2,'0');
            ticks.push('<div class="dash-tl-tick" style="left:' + ((ti / totalDays) * 100) + '%"><span>' + escapeHtml(lbl) + '</span></div>');
        }
        var todayMarker = '<div class="dash-tl-today" style="left:' + pctX(todayISO()) + '%" title="Сегодня"></div>';
        var header = '<div class="dash-lane-header">'
            + '<div class="dash-lane-title">Ось ' + (laneIdx+1) + (hasDraft ? ' · ' + escapeHtml(d.name || 'Проверка') : '') + '</div>'
            + '<div class="dash-lane-header-actions">'
            + (canPin ? '<button class="dash-lane-pin' + (isPinned ? ' active' : '') + '" type="button" data-lane-pin="' + laneIdx + '" title="' + (isPinned ? 'Открепить ось' : 'Закрепить ось') + '">📌</button>' : '')
            + (canClose ? '<button class="dash-lane-close" type="button" data-lane-close="' + laneIdx + '" title="Удалить ось">×</button>' : '')
            + '</div></div>';

        var segs = '';
        if (hasDraft) {
            segs = stages.map(function(s, idx){
                var x0 = pctX(s.start);
                var x1 = pctX(s.end || addDaysISO(s.start, 1));
                var w = Math.max(1.5, x1 - x0);
                var col = STAGE_COLORS[s.key] || '#48c9b0';
                var isDefault = (s.key === DASH_STAGE_KEY_DEFAULT);
                var tip = stageLabel(s.key) + ': ' + s.start + ' → ' + (s.end || s.start) + ' (вес ' + fmtNum(s.weight) + ')';
                return '<div class="dash-seg' + (isDefault ? ' dash-seg-lead' : '') + '" data-idx="' + idx + '" title="' + escapeHtml(tip) + '" style="left:' + x0 + '%;width:' + w + '%;background:' + escapeHtml(col) + '">'
                    + '<span class="dash-seg-h dash-seg-h-l" data-idx="' + idx + '" data-edge="start" title="Тянуть начало"></span>'
                    + '<span class="dash-seg-lab">' + escapeHtml(stageLabel(s.key)) + ' (' + escapeHtml(s.start.slice(8)+'.'+s.start.slice(5,7)) + '–' + escapeHtml((s.end||s.start).slice(8)+'.'+(s.end||s.start).slice(5,7)) + ')</span>'
                    + '<span class="dash-seg-h dash-seg-h-r" data-idx="' + idx + '" data-edge="end" title="Тянуть конец"></span>'
                    + (isDefault ? '' : '<button class="dash-seg-del" type="button" data-del="' + idx + '" data-lane="' + laneIdx + '" title="Удалить этап">×</button>')
                    + '</div>';
            }).join('');
        } else {
            segs = '<div class="dash-tl-empty-bar">Пустая линия жизни (' + escapeHtml(rangeStart) + ' → ' + escapeHtml(rangeEnd) + '). Выберите проверку или нажмите «+ Создать проверку».</div>';
        }
        var trackId = isActive ? ' id="dashTlTrack"' : '';
        return '<div class="dash-lane-block" data-lane-block="' + laneIdx + '">'
            + header
            + '<div class="dash-timeline">'
            + '<div class="dash-tl-axis">' + ticks.join('') + '</div>'
            + '<div class="dash-tl-track"' + trackId + ' data-lane-track="' + laneIdx + '">' + todayMarker + segs + '</div>'
            + '</div>'
            + renderLaneControls(lane, laneIdx)
            + '</div>';
    }

    function renderLaneControls(lane, laneIdx){
        var hasDraft = !!lane.draft;
        if (!hasDraft) return '';
        var d = lane.draft;
        var allDeps = st().departments || [];
        var curIds = d.department_ids || [];

        /* Bank chips: white -> blue (on), lead -> yellow */
        var bankChips = '<div class="dash-bank-row"><div class="dash-bank-chips"><span class="dash-bank-chips-lbl">\u0411\u0430\u043d\u043a\u0438 \u0432 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0435 (\u043a\u043b\u0438\u043a \u2014 \u0432\u043a\u043b/\u0432\u044b\u043a\u043b):</span>'
            + allDeps.map(function(dep){
                var on = curIds.indexOf(dep.id) >= 0;
                var isLead = (d.lead_department === dep.id);
                var sh = (d.department_shares && d.department_shares[dep.id] != null) ? d.department_shares[dep.id] : 100;
                return '<button class="dash-bank-chip' + (on ? ' on' : '') + (isLead ? ' lead' : '') + '" type="button" data-toggle-bank="' + escapeHtml(dep.id) + '" data-lane="' + laneIdx + '" title="' + escapeHtml(dep.name + (isLead ? ' (\u0440\u0443\u043a\u043e\u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044c)' : '') + (on ? ' \u00b7 \u0434\u043e\u043b\u044f ' + sh + '%' : '')) + '">' + escapeHtml(dep.name) + (isLead ? ' \u2605' : '') + '</button>';
            }).join('')
            + '</div>'
            + '<button class="dash-lead-picker-btn" type="button" data-open-lead-picker="' + laneIdx + '">\u0421\u043c\u0435\u043d\u0438\u0442\u044c \u0440\u0443\u043a\u043e\u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044f</button></div>';

        /* Stage chips: white -> stage color (on) */
        var existing = {};
        dashNormalizeStages(d).forEach(function(s){ existing[s.key] = true; });
        var stageChips = '<div class="dash-stage-chips"><span class="dash-bank-chips-lbl">\u042d\u0442\u0430\u043f\u044b \u0432 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0435 (\u043a\u043b\u0438\u043a \u2014 \u0432\u043a\u043b/\u0432\u044b\u043a\u043b):</span>'
            + STAGE_ORDER.map(function(k){
                var on = !!existing[k];
                var col = STAGE_COLORS[k] || '#48c9b0';
                var isDefault = (k === DASH_STAGE_KEY_DEFAULT);
                var style = on ? ('style="background:' + col + ';border-color:' + col + ';color:#fff"') : '';
                return '<button class="dash-stage-chip' + (on ? ' on' : '') + (isDefault ? ' is-default' : '') + '" type="button" data-toggle-stage="' + escapeHtml(k) + '" data-lane="' + laneIdx + '" ' + style + ' title="' + escapeHtml(stageLabel(k) + (isDefault ? ' (\u0431\u0430\u0437\u043e\u0432\u044b\u0439, \u043d\u0435\u043b\u044c\u0437\u044f \u0432\u044b\u043a\u043b\u044e\u0447\u0438\u0442\u044c)' : '') + ' \u00b7 \u0432\u0435\u0441 ' + stageWeight(k)) + '">' + escapeHtml(stageLabel(k)) + '</button>';
            }).join('')
            + '</div>';

        return bankChips + stageChips;
    }

    function renderGantt(){
        var c = byId('dashGanttContainer');
        if (!c) return;
        stateDash.globalOffset = dashClampGlobalOffset(stateDash.globalOffset || 0);
        var sliderCfg = dashGlobalSliderConfig();
        var sliderHtml = '<div class="dash-global-slider-wrap"><input type="range" id="dashGlobalSlider" class="dash-global-slider" min="' + sliderCfg.min + '" max="' + sliderCfg.max + '" step="1" value="' + (stateDash.globalOffset || 0) + '"></div>';
        var lanesHtml = stateDash.lanes.map(function(l, i){
            var isActive = (i === stateDash.activeLane);
            return renderLaneBlock(l, i, isActive, dashTimeBounds(laneOffset(l)), stateDash.lanes.length > 1, stateDash.lanes.length > 1, !!l.pinned);
        }).join('');
        var addBtn = stateDash.lanes.length < 5 ? '<div class="dash-lanes-foot"><button class="dash-lane-add" type="button" id="dashAddLaneBtn">+ Ось</button></div>' : '';
        c.innerHTML = sliderHtml + lanesHtml + addBtn + renderLeadPicker();
        dashScheduleTicks();
        var addBtnEl = byId('dashAddLaneBtn');
        if (addBtnEl) addBtnEl.addEventListener('click', function(){ if (addLane()) { renderSelector(); syncControls(); renderGantt(); renderLoad(); } });
        c.querySelectorAll('[data-lane-close]').forEach(function(btn){ btn.addEventListener('click', function(e){ e.stopPropagation(); if (removeLane(+this.getAttribute('data-lane-close'))) { renderSelector(); syncControls(); renderGantt(); renderLoad(); } }); });
        c.querySelectorAll('[data-lane-pin]').forEach(function(btn){ btn.addEventListener('click', function(e){ e.stopPropagation(); var i=+this.getAttribute('data-lane-pin'); var lane=stateDash.lanes[i]; if(!lane) return; setLanePinned(i, !lane.pinned); renderGantt(); renderLoad(); }); });
        var gs = byId('dashGlobalSlider');
        if (gs) {
            var updateSliderValueFromEvent = function(ev){
                var rect = gs.getBoundingClientRect();
                if (!rect.width) return;
                var ratio = (ev.clientX - rect.left) / rect.width;
                if (ratio < 0) ratio = 0;
                if (ratio > 1) ratio = 1;
                var min = Number(gs.min || 0);
                var max = Number(gs.max || 0);
                var next = Math.round(min + ratio * (max - min));
                gs.value = String(next);
                stateDash.globalOffset = dashClampGlobalOffset(next);
                renderGantt(); renderLoad(); syncControls();
            };
            gs.addEventListener('input', function(){ stateDash.globalOffset = dashClampGlobalOffset(+this.value || 0); renderGantt(); renderLoad(); syncControls(); });
            gs.addEventListener('pointerdown', function(ev){ gs.classList.add('is-grabbing'); updateSliderValueFromEvent(ev); try { gs.setPointerCapture(ev.pointerId); } catch(_) {} });
            gs.addEventListener('pointermove', function(ev){ if ((ev.buttons & 1) !== 1) return; updateSliderValueFromEvent(ev); });
            var releaseSlider = function(ev){ gs.classList.remove('is-grabbing'); try { if (ev && ev.pointerId != null) gs.releasePointerCapture(ev.pointerId); } catch(_) {} };
            gs.addEventListener('pointerup', releaseSlider);
            gs.addEventListener('pointercancel', releaseSlider);
            gs.addEventListener('lostpointercapture', function(){ gs.classList.remove('is-grabbing'); });
        }
        c.querySelectorAll('[data-lane-block]').forEach(function(el){ el.addEventListener('pointerdown', function(e){ if (e.target.closest('[data-lane-close]') || e.target.closest('[data-lane-pin]')) return; var li = +this.getAttribute('data-lane-block'); if (li !== stateDash.activeLane) { switchLane(li); renderSelector(); syncControls(); renderGantt(); renderLoad(); } }, true); });
        c.querySelectorAll('[data-lane-name]').forEach(function(inp){ inp.addEventListener('change', function(){ var li=+this.getAttribute('data-lane-name'); var L=stateDash.lanes[li]; if (L && L.draft) { L.draft.name = this.value; if (li===stateDash.activeLane){stateDash.draft.name=this.value;} renderSelector(); } }); });
        c.querySelectorAll('[data-lane-start]').forEach(function(inp){ inp.addEventListener('change', function(){ var li=+this.getAttribute('data-lane-start'); var L=stateDash.lanes[li]; if (!L||!L.draft||!this.value) return; L.draft.start_date=this.value; var stg=dashNormalizeStages(L.draft); if(stg.length)stg[0].start=this.value; L.draft.stages=stg; switchLane(li); renderGantt(); renderLoad(); }); });
        c.querySelectorAll('[data-lane-end]').forEach(function(inp){ inp.addEventListener('change', function(){ var li=+this.getAttribute('data-lane-end'); var L=stateDash.lanes[li]; if (!L||!L.draft||!this.value) return; L.draft.deadline=this.value; var stg=dashNormalizeStages(L.draft); if(stg.length)stg[stg.length-1].end=this.value; L.draft.stages=stg; switchLane(li); renderGantt(); renderLoad(); }); });
        c.querySelectorAll('[data-toggle-bank]').forEach(function(btn){
            btn.addEventListener('click', function(){ var li=+this.getAttribute('data-lane'); switchLane(li); if (!stateDash.draft) return; var depId=this.getAttribute('data-toggle-bank'); var cur=(stateDash.draft.department_ids||[]).slice(); var k=cur.indexOf(depId); if (k>=0){ cur.splice(k,1); if(stateDash.draft.lead_department===depId) stateDash.draft.lead_department=cur[0]||''; } else { cur.push(depId); stateDash.draft.department_shares=stateDash.draft.department_shares||{}; if(stateDash.draft.department_shares[depId]==null)stateDash.draft.department_shares[depId]=100; if(!stateDash.draft.lead_department)stateDash.draft.lead_department=depId; } stateDash.draft.department_ids=cur; syncLane(); renderGantt(); renderLoad(); });
        });
        c.querySelectorAll('[data-open-lead-picker]').forEach(function(btn){
            btn.addEventListener('click', function(){
                var li = +this.getAttribute('data-open-lead-picker');
                switchLane(li);
                if (!stateDash.draft) return;
                var cur = (stateDash.draft.department_ids || []).slice();
                if (!cur.length) { notify('Добавьте хотя бы одного участника в проверку', 'error'); return; }
                openLeadPicker(li);
            });
        });
        c.querySelectorAll('[data-pick-lead]').forEach(function(btn){
            btn.addEventListener('click', function(){
                var li = +this.getAttribute('data-lane');
                switchLane(li);
                if (!stateDash.draft) return;
                var depId = this.getAttribute('data-pick-lead') || '';
                var cur = (stateDash.draft.department_ids || []);
                if (cur.indexOf(depId) < 0) { notify('Добавьте хотя бы одного участника в проверку', 'error'); return; }
                stateDash.draft.lead_department = depId;
                closeLeadPicker();
                syncLane(); renderGantt(); renderLoad();
            });
        });
        var leadClose = byId('dashLeadPickerClose');
        if (leadClose) leadClose.addEventListener('click', function(){ closeLeadPicker(); });
        var leadBackdrop = byId('dashLeadPickerBackdrop');
        if (leadBackdrop) leadBackdrop.addEventListener('click', function(e){ if (e.target === this) closeLeadPicker(); });
        c.querySelectorAll('[data-toggle-stage]').forEach(function(btn){
            btn.addEventListener('click', function(){
                var li=+this.getAttribute('data-lane'); switchLane(li);
                if (!stateDash.draft) return;
                var key=this.getAttribute('data-toggle-stage');
                if (key===DASH_STAGE_KEY_DEFAULT){ notify('Этап «Проверка НЖЯ» базовый и всегда активен', 'info'); return; }
                var stg=dashNormalizeStages(stateDash.draft), pos=stg.map(function(x){return x.key;}).indexOf(key);
                if (pos>=0){ stg.splice(pos,1); }
                else {
                    var lastEnd=stateDash.draft.deadline||stateDash.draft.start_date||todayISO(); stg.forEach(function(x){ if((x.end||x.start)>lastEnd) lastEnd=x.end||x.start; });
                    var ns, ne;
                    if (key === 'подготовка') { var ngStg = stg.filter(function(x){ return x.key === DASH_STAGE_KEY_DEFAULT; })[0]; var ngStart = ngStg ? (ngStg.start || stateDash.draft.start_date) : (stateDash.draft.start_date || todayISO()); ne = addDaysISO(ngStart, -1); ns = addDaysISO(ne, -6); }
                    else { ns=addDaysISO(lastEnd,1); ne=addDaysISO(ns,13); }
                    stg.push({key:key,start:ns,end:ne,weight:stageWeight(key)}); if (ne>stateDash.draft.deadline) stateDash.draft.deadline=ne;
                }
                stg.sort(function(a,b){ return STAGE_ORDER.indexOf(a.key) - STAGE_ORDER.indexOf(b.key); });
                for (var k = 1; k < stg.length; k++) { var prev = stg[k-1], cur = stg[k]; if (cur.start <= prev.end) { var curLen = Math.max(1, Math.round((parse(cur.end||cur.start) - parse(cur.start)) / 86400000)); cur.start = addDaysISO(prev.end, 1); cur.end = addDaysISO(cur.start, curLen); } }
                stateDash.draft.stages=stg; syncLane(); renderGantt(); renderLoad();
            });
        });
        c.querySelectorAll('[data-del]').forEach(function(btn){ btn.addEventListener('click', function(e){ e.stopPropagation(); var li=+this.getAttribute('data-lane'); switchLane(li); if (!stateDash.draft) return; var idx=+this.getAttribute('data-del'); var stg=dashNormalizeStages(stateDash.draft); if (stg[idx] && stg[idx].key!==DASH_STAGE_KEY_DEFAULT){ stg.splice(idx,1); stateDash.draft.stages=stg; syncLane(); renderGantt(); renderLoad(); } }); });
        dashAttachDrag(c);
    }


    function renderLeadPicker(){
        var laneIdx = stateDash.leadPickerLane;
        if (laneIdx == null || laneIdx < 0) return '';
        var lane = (stateDash.lanes || [])[laneIdx];
        var draft = lane && lane.draft;
        if (!draft) return '';
        var ids = (draft.department_ids || []).slice();
        if (!ids.length) return '';
        var deps = st().departments || [];
        var buttons = ids.map(function(depId){
            var dep = deps.find ? deps.find(function(x){ return x.id === depId; }) : null;
            var name = dep ? dep.name : depId;
            var active = (draft.lead_department === depId);
            return '<button class="dash-lead-option' + (active ? ' active' : '') + '" type="button" data-pick-lead="' + escapeHtml(depId) + '" data-lane="' + laneIdx + '">' + escapeHtml(name) + '</button>';
        }).join('');
        return '<div class="dash-modal-backdrop" id="dashLeadPickerBackdrop"><div class="dash-modal dash-lead-modal">'
            + '<div class="dash-modal-head"><div class="dash-modal-title">Сменить руководителя</div><button class="dash-modal-close" type="button" id="dashLeadPickerClose">×</button></div>'
            + '<div class="dash-lead-modal-body">' + buttons + '</div>'
            + '</div></div>';
    }

    function openLeadPicker(laneIdx){
        stateDash.leadPickerLane = laneIdx;
        renderGantt();
    }

    function closeLeadPicker(){
        stateDash.leadPickerLane = null;
        renderGantt();
    }

    function renderLoad(){
        var box = byId('dashLoadContainer');
        if (!box) return;
        var allDeps = st().departments || [];
        if (!allDeps.length) {
            box.innerHTML = '<div class="dash-empty">Справочник банков пуст — данные загружаются…</div>';
            return;
        }
        var drafts = dashDraftsForLoad();
        var depMap = {};
        drafts.forEach(function(d){ ((d && d.department_ids) || []).forEach(function(id){ depMap[id] = 1; }); });
        // Раскрыты автоматически банки, которые стоят на осях слева.
        // Ручной выбор (dashBankOpen) сохраняется, пока банк не добавят на ось заново.
        stateDash.dashBankOpen = stateDash.dashBankOpen || {};
        var prevDepMap = stateDash.dashPrevDepMap || {};
        Object.keys(depMap).forEach(function(id){ if (!prevDepMap[id]) delete stateDash.dashBankOpen[id]; });
        stateDash.dashPrevDepMap = depMap;
        function isBankOpen(id){
            var m = stateDash.dashBankOpen[id];
            return (m === true || m === false) ? m : !!depMap[id];
        }
        var shownDeps = allDeps.filter(function(d){ return depMap[d.id]; })
            .concat(allDeps.filter(function(d){ return !depMap[d.id]; }));
        var CH = Math.round(103 * DASH_DENSITY); // compact geometry; labels keep their original font
        var offsets = dashLoadOffsets();
        var slotGroups = offsets.map(function(off){ return { offset: off, slots: dashSlots(off) }; });

        var cards = shownDeps.map(function(dep){
            var depId = dep.id;
            var calcDir = (stateDash.dir === 'corp' || stateDash.dir === 'retail') ? stateDash.dir : 'retail';
            var poss = calcPossible(dep, calcDir);
            var inDraft = !!depMap[depId];
            var open = isBankOpen(depId);
            var lead = false;
            drafts.forEach(function(d){
                if (d && d.lead_department === depId && (d.department_ids || []).indexOf(depId) >= 0) lead = true;
            });
            var head = '<div class="dash-bank-head" data-bank-toggle="' + escapeHtml(depId) + '">'
                + '<button class="dash-bank-toggle" type="button" title="' + (open ? 'Скрыть' : 'Показать') + '" aria-expanded="' + (open ? 'true' : 'false') + '">' + (open ? '▾' : '▸') + '</button>'
                + '<div class="dash-bank-name">' + escapeHtml(dep.name || dep.id) + '</div>'
                + (lead ? '<span class="dash-badge lead">Руководитель</span>' : '')
                + '</div>';
            if (!open) {
                return '<div class="dash-bank-card is-collapsed' + (inDraft ? ' active' : '') + '">' + head + '</div>';
            }
            var vals = [];
            slotGroups.forEach(function(group){
                group.slots.forEach(function(slot){
                    var base = dashBaseLoad(depId, slot);
                    var draft = dashDraftStageLoad(slot.start, slot.end, depId);
                    vals.push({ slot: slot, total: Math.round((base + draft) * 100) / 100, base: base, draft: draft });
                });
            });
            // Верх шкалы = самый высокий столбик или лимит, без запаса сверху.
            var maxVal = vals.reduce(function(m, v){ return Math.max(m, v.total); }, poss || 0);
            if (!(maxVal > 0)) maxVal = 1;
            var today = todayISO();
            var bars = vals.map(function(v){
                var h = v.total > 0 ? Math.min(CH, Math.max(8, Math.round((v.total / maxVal) * CH))) : 3;
                var cls = '';
                if (poss !== null) {
                    if (v.total > poss) cls = ' over';
                    else if (v.total >= poss * 0.8) cls = ' warn';
                }
                var isToday = today >= ymd(v.slot.start) && today <= ymd(v.slot.end);
                var title = escapeHtml((v.slot.label || '') + ': нагрузка ' + fmtNum(v.total)
                    + (v.base ? ' · база ' + fmtNum(v.base) : '')
                    + (v.draft ? ' · черновик +' + fmtNum(v.draft) : '')
                    + (poss !== null ? ' · лимит ' + fmtNum(poss) : ''));
                return '<div class="dash-mini-col' + cls + (isToday ? ' is-today' : '') + '" title="' + title + '">'
                    + '<div class="dash-mini-bar" style="height:' + h + 'px"></div>'
                    + '</div>';
            }).join('');
            var grid = '';
            for (var i = 1; i <= 4; i++) {
                grid += '<div class="dash-grid-line" style="bottom:' + Math.round((i / 5) * CH) + 'px;"></div>';
            }
            if (poss !== null && poss > 0) {
                var possY = Math.round((poss / maxVal) * CH);
                // если над лимитом нет места, подпись ставим под линией
                var lblPos = (possY + 14 > CH) ? ('top:' + (CH - possY + 2) + 'px;') : ('bottom:' + (possY + 2) + 'px;');
                grid += '<div class="dash-limit-zone" style="bottom:' + possY + 'px;"></div>';
                grid += '<div class="dash-limit-line" style="bottom:' + possY + 'px;"></div>';
                grid += '<div class="dash-limit-label" style="' + lblPos + ' right:2px; position:absolute; color:rgba(239, 68, 68, 0.8); font-size:0.65rem; font-weight:600; line-height:1; z-index:3;">' + fmtNum(poss) + '</div>';
            }
            return '<div class="dash-bank-card' + (inDraft ? ' active' : '') + '">'
                + head
                + '<div class="dash-mini-chart-wrap" style="height:' + CH + 'px;">'
                + grid
                + '<div class="dash-mini-chart" style="position:relative; z-index:2; height:' + CH + 'px;">' + bars + '</div>'
                + '</div>'
                + '</div>';
        }).join('');

        box.innerHTML = ''
            + '<div class="dash-load-head">'
                + '<div class="dash-load-title">Нагрузка на ТБ</div>'
            + '</div>'
            + '<div class="dash-bank-grid">' + cards + '</div>';

        box.querySelectorAll('[data-bank-toggle]').forEach(function(el){
            el.onclick = function(ev){
                if (ev) ev.stopPropagation();
                var id = this.getAttribute('data-bank-toggle');
                stateDash.dashBankOpen[id] = !isBankOpen(id);
                renderLoad();
            };
        });

        box.querySelectorAll('[data-act]').forEach(function(btn){
            btn.onclick = function(){
                var depId = this.getAttribute('data-dep');
                var act = this.getAttribute('data-act');
                if (!stateDash.draft) return;
                if (act === 'add') {
                    var cur = (stateDash.draft.department_ids || []).slice();
                    if (cur.indexOf(depId) < 0) cur.push(depId);
                    stateDash.draft.department_ids = cur;
                    stateDash.draft.department_shares = stateDash.draft.department_shares || {};
                    if (stateDash.draft.department_shares[depId] == null) stateDash.draft.department_shares[depId] = 100;
                    if (!stateDash.draft.lead_department) stateDash.draft.lead_department = depId;
                } else if (act === 'remove') {
                    stateDash.draft.department_ids = (stateDash.draft.department_ids || []).filter(function(id){ return id !== depId; });
                    if (stateDash.draft.lead_department === depId) {
                        stateDash.draft.lead_department = stateDash.draft.department_ids[0] || '';
                    }
                } else if (act === 'lead') {
                    stateDash.draft.lead_department = (stateDash.draft.lead_department === depId) ? '' : depId;
                } else if (act === 'share') {
                    var curVal = (stateDash.draft.department_shares && stateDash.draft.department_shares[depId] != null)
                        ? stateDash.draft.department_shares[depId] : 100;
                    var val = window.prompt('Доля участия банка, %', String(curVal));
                    if (val === null) return;
                    var n = Number(String(val).replace(',', '.'));
                    if (!isFinite(n) || n <= 0) { notify('Введите число больше 0', 'error'); return; }
                    stateDash.draft.department_shares = stateDash.draft.department_shares || {};
                    stateDash.draft.department_shares[depId] = Math.round(n * 100) / 100;
                }
                renderGantt();
                renderLoad();
            };
        });
    }

    /* ===== Сохранение песочницы: все оси, сводка изменений, подтверждение (09.11.2026) ===== */
    function dashFmtD(iso){
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
        return m ? (m[3] + '.' + m[2] + '.' + m[1]) : '—';
    }
    function dashDepName(id){ var d = deptById(id); return d ? (d.name || id) : (id || '—'); }
    function dashStageMap(stages){
        var out = {};
        if (Array.isArray(stages)) {
            stages.forEach(function(x){ if (x && x.key && x.start) out[x.key] = x.start; });
        } else if (stages && typeof stages === 'object') {
            Object.keys(stages).forEach(function(k){ if (stages[k]) out[k] = stages[k]; });
        }
        return out;
    }
    function dashBuildPayload(d, orig){
        var base = orig ? clone(orig) : {};
        var normStages = dashNormalizeStages(d);
        var stageStarts = {};
        var prevDate = '';
        normStages.forEach(function(s){
            if (!s.key || !s.start) return;
            var dt = s.start;
            if (prevDate && dt <= prevDate) dt = addDaysISO(prevDate, 1);
            stageStarts[s.key] = dt;
            prevDate = dt;
        });
        var isNew = !(d.id || base.id);
        var leadDep = d.lead_department;
        if (!leadDep || (d.department_ids || []).indexOf(leadDep) < 0) leadDep = (d.department_ids || [])[0] || '';
        return {
            id: d.id || (base.id || ''),
            name: (d.name || '').trim(),
            icon: base.icon || '📋',
            description: base.description || '',
            // Новая проверка из песочницы всегда создаётся в статусе «Планирование»
            status: isNew ? 'planning' : (base.status || 'planning'),
            start_date: d.start_date || todayISO(),
            deadline: d.deadline || addDaysISO(d.start_date || todayISO(), 90),
            completed_at: base.completed_at || '',
            folder: base.folder || '',
            order_ref: base.order_ref || '',
            tags: (base.tags || []).slice(),
            assignees: (base.assignees || base.assignee_ids || []).slice(),
            department_ids: (d.department_ids || []).slice(),
            task_kind: 'audit',
            load_coef: base.load_coef || 0,
            lead_department: leadDep,
            lead_employee: base.lead_employee || '',
            is_urgent: !!base.is_urgent,
            links: (base.links || []).slice(),
            orders: (base.orders || []).slice(),
            task_type: d.task_type || base.task_type || (stateDash.dir !== 'all' ? dirTaskType(stateDash.dir) : 'розничная'),
            pocket: (d.pocket !== undefined && d.pocket !== null && d.pocket !== '') ? d.pocket : (base.pocket || ''),
            curator: isNew ? (d.curator || 'нет') : (base.curator || d.curator || ''),
            department_shares: clone(d.department_shares || {}),
            stages: stageStarts,
            force_duplicate: true
        };
    }
    function dashDiffLines(orig, p){
        var L = [];
        if (!orig) {
            L.push('статус: Планирование');
            L.push('сроки: ' + dashFmtD(p.start_date) + ' → ' + dashFmtD(p.deadline));
            if (p.task_type) L.push('направление: ' + p.task_type);
            if (p.pocket) L.push('карман: ' + p.pocket);
            L.push('банки: ' + (p.department_ids.map(dashDepName).join(', ') || '—'));
            if (p.lead_department) L.push('банк-руководитель: ' + dashDepName(p.lead_department));
            var ks = STAGE_ORDER.filter(function(k){ return p.stages[k]; });
            if (ks.length) L.push('этапы: ' + ks.map(function(k){ return stageLabel(k) + ' с ' + dashFmtD(p.stages[k]); }).join('; '));
            return L;
        }
        if ((orig.name || '') !== p.name) L.push('название: «' + (orig.name || '—') + '» → «' + p.name + '»');
        if ((orig.start_date || '') !== p.start_date) L.push('дата начала: ' + dashFmtD(orig.start_date) + ' → ' + dashFmtD(p.start_date));
        if ((orig.deadline || '') !== p.deadline) L.push('дедлайн: ' + dashFmtD(orig.deadline) + ' → ' + dashFmtD(p.deadline));
        var os = dashStageMap(orig.stages), ns = p.stages;
        var origHasStages = Object.keys(os).length > 0;
        STAGE_ORDER.concat(Object.keys(ns).filter(function(k){ return STAGE_ORDER.indexOf(k) < 0; })).forEach(function(k){
            var a = os[k] || '', b = ns[k] || '';
            if (a === b) return;
            // Этап по умолчанию, который песочница подставляет проверке без этапов, — не изменение
            if (!origHasStages && !a && k === DASH_STAGE_KEY_DEFAULT && b === p.start_date) return;
            if (!a) L.push('добавлен этап «' + stageLabel(k) + '» с ' + dashFmtD(b));
            else if (!b) L.push('убран этап «' + stageLabel(k) + '»');
            else L.push('этап «' + stageLabel(k) + '»: начало ' + dashFmtD(a) + ' → ' + dashFmtD(b));
        });
        var od = Array.isArray(orig.department_ids) ? orig.department_ids : [];
        p.department_ids.filter(function(x){ return od.indexOf(x) < 0; }).forEach(function(x){ L.push('добавлен банк «' + dashDepName(x) + '»'); });
        od.filter(function(x){ return p.department_ids.indexOf(x) < 0; }).forEach(function(x){ L.push('убран банк «' + dashDepName(x) + '»'); });
        if ((orig.lead_department || '') !== p.lead_department) {
            L.push('банк-руководитель: ' + (orig.lead_department ? '«' + dashDepName(orig.lead_department) + '»' : 'не указан') + ' → ' + (p.lead_department ? '«' + dashDepName(p.lead_department) + '»' : 'не указан'));
        }
        var osh = orig.department_shares || {};
        p.department_ids.filter(function(x){ return od.indexOf(x) >= 0; }).forEach(function(x){
            var a = (osh[x] == null || osh[x] === '') ? 100 : Number(osh[x]);
            var b = (p.department_shares[x] == null || p.department_shares[x] === '') ? 100 : Number(p.department_shares[x]);
            if (a !== b) L.push('доля банка «' + dashDepName(x) + '»: ' + fmtNum(a) + '% → ' + fmtNum(b) + '%');
        });
        if ((orig.task_type || '') !== (p.task_type || '')) L.push('направление: ' + (orig.task_type || '—') + ' → ' + (p.task_type || '—'));
        if ((orig.pocket || '') !== (p.pocket || '')) L.push('карман: ' + (orig.pocket || '—') + ' → ' + (p.pocket || '—'));
        if ((orig.curator || '') !== (p.curator || '')) L.push('куратор ЦА: ' + (orig.curator || '—') + ' → ' + (p.curator || '—'));
        return L;
    }
    function dashCollectChanges(){
        syncLane();
        var lanes = (Array.isArray(stateDash.lanes) && stateDash.lanes.length) ? stateDash.lanes : [{ task: stateDash.task, draft: stateDash.draft }];
        var items = [], errors = [], seen = {};
        lanes.forEach(function(l, li){
            if (!l || !l.draft) return;
            var d = l.draft;
            if (d.id) { if (seen[d.id]) return; seen[d.id] = 1; }
            var axis = 'Ось ' + (li + 1);
            if (!(d.name || '').trim()) { errors.push(axis + ': не указано название проверки'); return; }
            if (!(d.department_ids || []).length) { errors.push(axis + ' («' + d.name + '»): добавьте хотя бы один банк-участник'); return; }
            var tid = d.id || (l.task && l.task.id) || '';
            var orig = tid ? ((st().tasks || []).find(function(t){ return t.id === tid; }) || null) : null;
            var p = dashBuildPayload(d, orig);
            var lines = dashDiffLines(orig, p);
            if (orig && !lines.length) return;
            items.push({ lane: li, isNew: !orig, name: p.name, payload: p, lines: lines });
        });
        return { items: items, errors: errors };
    }
    function dashCloseSaveConfirm(){
        var ov = byId('dashSaveConfirm');
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        document.removeEventListener('keydown', dashSaveConfirmEsc);
    }
    function dashSaveConfirmEsc(e){ if (e.key === 'Escape') dashCloseSaveConfirm(); }
    function dashOpenSaveConfirm(items, onYes){
        dashCloseSaveConfirm();
        var html = items.map(function(it){
            var head = it.isNew
                ? 'Создаётся проверка «' + escapeHtml(it.name) + '»'
                : 'В проверке «' + escapeHtml(it.name) + '» изменится:';
            return '<div class="dash-sc-item' + (it.isNew ? ' dash-sc-item--new' : '') + '">'
                + '<div class="dash-sc-head">' + (it.isNew ? '✨ ' : '✏️ ') + head + '</div>'
                + '<ul class="dash-sc-list">' + it.lines.map(function(x){ return '<li>' + escapeHtml(x) + '</li>'; }).join('') + '</ul>'
                + '</div>';
        }).join('');
        var ov = document.createElement('div');
        ov.id = 'dashSaveConfirm';
        ov.className = 'tsum-confirm-overlay active dash-sc-overlay';
        ov.innerHTML = '<div class="tsum-confirm dash-sc" role="dialog" aria-modal="true">'
            + '<div class="dash-sc-title">Изменения в песочнице планирования</div>'
            + '<div class="dash-sc-body">' + html + '</div>'
            + '<p class="tsum-confirm-text dash-sc-ask">Уверены, что хотите внести данные изменения?</p>'
            + '<div class="tsum-confirm-actions">'
            +   '<button type="button" class="tsum-cbtn tsum-cbtn--no" id="dashScNo">Нет</button>'
            +   '<button type="button" class="tsum-cbtn tsum-cbtn--yes" id="dashScYes">Да</button>'
            + '</div></div>';
        document.body.appendChild(ov);
        ov.addEventListener('mousedown', function(e){ if (e.target === ov) dashCloseSaveConfirm(); });
        byId('dashScNo').addEventListener('click', dashCloseSaveConfirm);
        byId('dashScYes').addEventListener('click', function(){ dashCloseSaveConfirm(); onYes(); });
        document.addEventListener('keydown', dashSaveConfirmEsc);
        setTimeout(function(){ var y = byId('dashScYes'); if (y) y.focus(); }, 30);
    }
    function dashRunSave(items){
        var btn = byId('dashSaveBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Сохранение…'; }
        var saved = [], failed = null;
        var chain = Promise.resolve();
        items.forEach(function(it){
            chain = chain.then(function(){
                if (failed) return;
                return apiJson('/api/tracker/task/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(it.payload)
                }).then(function(r){
                    if (!r || !r.success) throw new Error((r && (r.message || r.error)) || 'Ошибка сохранения');
                    saved.push({ lane: it.lane, id: r.id || it.payload.id });
                }).catch(function(err){
                    failed = '«' + it.name + '»: ' + ((err && err.message) || 'Ошибка сохранения');
                });
            });
        });
        return chain.then(function(){
            if (!saved.length) return;
            var refreshFn = window.__trkRefreshAll || window.__trkLoadState;
            return (typeof refreshFn === 'function' ? Promise.resolve(refreshFn()) : Promise.resolve()).then(function(){
                var keep = stateDash.activeLane;
                saved.forEach(function(sv){
                    var nt = (st().tasks || []).find(function(t){ return t.id === sv.id; });
                    var l = stateDash.lanes[sv.lane];
                    if (nt && l) { l.task = nt; l.draft = dashBuildDraft(nt); }
                });
                switchLane(Math.min(keep, stateDash.lanes.length - 1));
                syncControls(); renderSelector(); renderGantt(); renderLoad();
            });
        }).then(function(){
            if (failed) {
                notify('❌ ' + failed + (saved.length ? ' (сохранено до ошибки: ' + saved.length + ')' : ''), 'error');
            } else if (window.trkShowCenterMsg) {
                window.trkShowCenterMsg('✅ Изменения сохранены (' + saved.length + ')');
            } else {
                notify('✅ Изменения сохранены (' + saved.length + ')', 'success');
            }
        }).catch(function(err){
            notify('❌ ' + ((err && err.message) || 'Ошибка обновления данных'), 'error');
        }).then(function(){
            var b2 = byId('dashSaveBtn');
            if (b2) { b2.disabled = false; b2.textContent = 'Сохранить изменения'; }
        });
    }
    function saveDraft(){
        var res = dashCollectChanges();
        if (res.errors.length) { notify(res.errors.join('; '), 'error'); return; }
        if (!res.items.length) {
            var anyDraft = (stateDash.lanes || []).some(function(l){ return l && l.draft; }) || !!stateDash.draft;
            notify(anyDraft ? 'Изменений нет' : 'Сначала выберите проверку или нажмите «+ Создать проверку»', anyDraft ? 'info' : 'error');
            return;
        }
        if (!(window.__trkState && window.__trkState.currentUser && window.__trkState.currentUser.role === 'admin')) { notify('Сохранение доступно только администратору', 'error'); return; }
        var _rd = [];
        res.items.forEach(function(it){
            var tid = it.payload && it.payload.id;
            var orig = tid ? ((st().tasks || []).find(function(t){ return t.id === tid; }) || {}) : {};
            _rd = _rd.concat(window.trkChangedDates ? window.trkChangedDates(orig, it.payload) : []);
        });
        if (window.trkRetroConfirm && !window.trkRetroConfirm(_rd)) return;
        dashOpenSaveConfirm(res.items, function(){ dashRunSave(res.items); });
    }
    window.__dashCollectChanges = dashCollectChanges;

    function bindControls(){
        var btn = byId('tabDashboardsBtn');
        if (btn && !btn.__dashBound) {
            btn.__dashBound = true;
            btn.addEventListener('click', function(e){
                e.preventDefault();
                activateDashboardsTab();
            });
        }
        var sel = byId('dashTaskSelector');
        if (sel && !sel.__dashBound) {
            sel.__dashBound = true;
            sel.addEventListener('focus', function(){ renderSelector(); });
            sel.addEventListener('change', function(){
                var tid = this.value;
                if (!tid) { loadDraft(null); return; }
                if (tid === '__new__') return;
                var task = (st().tasks || []).find(function(x){ return x.id === tid; });
                loadDraft(task || null);
            });
        }
        var createBtn = byId('dashCreateTaskBtn');
        if (createBtn && !createBtn.__dashBound) {
            createBtn.__dashBound = true;
            createBtn.addEventListener('click', function(e){
                e.preventDefault();
                dashOpenCreateModal();
            });
        }
        var dirBox = byId('dashDirSwitch');
        if (dirBox && !dirBox.__dashBound) {
            dirBox.__dashBound = true;
            dirBox.addEventListener('click', function(e){
                var b = e.target && e.target.closest ? e.target.closest('[data-dir]') : null;
                if (!b) return;
                stateDash.dir = b.getAttribute('data-dir') || 'all';
                // Сброс выбранной проверки, если её направление не совпадает с фильтром
                if (stateDash.task && !dashDirMatch(stateDash.task)) {
                    stateDash.task = null; stateDash.draft = null;
                    var l = stateDash.lanes[stateDash.activeLane]; if (l) { l.task = null; l.draft = null; }
                }
                // task_type драфта подстраиваем только для конкретного направления
                if (stateDash.draft && stateDash.dir !== 'all') stateDash.draft.task_type = dirTaskType(stateDash.dir);
                syncControls();
                renderSelector();
                renderGantt();
                renderLoad();
            });
        }
        var modeBox = byId('dashModeSwitch');
        if (modeBox && !modeBox.__dashBound) {
            modeBox.__dashBound = true;
            modeBox.addEventListener('click', function(e){
                var b = e.target && e.target.closest ? e.target.closest('[data-mode]') : null;
                if (!b) return;
                stateDash.mode = b.getAttribute('data-mode') || 'medium';
                stateDash.globalOffset = dashClampGlobalOffset(stateDash.globalOffset || 0);
                syncControls();
                renderGantt();
                renderLoad();
            });
        }
        var slider = byId('dashTodaySlider');
        if (slider && !slider.__dashBound) {
            slider.__dashBound = true;
            slider.addEventListener('input', function(){
                stateDash.todayOffset = +this.value || 0;
                syncControls();
                renderGantt();
                renderLoad();
            });
        }
        var saveBtn = byId('dashSaveBtn');
        if (saveBtn && !saveBtn.__dashBound) {
            saveBtn.__dashBound = true;
            saveBtn.addEventListener('click', function(e){
                e.preventDefault();
                saveDraft();
            });
        }
    }

    var _waitCount = 0;
    function waitStateAndRefresh(){
        var hasData = (st().tasks && st().tasks.length) || (st().departments && st().departments.length);
        if (hasData) {
            renderSelector();
            syncControls();
            renderDashboardsLayout();
            renderGantt();
            renderLoad();
            return;
        }
        if (_waitCount++ < 35) {
            setTimeout(waitStateAndRefresh, 300);
        }
    }

    function renderDashboardsLayout(){
        var panel = byId('panel-dashboards');
        if (!panel) return;
        var toolbar = byId('dashToolbar') || panel.querySelector('.dash-toolbar');
        var selector = byId('dashSelectorRow') || panel.querySelector('.dash-topbar');
        var gantt = byId('dashGanttContainer');
        var load = byId('dashLoadContainer');
        if (!gantt || !load) return;

        var split = panel.querySelector('.dash-split-wrap');
        if (!split) return;

        var mainPane = split.querySelector('.dash-main-pane');
        var sidePane = split.querySelector('.dash-side-pane');
        if (!mainPane || !sidePane) return;

        if (toolbar && toolbar.parentNode !== mainPane) {
            mainPane.insertBefore(toolbar, mainPane.firstChild || null);
        }
        if (selector && selector.parentNode !== mainPane) {
            if (toolbar && toolbar.parentNode === mainPane) {
                mainPane.insertBefore(selector, toolbar.nextSibling || null);
            } else {
                mainPane.insertBefore(selector, mainPane.firstChild || null);
            }
        }
        if (gantt.parentNode !== mainPane) mainPane.appendChild(gantt);
        if (load.parentNode !== sidePane) sidePane.appendChild(load);
    }

    function boot(){
        var main = document.querySelector('#panel-dashboards .dash-main-pane');
        if (main && window.ResizeObserver) new ResizeObserver(dashScheduleTicks).observe(main);
        window.addEventListener('resize', dashScheduleTicks);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(dashScheduleTicks);
        ensureDashboardsTab();
        bindControls();
        renderSelector();
        syncControls();
        renderDashboardsLayout();
        renderGantt();
        renderLoad();
        waitStateAndRefresh();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    document.addEventListener('click', function(e){
        if (e.target && e.target.closest && e.target.closest('.tracker-tab[data-tab="dashboards"]')) {
            setTimeout(function(){
                bindControls();
                renderSelector();
                syncControls();
                renderDashboardsLayout();
                renderGantt();
                renderLoad();
            }, 40);
        }
    });
})();


/* =========================================================================
   PATCH PLAN2027 (Песочница планирования)
   ========================================================================= */
(function(){
    'use strict';
    if (window.__trkPlan2027DuplicateV1) return;
    window.__trkPlan2027DuplicateV1 = true;

    var stateDash = { task:null, mode:'year', dir:'all', draft:null, lanes:[{task:null,draft:null,offset:0,pinned:false}], activeLane:0, globalOffset:0, leadPickerLane:null, selectedPocketKey:'', p27PocketFilterKey:'', p27ClosedTaskIds:new Set() };
    var MODE_MONTHS = { year:12, small:12, medium:6, large:3 };
    var P27_YEAR = 2027;
    var P27_MON = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
    // Сезоны = кварталы плана: зима (дек–фев) 1 кв, весна 2 кв, лето 3 кв, осень (сен–ноя) 4 кв
    var P27_SEASONS = {
        winter:{ ico:'❄', name:'Зима', q:'1 кв', mon:'дек–фев', rgb:'96,165,250' },
        spring:{ ico:'🌱', name:'Весна', q:'2 кв', mon:'мар–май', rgb:'74,222,128' },
        summer:{ ico:'☀', name:'Лето', q:'3 кв', mon:'июн–авг', rgb:'250,204,21' },
        autumn:{ ico:'🍂', name:'Осень', q:'4 кв', mon:'сен–ноя', rgb:'251,146,60' }
    };
    function p27SeasonOf(m){ return (m === 11 || m <= 1) ? 'winter' : (m <= 4 ? 'spring' : (m <= 7 ? 'summer' : 'autumn')); }
    function p27Short(dep){
        var s = dep ? String(dep.short_name || '').trim() : '';
        return (s && /[A-Za-zА-Яа-яЁё]/.test(s)) ? s : (dep ? (dep.name || dep.id) : '');
    }
    // Compact geometry preserves the original fonts; use native browser zoom.
    var DASH_DENSITY = 0.6;
    // Measure actual rendered labels, not an assumed number of pixels per day.
    function plan2027FitTicks(){
        document.querySelectorAll('#plan2027GanttContainer .dash-tl-axis').forEach(function(axis){
            var right = -Infinity;
            axis.querySelectorAll('.dash-tl-tick, .p27-mlab').forEach(function(tick){
                tick.style.visibility = '';
                var r = tick.getBoundingClientRect();
                if (r.left < right + 8) tick.style.visibility = 'hidden';
                else right = r.right;
            });
        });
    }
    // Labels that do not fit their bar: try the short form, otherwise hide (the full text stays in the tooltip).
    function plan2027FitLabels(){
        document.querySelectorAll('#plan2027GanttContainer .dash-seg-lab, #plan2027GanttContainer .p27-carry-lab').forEach(function(lab){
            if (lab.dataset.p27Full == null) lab.dataset.p27Full = lab.textContent;
            lab.textContent = lab.dataset.p27Full; lab.style.visibility = '';
            if (lab.scrollWidth <= lab.clientWidth + 1) return;
            var sh = lab.dataset.p27Short;
            if (sh) { lab.textContent = sh; if (lab.scrollWidth <= lab.clientWidth + 1) return; }
            lab.style.visibility = 'hidden';
        });
    }
    function plan2027ScheduleTicks(){ window.requestAnimationFrame(function(){ plan2027FitTicks(); plan2027FitLabels(); }); }


    // A pocket is identified by BOTH direction and name, never by its name alone.
    function p27PocketKey(dir, name){ return dir + '|' + String(name || '').trim(); }
    function p27DraftKey(d){ return d ? p27PocketKey(plan2027TaskDir(d) || 'other', d.pocket) : ''; }
    var P27_YEAR_START = P27_YEAR + '-01-01';
    function p27DraftStart(d){ var b=d?plan2027LoadAuditBounds(d):null; return b?b.start:String((d&&d.start_date)||'').slice(0,10); }
    // Audits started before 2027 that still run in 2027: read-only start-of-year load, never counted in the 2027 plan.
    function p27CarryTasks(loaded){
        var out=[];
        (st().tasks||[]).forEach(function(t){
            if(!t||(t.task_kind||'audit')!=='audit'||t.status==='cancelled'||t.status==='archived')return;
            if(loaded.has(String(t.id))||!t.start_date||String(t.start_date).slice(0,10)>=P27_YEAR_START)return;
            var d=plan2027BuildDraft(t), b=plan2027LoadAuditBounds(d);
            if(!b)return;
            var dl=String(t.deadline||'').slice(0,10), end=dl>b.end?dl:b.end;
            if(end<P27_YEAR_START)return;
            var dir=plan2027TaskDir(d)||'other', name=String(d.pocket||'').trim();
            out.push({id:String(t.id),task:t,draft:d,dir:dir,name:name,key:p27PocketKey(dir,name),start:b.start,end:end});
        });
        return out.sort(function(x,y){return x.end<y.end?-1:x.end>y.end?1:0;});
    }
    function p27PlanGroups(){
        var groups = new Map();
        function group(key, dir, name, plan){
            if (!groups.has(key)) groups.set(key,{key:key,dir:dir,name:name,plan:0,indices:[],remaining:0,countable:0,carry:[],is2027:false});
            var g=groups.get(key); if(plan!=null) g.plan=Math.max(g.plan,Math.max(0,Number(plan)||0)); return g;
        }
        (stateDash.p27Pockets || []).forEach(function(p){
            if (!p.is_active || (p.year!=null && String(p.year)!==String(P27_YEAR))) return;
            var dir=plan2027TaskDir({task_type:p.direction})||'other';
            group(p27PocketKey(dir,p.name),dir,String(p.name||'').trim(),p.plan_count).is2027=true;
        });
        var loaded = new Set();
        stateDash.lanes.forEach(function(l){ if(l.draft && l.draft.id) loaded.add(String(l.draft.id)); });
        (st().tasks||[]).forEach(function(d){
            if ((d.task_kind||'audit')!=='audit' || String(d.start_date||'').slice(0,4)!==String(P27_YEAR) || d.status==='cancelled' || d.status==='archived' || loaded.has(String(d.id)) || stateDash.p27ClosedTaskIds.has(String(d.id))) return;
            stateDash.lanes.push({task:d,draft:plan2027BuildDraft(d),offset:0,pinned:false}); loaded.add(String(d.id));
        });
        var carries=p27CarryTasks(loaded), carryIds=new Set(carries.map(function(c){return c.id;}));
        stateDash.lanes.forEach(function(l,i){
            l.p27Carry=null;
            if(l.p27CarryId&&!carryIds.has(l.p27CarryId))delete l.p27CarryId;
            if(!l.draft)return;
            var dir=plan2027TaskDir(l.draft)||'other', name=String(l.draft.pocket||'').trim();
            var g=group(p27PocketKey(dir,name),dir,name,null); g.indices.push(i);
            if(p27DraftStart(l.draft)>=P27_YEAR_START) g.countable++;
        });
        carries.forEach(function(c){ group(c.key,c.dir,c.name,null).carry.push(c); });
        // Reuse empty planned slots, so rendering never discards or duplicates a draft.
        // A carry-over audit stays on its axis; a 2027 audit may follow it on the same axis.
        groups.forEach(function(g){
            var lanes=stateDash.lanes, needed=Math.max(0,g.plan-g.countable);
            g.remaining=needed;
            var empties=[];lanes.forEach(function(l,i){if(!l.draft&&l.p27GroupKey===g.key)empties.push(i);});
            var hosts=g.indices.concat(empties);
            function free(i){ return !lanes[i].p27Carry; }
            g.carry.forEach(function(c){
                var host=-1;
                hosts.forEach(function(i){ if(host<0&&free(i)&&lanes[i].p27CarryId===c.id) host=i; });
                if(host<0) g.indices.forEach(function(i){ if(host<0&&free(i)&&!lanes[i].p27CarryId&&p27DraftStart(lanes[i].draft)>c.end) host=i; });
                if(host<0) empties.forEach(function(i){ if(host<0&&free(i)&&!lanes[i].p27CarryId) host=i; });
                if(host<0){ host=lanes.length; lanes.push({task:null,draft:null,offset:0,pinned:false,p27GroupKey:g.key}); empties.push(host); }
                lanes[host].p27Carry=c; lanes[host].p27CarryId=c.id;
            });
            var withCarry=empties.filter(function(i){return !free(i);}), plain=empties.filter(free);
            var extra=Math.max(0,needed-withCarry.length);
            while(plain.length<extra){plain.push(lanes.length);lanes.push({task:null,draft:null,offset:0,pinned:false,p27GroupKey:g.key});}
            g.indices=g.indices.concat(withCarry.concat(plain.slice(0,extra)).sort(function(x,y){return x-y;}));
            g.indices.forEach(function(i){lanes[i].p27Remaining=needed;});
        });
        stateDash.p27Groups=groups;
        return groups;
    }
    // Default: every pocket is collapsed except the active one (selected pocket / filter); manual opens persist.
    function p27PocketOpen(key){
        var o=stateDash.p27Open||{};
        return o[key]===true || key===stateDash.p27PocketFilterKey || (o[key]!==false && !!key && key===stateDash.selectedPocketKey);
    }
    // Audits visible in a pocket: 2027 drafts on its axes plus carry-over audits from 2026.
    function p27GroupCount(g){ return g.indices.filter(function(i){ return stateDash.lanes[i] && !!stateDash.lanes[i].draft; }).length + g.carry.length; }
    var P27_SORTS = {
        dir:null,
        name_asc:function(a,b){ return a.name.localeCompare(b.name,'ru'); },
        name_desc:function(a,b){ return b.name.localeCompare(a.name,'ru'); },
        count_desc:function(a,b){ return p27GroupCount(b)-p27GroupCount(a); },
        count_asc:function(a,b){ return p27GroupCount(a)-p27GroupCount(b); },
        remaining_desc:function(a,b){ return (b.remaining||0)-(a.remaining||0); },
        plan_desc:function(a,b){ return (b.plan||0)-(a.plan||0); },
        carry_desc:function(a,b){ return b.carry.length-a.carry.length; }
    };
    function p27SortMode(){ return P27_SORTS.hasOwnProperty(stateDash.p27Sort) ? stateDash.p27Sort : 'dir'; }
    var P27_DIR_ORDER = { corp:0, retail:1, other:2 };
    // «Без кармана» is always last; ties keep direction order, then the original order.
    function p27SortGroups(gs, mode){
        var cmp = P27_SORTS[mode || 'dir'];
        return gs.map(function(g,i){return [g,i];}).sort(function(x,y){
            return ((x[0].name?0:1)-(y[0].name?0:1)) || (cmp ? cmp(x[0],y[0]) : 0)
                || ((P27_DIR_ORDER[x[0].dir]||0)-(P27_DIR_ORDER[y[0].dir]||0)) || (x[1]-y[1]);
        }).map(function(x){return x[0];});
    }
    function p27PocketSummary(g){
        var audits=g.indices.filter(function(i){return !!stateDash.lanes[i].draft;}).length;
        var meta=[];
        if(!g.name) meta.push('проверок: '+(audits+g.carry.length));
        if(g.carry.length) meta.push('↪ из 2026: '+g.carry.length);
        if(g.name&&!g.is2027) meta.push('нет в плане 2027');
        var tip=g.name?('План 2027: '+g.plan+' · начато в 2027: '+g.countable+(g.carry.length?' · переходящих из 2026: '+g.carry.length+' (в план не входят)':'')):'Проверки без кармана';
        var dirTag = p27SortMode()!=='dir' ? '<span class="p27-pocket-dir p27-dir-'+g.dir+'">'+escapeHtml(g.dir==='corp'?'Корп':g.dir==='retail'?'Розн':'—')+'</span>' : '';
        meta.unshift('проверок: '+p27GroupCount(g)); if(!g.name) meta.splice(1,1);
        return {tip:tip, html:dirTag+'<span class="p27-pocket-name">'+escapeHtml(g.name||'Без кармана')+'</span>'+(g.name?'<span class="p27-pocket-count">('+g.plan+')</span>':'')+(meta.length?'<span class="p27-pocket-meta">'+escapeHtml(meta.join(' · '))+'</span>':'')};
    }
    function p27PocketFilter(){
        var sel=byId('plan2027PocketSelector');if(!sel)return;
        var opts='<option value="">Все карманы</option>';
        ['corp','retail','other'].forEach(function(dir){
            if(stateDash.dir!=='all'&&dir!==stateDash.dir)return;
            var gs=p27SortGroups(Array.from((stateDash.p27Groups||new Map()).values()).filter(function(g){return g.dir===dir;}));
            if(!gs.length)return;
            opts+='<optgroup label="'+escapeHtml(DASH_DIR_LABEL[dir]||'Без направления')+'">';
            gs.forEach(function(g){opts+='<option value="'+escapeHtml(g.key)+'">'+escapeHtml(g.name||'Без кармана')+(g.name?' ('+g.plan+')':'')+'</option>';});opts+='</optgroup>';
        });
        sel.innerHTML=opts;sel.value=stateDash.p27PocketFilterKey||'';
        if(sel.value!==(stateDash.p27PocketFilterKey||'')){stateDash.p27PocketFilterKey='';sel.value='';}
    }
    function p27FetchPockets(){
        if(stateDash.p27PocketRequest)return stateDash.p27PocketRequest;
        stateDash.p27PocketRequest=apiJson('/api/plugins/pockets/data?year='+P27_YEAR).then(function(r){
            if(!r||!r.success)throw new Error((r&&(r.error||r.message))||'Не удалось загрузить карманы');
            stateDash.p27Pockets=r.pockets||[];stateDash.p27PocketError='';renderGantt();renderLoad();
        }).catch(function(e){stateDash.p27PocketError=e.message;renderGantt();}).then(function(){stateDash.p27PocketRequest=null;});
        return stateDash.p27PocketRequest;
    }
    function p27GroupedLanes(){
        var groups=p27PlanGroups();p27PocketFilter();var html='';var used=new Set();
        var mode=p27SortMode();
        // «По направлению»: direction → pocket. Other sorts: one flat list across the visible directions.
        var sections=mode==='dir'?['corp','retail','other']:['all'];
        sections.forEach(function(dir){
            if(dir!=='all'&&stateDash.dir!=='all'&&stateDash.dir!==dir)return;
            var gs=p27SortGroups(Array.from(groups.values()).filter(function(g){return (dir==='all'?(stateDash.dir==='all'||g.dir===stateDash.dir):g.dir===dir)&&(!stateDash.p27PocketFilterKey||g.key===stateDash.p27PocketFilterKey);}),mode);
            if(!gs.length)return;
            var sel=byId('plan2027SortSelector'), sortName=sel&&sel.selectedOptions[0]?sel.selectedOptions[0].textContent:'';
            html+='<section class="p27-direction" data-p27-direction="'+dir+'"><h3>'+(dir==='all'?escapeHtml('Все карманы · '+sortName):(dir==='corp'?'🏢 ':dir==='retail'?'👥 ':'')+escapeHtml(DASH_DIR_LABEL[dir]||'Без направления'))+'</h3>';
            gs.forEach(function(g){
                var sm=p27PocketSummary(g);
                html+='<details class="p27-pocket-group'+(g.name?'':' p27-no-pocket')+'" data-p27-pocket="'+escapeHtml(g.key)+'"'+(p27PocketOpen(g.key)?' open':'')+'><summary data-p27-select-pocket="'+escapeHtml(g.key)+'" title="'+escapeHtml(sm.tip)+'">'+sm.html+'</summary>';
                if(!g.indices.length)html+='<div class="p27-pocket-empty">План проверок не задан</div>';
                g.indices.forEach(function(i){used.add(i);var l=stateDash.lanes[i];html+=renderLaneBlock(l,i,i===stateDash.activeLane,plan2027TimeBounds(laneOffset(l)),!!l.draft,stateDash.lanes.length>1,!!l.pinned);});
                html+='</details>';
            });html+='</section>';
        });
        // Unassigned manual axes remain available, but obsolete planned placeholders stay hidden.
        stateDash.lanes.forEach(function(l,i){
            if(used.has(i)||l.draft||l.p27GroupKey||stateDash.p27PocketFilterKey)return;
            if(groups.size&&i===0&&stateDash.lanes.length>1)return;
            html+=renderLaneBlock(l,i,i===stateDash.activeLane,plan2027TimeBounds(laneOffset(l)),stateDash.lanes.length>1,stateDash.lanes.length>1,!!l.pinned);
        });
        return html;
    }

    function syncLane(){ var l=stateDash.lanes[stateDash.activeLane]; if(l){ l.task=stateDash.task; l.draft=stateDash.draft; } }
    function switchLane(i){ var l=stateDash.lanes[i]; if(!l)return false; stateDash.activeLane=i; stateDash.task=l.task; stateDash.draft=l.draft; stateDash.selectedPocketKey=l.draft?p27DraftKey(l.draft):(l.p27GroupKey||''); if(stateDash.p27Open&&stateDash.p27Open[stateDash.selectedPocketKey]===false)delete stateDash.p27Open[stateDash.selectedPocketKey]; return true; }
    function addLane(){ if(stateDash.lanes.length>=30) return false; stateDash.lanes.push({task:null,draft:null,offset:stateDash.globalOffset||0,pinned:false}); switchLane(stateDash.lanes.length-1); return true; }
    function findEmptyLane(groupKey){
        var key=groupKey===undefined?stateDash.selectedPocketKey:groupKey, free=-1;
        for(var i=0;i<stateDash.lanes.length;i++){
            var l=stateDash.lanes[i];if(!l||l.task||l.draft)continue;
            if(key&&l.p27GroupKey===key)return i;
            if(!l.p27GroupKey&&free<0)free=i;
        }
        return free;
    }
    function removeLane(i){
        if(!stateDash.lanes[i])return false;
        syncLane();
        var l=stateDash.lanes[i], d=l.draft, id=(d&&d.id)||(l.task&&l.task.id);
        var orig=id?((st().tasks||[]).find(function(t){return String(t.id)===String(id);})||l.task):null;
        var dirty=d&&(!orig||JSON.stringify(d)!==JSON.stringify(plan2027BuildDraft(orig)));
        if(dirty&&!window.confirm('Закрыть ось и потерять несохранённые изменения?'))return false;
        if(id)stateDash.p27ClosedTaskIds.add(String(id));
        stateDash.lanes.splice(i,1);
        if(stateDash.p27ChipsOpen){ var m={}; Object.keys(stateDash.p27ChipsOpen).forEach(function(x){ x=+x; if(x<i) m[x]=stateDash.p27ChipsOpen[x]; else if(x>i) m[x-1]=stateDash.p27ChipsOpen[x]; }); stateDash.p27ChipsOpen=m; }
        if(!stateDash.lanes.length)stateDash.lanes.push({task:null,draft:null,offset:0,pinned:false});
        var active=stateDash.activeLane;
        if(active>i)active--;
        switchLane(Math.min(active,stateDash.lanes.length-1));
        return true;
    }
    function laneOffset(lane){ lane=lane||stateDash.lanes[stateDash.activeLane]||{}; return lane && lane.pinned ? (lane.offset||0) : (stateDash.globalOffset||0); }
    function setLanePinned(i, pinned){ var lane=stateDash.lanes[i]; if(!lane) return; lane.pinned=!!pinned; if(lane.pinned) lane.offset=stateDash.globalOffset||0; }
    var DASH_DIR_LABEL = { retail:'Розничное', corp:'Корпоративное' };
    var DASH_STAGE_KEY_DEFAULT = 'проверка_нжя';

    var STAGE_ORDER = [
        'подготовка','проверка_нжя','проверка_соглЦА','ос_проф',
        'реализация_возражения','реализация_согласования','запас','оценка_тб'
    ];
    var STAGE_LABELS = {
        'подготовка':'Подготовка',
        'проверка_нжя':'Проверка НЖЯ',
        'проверка_соглЦА':'Проверка согл. ЦА',
        'ос_проф':'ОС проф.',
        'реализация_возражения':'Реализация возражения',
        'реализация_согласования':'Реализация согласования',
        'запас':'Запас',
        'оценка_тб':'Оценка ТБ'
    };
    var STAGE_WEIGHTS = {
        'подготовка': 0.7,
        'проверка_нжя': 1.0,
        'проверка_соглЦА': 1.0,
        'ос_проф': 0.0,
        'реализация_возражения': 1.0,
        'реализация_согласования': 0.5,
        'запас': 0.5,
        'оценка_тб': 0.0
    };
    var STAGE_COLORS = {
        'подготовка':'#5dade2',
        'проверка_нжя':'#48c9b0',
        'проверка_соглЦА':'#58d68d',
        'ос_проф':'#f4d03f',
        'реализация_возражения':'#eb984e',
        'реализация_согласования':'#e59866',
        'запас':'#af7ac5',
        'оценка_тб':'#ec7063'
    };
    var PLAN_TYPE_MAP = { retail:'розничная', corp:'корпоративная' };

    function st(){ return window.__trkState || { tasks:[], departments:[], employees:[] }; }
    function byId(id){ return document.getElementById(id); }
    function escapeHtml(s){
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
            return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
        });
    }
    function notify(msg, kind){
        if (typeof window.__trackerNotify === 'function') { window.__trackerNotify(msg, kind); return; }
        var t = document.getElementById('toast');
        if (t) {
            t.textContent = msg;
            t.className = 'toast show ' + (kind || 'info');
            setTimeout(function(){ t.classList.remove('show'); }, 2800);
            return;
        }
        try { console.log('[plan2027]', kind || 'info', msg); } catch(e){}
    }
    function apiJson(url, options){
        options = options || {};
        options.headers = Object.assign({}, options.headers || {});
        var csrf = window.REESTR_CSRF || '';
        if (!csrf) {
            var meta = document.querySelector('meta[name="csrf-token"]');
            if (meta) csrf = meta.getAttribute('content') || '';
        }
        if (csrf && options.method && options.method !== 'GET') {
            options.headers['X-CSRF-Token'] = csrf;
        }
        if (!options.credentials) options.credentials = 'same-origin';
        return fetch(url, options).then(function(r){ return r.json(); });
    }
    function fmtNum(v){
        return (v === null || v === undefined || isNaN(v)) ? '—' : String(Math.round(Number(v)*100)/100).replace('.', ',');
    }
    function num(v){ var n = Number(v); return isFinite(n) ? n : 0; }
    function ymd(d){
        return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }
    function todayISO(){
        var s = st().today;
        if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        return ymd(new Date());
    }
    function parse(s){
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
        return m ? new Date(+m[1], +m[2]-1, +m[3]) : null;
    }
    function addDays(d, n){
        var x = new Date(d.getTime());
        x.setDate(x.getDate() + n);
        return x;
    }
    function addDaysISO(iso, delta){
        var d = parse(iso) || new Date();
        d.setDate(d.getDate() + delta);
        return ymd(d);
    }
    var DASH_NEW_START_OFFSET_DAYS = 30, DASH_NEW_LENGTH_MONTHS = 2;
    function addMonthsISO(iso, months){
        var d = parse(iso) || new Date();
        var day = d.getDate();
        d.setDate(1);
        d.setMonth(d.getMonth() + months);
        var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(day, last));
        return ymd(d);
    }
    function ovl(a, b, ps, pe){
        return a && b && a <= pe && b >= ps;
    }
    function clone(x){ return JSON.parse(JSON.stringify(x || {})); }
    function deptById(id){
        return (st().departments || []).find(function(d){ return d.id === id; }) || null;
    }
    function stageLabel(key){ return STAGE_LABELS[key] || key; }
    var P27_STAGE_SHORT = {'подготовка':'Подг.','проверка_нжя':'НЖЯ','проверка_соглЦА':'Согл. ЦА','ос_проф':'ОС','реализация_возражения':'Реал. возр.','реализация_согласования':'Реал. согл.','запас':'Запас','оценка_тб':'Оценка ТБ'};
    function p27StageShort(key){ return P27_STAGE_SHORT[key] || stageLabel(key); }
    function stageWeight(key){ return (STAGE_WEIGHTS[key] !== undefined) ? STAGE_WEIGHTS[key] : 1.0; }
    function dirTaskType(dir){ return PLAN_TYPE_MAP[dir] || (dir === 'corp' ? 'корпоративная' : 'розничная'); }
    function plan2027TaskDir(t){
        var tt = (t && t.task_type ? String(t.task_type) : '').toLowerCase();
        if (tt.indexOf('корп') !== -1) return 'corp';
        if (tt.indexOf('розн') !== -1) return 'retail';
        return '';
    }
    function plan2027DirMatch(t){
        if (stateDash.dir === 'all') return true;
        var d = plan2027TaskDir(t);
        return d === '' || d === stateDash.dir;
    }

    function normByDir(dep, dir){
        if (!dep) return null;
        var v = (dir === 'retail') ? dep.headcount_retail : dep.headcount_corp;
        return (v === null || v === undefined || v === '') ? null : num(v);
    }
    function coefByDir(dep, dir){
        if (!dep) return null;
        var v = (dir === 'retail') ? dep.expert_coef_retail : dep.expert_coef_corp;
        return (v === null || v === undefined || v === '') ? null : num(v);
    }
    function calcPossible(dep, dir){
        var obj = (typeof dep === 'object' && dep) ? dep : deptById(dep);
        if (!obj) return null;
        var n = normByDir(obj, dir), c = coefByDir(obj, dir);
        if (n === null || c === null) return null;
        return Math.round(n * c * 100) / 100;
    }
    function calcAuditWeight(t, ps, pe){
        /* Завершённые (с даты завершения) и отменённые проверки не дают нагрузку */
        if (t && (t.status === 'cancelled' || t.status === 'archived')) return 0;
        if (t && t.status === 'done') {
            var ca = String(t.completed_at || '').slice(0, 10);
            if (ca.length < 10) return 0;
            var cd = parse(ca), now0 = new Date(); now0.setHours(0,0,0,0);
            if (cd && cd > now0) cd = now0;
            if (!cd || cd <= ps) return 0;
            if (cd < pe) pe = new Date(cd.getTime() - 1);
        }
        var stages = (t && Array.isArray(t.stages)) ? t.stages.filter(function(s){ return s && s.start; }) : [];
        if (!stages.length) {
            var a0 = parse(t && t.start_date), b0 = parse((t && t.deadline) || (t && t.start_date));
            return ovl(a0, b0, ps, pe) ? 1.0 : 0;
        }
        var w = 0;
        stages.forEach(function(s){
            var a = parse(s.start), b = parse(s.end || (t && t.deadline) || s.start);
            if (ovl(a, b, ps, pe)) {
                var sw = (s.weight !== undefined && s.weight !== null) ? Number(s.weight) : stageWeight(s.key);
                if (sw > w) w = sw;
            }
        });
        return w;
    }
    function calcTaskLeadCoef(t, bankId){
        if (!t || (t.lead_department || '') !== bankId) return 1.0;
        var tp = t.task_type || '';
        if (tp === 'розничная') return 2.0;
        if (tp === 'корпоративная') return 1.5;
        return 1.0;
    }
    function calcTaskShareMult(t, bankId){
        if (!t || !t.department_shares) return 1.0;
        var v = t.department_shares[bankId];
        if (v === undefined || v === null || v === '') return 1.0;
        var n = Number(v);
        return isFinite(n) && n > 0 ? (n / 100.0) : 1.0;
    }

    function ensurePlan2027Tab(){ return null; }
    function activatePlan2027Tab(){
        document.querySelectorAll('.tracker-tab').forEach(function(t){
            t.classList.remove('active');
        });
        var calendarTab = document.querySelector('.tracker-tab[data-tab="calendar"]');
        if (calendarTab) calendarTab.classList.add('active');
        document.querySelectorAll('.tracker-panel').forEach(function(p){
            p.classList.toggle('active', p.id === 'panel-plan2027');
        });
        try { localStorage.setItem('tracker_activeTab', 'plan2027'); } catch(e){}
        renderSelector();
        syncControls();
        renderPlan2027Layout();
        renderGantt();
        renderLoad();
    }

    function plan2027NormalizeStages(task){
        var raw = (task && Array.isArray(task.stages)) ? clone(task.stages) : [];
        var stages = raw.filter(function(s){ return s && s.start; }).map(function(s){
            return { key:s.key, start:s.start, end:s.end || s.start, weight:(s.weight===undefined||s.weight===null)?stageWeight(s.key):s.weight };
        });
        stages.sort(function(a,b){ return STAGE_ORDER.indexOf(a.key) - STAGE_ORDER.indexOf(b.key); });
        if (!stages.length) {
            var ds = (task && task.start_date) || todayISO();
            var de = (task && task.deadline) || addDaysISO(ds, 90);
            if (de < ds) de = ds;
            stages = [{ key: DASH_STAGE_KEY_DEFAULT, start: ds, end: de, weight: 1.0 }];
        }
        for (var i = 0; i < stages.length; i++) {
            var s = stages[i];
            if (!s.end || s.end < s.start) s.end = s.start;
            if (s.weight === undefined || s.weight === null) s.weight = stageWeight(s.key);
        }
        for (var k = 1; k < stages.length; k++) {
            var prev = stages[k-1], cur = stages[k];
            var prevEnd = parse(prev.end || prev.start), curStart = parse(cur.start), curEnd = parse(cur.end || cur.start);
            if (prevEnd && curStart && curEnd && curStart <= prevEnd) {
                var len = Math.max(1, Math.round((curEnd - curStart) / 86400000));
                cur.start = addDaysISO(prev.end || prev.start, 1);
                cur.end = addDaysISO(cur.start, len);
            }
        }
        return stages;
    }

    function plan2027BuildDraft(task){
        var draft = clone(task || {});
        draft.id = task && task.id ? task.id : '';
        draft.name = draft.name || 'Проверка';
        draft.task_kind = draft.task_kind || 'audit';
        draft.task_type = draft.task_type || (stateDash.dir !== 'all' ? dirTaskType(stateDash.dir) : 'розничная');
        // Не переключаем фильтр, если выбрано «Все» — просто показываем проверку как есть
        // Building an audit draft must never change the active direction filter.
        draft.start_date = draft.start_date || todayISO();
        draft.deadline = draft.deadline || addDaysISO(draft.start_date, 90);
        if (draft.deadline < draft.start_date) draft.deadline = draft.start_date;
        draft.department_ids = Array.isArray(draft.department_ids) ? draft.department_ids.slice() : [];
        draft.department_shares = clone(draft.department_shares || {});
        draft.department_ids.forEach(function(depId){
            if (draft.department_shares[depId] == null) draft.department_shares[depId] = 100;
        });
        draft.stages = plan2027NormalizeStages(draft);
        draft.lead_department = draft.lead_department || (draft.department_ids[0] || '');
        return draft;
    }

    function plan2027CreateDraft(opts){
        opts = opts || {};
        var dir = opts.dir === 'corp' ? 'corp' : 'retail';
        var groupKey = p27PocketKey(dir, opts.pocket);
        syncLane();
        var emptyIdx = findEmptyLane(groupKey);
        if (emptyIdx >= 0) {
            switchLane(emptyIdx);
        } else if (!addLane()) {
            notify('Достигнут лимит осей (30). Закройте ось перед созданием проверки.', 'error');
            return false;
        }
        // План 2027: подготовка 14 дней (01.02–14.02) + проверка НЖЯ 6 недель (15.02–28.03)
        var start = P27_YEAR + '-02-01';
        var prepEnd = addDaysISO(start, 13);
        var njStart = addDaysISO(prepEnd, 1);
        var end = addDaysISO(njStart, 6 * 7 - 1);
        var allDeps = (st().departments || []);
        var firstDepIds = allDeps.length ? [allDeps[0].id] : [];
        var shares = {};
        firstDepIds.forEach(function(id){ shares[id] = 100; });
        stateDash.selectedPocketKey=groupKey;
        var draft = {
            id: '',
            name: opts.name,
            task_kind: 'audit',
            task_type: dirTaskType(dir),
            pocket: opts.pocket || '',
            start_date: start,
            deadline: end,
            department_ids: firstDepIds,
            department_shares: shares,
            lead_department: firstDepIds[0] || '',
            stages: [{ key: 'подготовка', start: start, end: prepEnd, weight: stageWeight('подготовка') },
                     { key: DASH_STAGE_KEY_DEFAULT, start: njStart, end: end, weight: 1.0 }]
        };
        // Чтобы созданная колбаска не отфильтровалась — выставляем направление фильтра под неё
        if (stateDash.dir !== 'all' && stateDash.dir !== dir) stateDash.dir = 'all';
        stateDash.task = null;
        stateDash.draft = draft;
        syncLane();
        stateDash.lanes[stateDash.activeLane].p27GroupKey=p27DraftKey(draft);
        syncControls();
        renderSelector();
        renderGantt();
        renderLoad();
        notify('Черновик «' + draft.name + '» добавлен на ось (' + DASH_DIR_LABEL[dir] + '): подготовка ' + plan2027FmtD(start) + ' → ' + plan2027FmtD(prepEnd) + ', проверка НЖЯ ' + plan2027FmtD(njStart) + ' → ' + plan2027FmtD(end) + '. В БД он попадёт после «Сохранить изменения»', 'info');
        return true;
    }

    function plan2027CloseCreateModal(){
        var ov = byId('plan2027CreateModal');
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        document.removeEventListener('keydown', plan2027CreateModalEsc);
    }
    function plan2027CreateModalEsc(e){ if (e.key === 'Escape') plan2027CloseCreateModal(); }

    function plan2027OpenCreateModal(){
        plan2027CloseCreateModal();
        var existingCount = (st().tasks || []).filter(function(t){ return (t.task_kind || 'audit') === 'audit'; }).length;
        var defName = 'Новая проверка ' + (existingCount + 1);
        var selectedGroup=stateDash.p27Groups&&stateDash.p27Groups.get(stateDash.selectedPocketKey);
        var defDir=selectedGroup?selectedGroup.dir:(stateDash.dir==='corp'?'corp':'retail');
        // Список существующих карманов
        function pocketOptsFor(dir){
            var tt = dirTaskType(dir), o = ['<option value="">— Без кармана —</option>'];
            (window.trkPocketsFor ? window.trkPocketsFor(tt, String(P27_YEAR)) : (window.__trkPocketList || [])).forEach(function(p){ if (p.direction === tt && p.is_active) o.push('<option value="'+escapeHtml(p.name)+'">'+escapeHtml(p.name)+'</option>'); });
            return o.join('');
        }
        var pocketOpts = [pocketOptsFor(defDir)];

        var ov = document.createElement('div');
        ov.id = 'plan2027CreateModal';
        ov.className = 'dash-modal-overlay';
        ov.innerHTML = ''
            + '<div class="dash-modal" role="dialog" aria-modal="true">'
            +   '<div class="dash-modal-head">Новая проверка</div>'
            +   '<div class="dash-modal-body">'
            +     '<label class="dash-modal-label">Название проверки <span class="dash-req">*</span></label>'
            +     '<input type="text" id="plan2027CmName" class="form-control" value="'+escapeHtml(defName)+'" placeholder="Например: Проверка Байкальского банка">'
            +     '<div class="dash-modal-err" id="plan2027CmNameErr"></div>'
            +     '<label class="dash-modal-label">Направление <span class="dash-req">*</span></label>'
            +     '<div class="btn-seg dash-modal-seg" id="plan2027CmDir">'
            +       '<button class="btn-seg-btn'+(defDir==='corp'?' active':'')+'" type="button" data-dir="corp">Корп</button>'
            +       '<button class="btn-seg-btn'+(defDir==='retail'?' active':'')+'" type="button" data-dir="retail">Розн</button>'
            +     '</div>'
            +     '<label class="dash-modal-label">Карман</label>'
            +     '<select id="plan2027CmPocket" class="form-control">'+pocketOpts.join('')+'</select>'
            +   '</div>'
            +   '<div class="dash-modal-foot">'
            +     '<button class="btn btn-secondary" type="button" id="plan2027CmCancel">Отмена</button>'
            +     '<button class="btn" type="button" id="plan2027CmOk">Создать</button>'
            +   '</div>'
            + '</div>';
        document.body.appendChild(ov);
        if(selectedGroup)byId('plan2027CmPocket').value=selectedGroup.name;

        var dirSel = defDir;
        var seg = byId('plan2027CmDir');
        seg.addEventListener('click', function(e){
            var b = e.target && e.target.closest ? e.target.closest('[data-dir]') : null;
            if (!b) return;
            dirSel = b.getAttribute('data-dir');
            seg.querySelectorAll('[data-dir]').forEach(function(x){ x.classList.toggle('active', x===b); });
            var ps = byId('plan2027CmPocket'); if (ps) ps.innerHTML = pocketOptsFor(dirSel);
        });
        ov.addEventListener('mousedown', function(e){ if (e.target === ov) plan2027CloseCreateModal(); });
        byId('plan2027CmCancel').addEventListener('click', plan2027CloseCreateModal);
        document.addEventListener('keydown', plan2027CreateModalEsc);
        byId('plan2027CmOk').addEventListener('click', function(){
            var nm = (byId('plan2027CmName').value || '').trim();
            if (!nm) { byId('plan2027CmNameErr').textContent = 'Укажите название проверки'; byId('plan2027CmName').focus(); return; }
            var pk = byId('plan2027CmPocket').value || '';
            plan2027CloseCreateModal();
            plan2027CreateDraft({ name: nm, dir: dirSel, pocket: pk });
        });
        setTimeout(function(){ var el=byId('plan2027CmName'); if(el){ el.focus(); el.select(); } }, 30);
    }

    function loadDraft(t){
        syncLane();
        var i=t?stateDash.lanes.findIndex(function(l){return (l.draft&&String(l.draft.id)===String(t.id))||(l.task&&String(l.task.id)===String(t.id));}):-1;
        if(i<0){
            i=findEmptyLane(t?p27DraftKey(t):undefined);
            if(i<0){
                if(!addLane()){
                    notify('Достигнут лимит осей (30). Закройте ось перед выбором проверки.', 'error');
                    syncControls();
                    return false;
                }
                i=stateDash.activeLane;
            }
            var l=stateDash.lanes[i];
            l.task=t||null;l.draft=t?plan2027BuildDraft(t):null;
            if(t)l.p27GroupKey=p27DraftKey(l.draft);
        }
        if(t)stateDash.p27ClosedTaskIds.delete(String(t.id));
        switchLane(i);
        syncControls();
        renderSelector();
        renderGantt();
        renderLoad();
        return true;
    }

    function syncControls(){
        var sel = byId('plan2027TaskSelector');
        if (sel) {
            if (stateDash.task && stateDash.task.id) sel.value = stateDash.task.id;
            else if (stateDash.draft && !stateDash.draft.id) sel.value = '__new__';
            else sel.value = '';
        }
        var dirBox = byId('plan2027DirSwitch');
        if (dirBox) {
            dirBox.querySelectorAll('[data-dir]').forEach(function(btn){
                btn.classList.toggle('active', btn.getAttribute('data-dir') === stateDash.dir);
            });
        }
        var modeBox = byId('plan2027ModeSwitch');
        if (modeBox) {
            modeBox.querySelectorAll('[data-mode]').forEach(function(btn){
                btn.classList.toggle('active', btn.getAttribute('data-mode') === stateDash.mode);
            });
        }
        var slider = byId('plan2027GlobalSlider');
        if (slider) {
            var cfg = plan2027GlobalSliderConfig();
            slider.min = cfg.min;
            slider.max = cfg.max;
            slider.step = 1;
            var v = stateDash.globalOffset || 0;
            if (v < cfg.min) v = cfg.min;
            if (v > cfg.max) v = cfg.max;
            slider.value = v;
        }
    }

    function renderSelector(){
        var sel = byId('plan2027TaskSelector');
        if (!sel) return;
        var allTasks = (st().tasks || []);
        var auditTasks = allTasks.filter(function(t){ return (t.task_kind || 'audit') === 'audit'; });
        var base = auditTasks.length ? auditTasks : allTasks;
        var list = base.filter(function(t){ return plan2027DirMatch(t); });
        var opts = ['<option value="">Проверки (' + list.length + ')</option>'];
        if (stateDash.draft && !stateDash.draft.id) {
            opts.push('<option value="__new__">✨ ' + escapeHtml(stateDash.draft.name || 'Новая проверка') + ' (черновик)</option>');
        }
        list.forEach(function(t){
            var meta = [];
            if (t.task_type) meta.push(t.task_type);
            if (t.start_date || t.deadline) meta.push((t.start_date || '…') + '→' + (t.deadline || '…'));
            if (Array.isArray(t.department_ids) && t.department_ids.length) meta.push('банков: ' + t.department_ids.length);
            opts.push('<option value="' + escapeHtml(t.id) + '">' + escapeHtml(t.name) + (meta.length ? ' · ' + escapeHtml(meta.join(' · ')) : '') + '</option>');
        });
        sel.innerHTML = opts.join('');
        if (stateDash.task && stateDash.task.id) sel.value = stateDash.task.id;
        else if (stateDash.draft && !stateDash.draft.id) sel.value = '__new__';
        else sel.value = '';
    }

    function plan2027GlobalSliderConfig(){
        if (stateDash.mode === 'year') return { min:-91, max:91 };
        if (stateDash.mode === 'small') return { min:-180, max:360 };
        if (stateDash.mode === 'large') return { min:-45, max:90 };
        return { min:-90, max:180 };
    }

    function plan2027ClampGlobalOffset(v){
        var cfg = plan2027GlobalSliderConfig();
        v = Number(v) || 0;
        if (v < cfg.min) v = cfg.min;
        if (v > cfg.max) v = cfg.max;
        return Math.round(v);
    }

    function plan2027TimeBounds(offsetDays){
        if (stateDash.mode === 'year') {
            var ys = addDaysISO(P27_YEAR + '-01-01', offsetDays || 0);
            var ye = addDaysISO(P27_YEAR + '-12-31', offsetDays || 0);
            return { startISO: ys, endISO: ye, days: Math.round((parse(ye) - parse(ys)) / 86400000) + 1 };
        }
        var months = MODE_MONTHS[stateDash.mode] || 6;
        var totalDays = Math.round(months * 30.44);
        var center = addDaysISO(todayISO(), offsetDays || 0);
        var at20 = Math.floor(totalDays * 0.20);
        var startISO = addDaysISO(center, -at20);
        var endISO = addDaysISO(center, totalDays - at20);
        return { startISO: startISO, endISO: endISO, days: totalDays };
    }

    function plan2027Slots(offsetDays){
        var b = plan2027TimeBounds(offsetDays);
        var start = parse(b.startISO) || new Date(); start.setHours(0,0,0,0);
        var end = parse(b.endISO) || addDays(start, 180); end.setHours(0,0,0,0);
        if (end < start) { var tmp = start; start = end; end = tmp; }
        var slots = [];
        var useDays = (stateDash.mode === 'large');
        if (useDays) {
            var maxDays = 120, cnt = 0;
            for (var d = new Date(start.getTime()); d <= end && cnt < maxDays; d = addDays(d, 1), cnt++) {
                slots.push({ key: ymd(d), start: new Date(d.getTime()), end: new Date(d.getTime()),
                    label: String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') });
            }
        } else {
            var mon = new Date(start.getTime());
            var wd = (mon.getDay() + 6) % 7;
            mon.setDate(mon.getDate() - wd);
            var maxWeeks = 80, wcnt = 0;
            while (mon <= end && wcnt < maxWeeks) {
                var we = addDays(mon, 6);
                slots.push({ key: ymd(mon), start: new Date(mon.getTime()), end: we,
                    label: String(mon.getDate()).padStart(2,'0') + '.' + String(mon.getMonth()+1).padStart(2,'0') });
                mon = addDays(mon, 7);
                wcnt++;
            }
        }
        return slots;
    }
    function plan2027LoadOffsets(){
        var out = [];
        var seen = {};
        var lanes = Array.isArray(stateDash.lanes) ? stateDash.lanes : [];
        lanes.forEach(function(l){
            var off = laneOffset(l);
            var key = String(off);
            if (!seen[key]) { seen[key] = 1; out.push(off); }
        });
        if (!out.length) out.push(plan2027ClampGlobalOffset(stateDash.globalOffset || 0));
        return out.sort(function(a,b){ return a - b; });
    }
    function plan2027DraftsForLoad(){
        var rows = [];
        var lanes = Array.isArray(stateDash.lanes) ? stateDash.lanes : [];
        lanes.forEach(function(l){
            if (l && l.draft) rows.push(l.draft);
        });
        if (!rows.length && stateDash.draft) rows.push(stateDash.draft);
        return rows;
    }

    function plan2027LeadCoef(depId){
        if (!stateDash.draft) return 1.0;
        if ((stateDash.draft.lead_department || '') !== depId) return 1.0;
        var tp = stateDash.draft.task_type || dirTaskType(stateDash.dir);
        if (tp === 'розничная') return 2.0;
        if (tp === 'корпоративная') return 1.5;
        return 1.0;
    }
    function plan2027ShareMult(depId){
        if (!stateDash.draft || !stateDash.draft.department_shares) return 1.0;
        var v = stateDash.draft.department_shares[depId];
        if (v === undefined || v === null || v === '') return 1.0;
        var n = Number(v);
        return isFinite(n) && n > 0 ? (n / 100.0) : 1.0;
    }
    function plan2027DraftStageLoad(slotStart, slotEnd, depId){
        var drafts = plan2027DraftsForLoad();
        if (!drafts.length) return 0;
        var total = 0;
        drafts.forEach(function(draft){
            if (!draft || (draft.department_ids || []).indexOf(depId) < 0) return;
            var draftDir = plan2027TaskDir(draft) || ((draft.task_type || '').indexOf('корп') !== -1 ? 'corp' : 'retail');
            if (stateDash.dir !== 'all' && draftDir && draftDir !== stateDash.dir) return;
            var stages = plan2027NormalizeStages(draft);
            var maxW = 0;
            stages.forEach(function(s){
                if (!s.start) return;
                var a = parse(s.start), b = parse(s.end || draft.deadline || s.start);
                if (ovl(a, b, slotStart, slotEnd)) {
                    var sw = (s.weight !== undefined && s.weight !== null) ? Number(s.weight) : stageWeight(s.key);
                    if (sw > maxW) maxW = sw;
                }
            });
            if (maxW > 0) total += Math.round(maxW * calcTaskLeadCoef(draft, depId) * calcTaskShareMult(draft, depId) * 100) / 100;
        });
        return Math.round(total * 100) / 100;
    }
    function plan2027BaseLoad(depId, slot){
        var all = st().tasks || [];
        var editId = (stateDash.draft && stateDash.draft.id) || (stateDash.task && stateDash.task.id) || '';
        var dirType = dirTaskType(stateDash.dir);
        var ps = new Date(slot.start.getTime()); ps.setHours(0,0,0,0);
        var pe = new Date(slot.end.getTime()); pe.setHours(23,59,59,999);
        var base = 0;
        all.forEach(function(t){
            if (editId && t.id === editId) return;
            if ((t.department_ids || []).indexOf(depId) < 0) return;
            if ((t.task_kind || 'audit') !== 'audit') return;
            if ((t.task_type || '') !== dirType) return;
            var w = calcAuditWeight(t, ps, pe);
            if (w > 0) base += w * calcTaskLeadCoef(t, depId) * calcTaskShareMult(t, depId);
        });
        return Math.max(0, Math.round(base * 100) / 100);
    }

    function plan2027ShiftAll(deltaDays){
        if (!stateDash.draft) return;
        var d = stateDash.draft, stg = plan2027NormalizeStages(d);
        stg.forEach(function(s){
            s.start = addDaysISO(s.start, deltaDays);
            s.end = addDaysISO(s.end || s.start, deltaDays);
        });
        d.stages = stg;
        d.start_date = addDaysISO(d.start_date, deltaDays);
        d.deadline = addDaysISO(d.deadline, deltaDays);
    }

    function plan2027AttachDrag(c){
        var track = byId('plan2027TlTrack');
        if (!track || !stateDash.draft) return;
        var rng = stateDash._range || {};
        var days = rng.days || 180;
        /* Cache track width at drag start — NOT re-read during move (it can be 0 after innerHTML swap) */
        var trackW = track.getBoundingClientRect().width || track.offsetWidth || 800;
        function pxToDays(px){
            return Math.round((px / trackW) * days);
        }
        var drag = null;
        function onDown(e){
            if (e.button !== undefined && e.button !== 0) return;
            var t = e.target;
            if (t.closest && t.closest('.dash-seg-del')) return;
            if (t.closest && t.closest('[data-lane]')) return;
            if (t.closest && t.closest('.dash-lane-close')) return;
            if (t.closest && t.closest('#plan2027AddLaneBtn')) return;
            var handle = t.closest ? t.closest('.dash-seg-h') : null;
            var seg = t.closest ? t.closest('.dash-seg') : null;
            if (handle) {
                drag = { type:'edge', idx:+handle.getAttribute('data-idx'), edge:handle.getAttribute('data-edge') };
            } else if (seg) {
                drag = { type:'seg', idx:+seg.getAttribute('data-idx') };
            } else {
                drag = { type:'all' };
            }
            drag.x0 = e.clientX;
            /* Snapshot the current stages ONCE at drag start */
            drag.snap = plan2027NormalizeStages(stateDash.draft).map(function(s){
                return { key:s.key, start:s.start, end:s.end, weight:s.weight };
            });
            drag.baseStart = stateDash.draft.start_date;
            drag.baseDeadline = stateDash.draft.deadline;
            /* Re-read track width in case layout changed */
            trackW = track.getBoundingClientRect().width || track.offsetWidth || 800;
            e.preventDefault();
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        }
        function onMove(e){
            if (!drag || !stateDash.draft) return;
            var dd = pxToDays(e.clientX - drag.x0);
            if (stateDash.mode !== 'large') dd = Math.round(dd / 7) * 7;
            if (dd === (drag.lastDd || 0)) return;
            drag.lastDd = dd;
            var snap = drag.snap;
            if (drag.type === 'all') {
                /* Apply delta from snapshot, not from current state */
                stateDash.draft.stages = snap.map(function(s){ return { key:s.key, start:addDaysISO(s.start, dd), end:addDaysISO(s.end||s.start, dd), weight:s.weight }; });
                stateDash.draft.start_date = addDaysISO(drag.baseStart, dd);
                stateDash.draft.deadline = addDaysISO(drag.baseDeadline, dd);
            } else {
                var i = drag.idx, s = snap[i];
                if (!s) return;
                var stg = snap.map(function(x){ return { key:x.key, start:x.start, end:x.end, weight:x.weight }; });
                if (drag.type === 'edge') {
                    if (drag.edge === 'start') {
                        var ns = addDaysISO(s.start, dd);
                        if (ns > stg[i].end) ns = stg[i].end;
                        stg[i].start = ns;
                    } else {
                        var ne = addDaysISO(s.end, dd);
                        if (ne < stg[i].start) ne = stg[i].start;
                        stg[i].end = ne;
                    }
                } else {
                    stg[i].start = addDaysISO(s.start, dd);
                    stg[i].end = addDaysISO(s.end, dd);
                }
                stg.sort(function(a,b){ return STAGE_ORDER.indexOf(a.key) - STAGE_ORDER.indexOf(b.key); });
                for (var k = 1; k < stg.length; k++) {
                    var prev = stg[k-1], cur = stg[k];
                    if (cur.start <= prev.end) {
                        var curLen = Math.max(1, Math.round((parse(cur.end||cur.start) - parse(cur.start)) / 86400000));
                        cur.start = addDaysISO(prev.end, 1);
                        cur.end = addDaysISO(cur.start, curLen);
                    }
                }
                stateDash.draft.stages = stg;
                stateDash.draft.start_date = stg[0].start;
                stateDash.draft.deadline = stg[stg.length-1].end;
            }
            syncLane();
            renderGantt();
            renderLoad();
        }
        function onUp(){
            drag = null;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        }
        track.addEventListener('pointerdown', onDown);
        c.querySelectorAll('.dash-seg-del').forEach(function(b){
            b.addEventListener('click', function(ev){
                ev.stopPropagation();
                var idx = +this.getAttribute('data-del');
                var stg = plan2027NormalizeStages(stateDash.draft);
                if (stg[idx] && stg[idx].key !== DASH_STAGE_KEY_DEFAULT) {
                    stg.splice(idx, 1);
                    stateDash.draft.stages = stg;
                    syncLane();
                    renderGantt(); renderLoad();
                }
            });
        });
    }

    function openAddStageDialog(){
        if (!stateDash.draft) { plan2027OpenCreateModal(); return; }
        var existing = {};
        plan2027NormalizeStages(stateDash.draft).forEach(function(s){ existing[s.key] = true; });
        var options = STAGE_ORDER.filter(function(k){ return k !== DASH_STAGE_KEY_DEFAULT && !existing[k]; });
        if (!options.length) { notify('Все 7 дополнительных этапов уже добавлены', 'info'); return; }
        var labels = options.map(function(k, i){ return (i+1) + '. ' + stageLabel(k) + ' (вес ' + stageWeight(k) + ')'; }).join('\n');
        var ans = window.prompt('Добавить этап в колбаску:\n' + labels + '\n\nВведите номер этапа (1–' + options.length + '):', '1');
        if (ans === null) return;
        var idx = parseInt(ans, 10) - 1;
        if (isNaN(idx) || idx < 0 || idx >= options.length) { notify('Некорректный номер этапа', 'error'); return; }
        var key = options[idx];
        var stg = plan2027NormalizeStages(stateDash.draft);
        var lastEnd = stateDash.draft.deadline || stateDash.draft.start_date || todayISO();
        stg.forEach(function(s){ if ((s.end || s.start) > lastEnd) lastEnd = s.end || s.start; });
        var newStart = addDaysISO(lastEnd, 1);
        var newEnd = addDaysISO(newStart, 13);
        stg.push({ key: key, start: newStart, end: newEnd, weight: stageWeight(key) });
        stateDash.draft.stages = stg;
        if (newEnd > stateDash.draft.deadline) stateDash.draft.deadline = newEnd;
        renderGantt();
        renderLoad();
    }

    function openAddBankDialog(){
        if (!stateDash.draft) { plan2027OpenCreateModal(); return; }
        var cur = stateDash.draft.department_ids || [];
        var avail = (st().departments || []).filter(function(dep){ return cur.indexOf(dep.id) < 0; });
        if (!avail.length) { notify('Все банки уже участвуют в проверке', 'info'); return; }
        var labels = avail.map(function(dep, i){ return (i+1) + '. ' + dep.name; }).join('\n');
        var ans = window.prompt('Добавить банк в проверку:\n' + labels + '\n\nВведите номер банка (1–' + avail.length + '):', '1');
        if (ans === null) return;
        var idx = parseInt(ans, 10) - 1;
        if (isNaN(idx) || idx < 0 || idx >= avail.length) { notify('Некорректный номер банка', 'error'); return; }
        var dep = avail[idx];
        stateDash.draft.department_ids = cur.concat([dep.id]);
        stateDash.draft.department_shares = stateDash.draft.department_shares || {};
        if (stateDash.draft.department_shares[dep.id] == null) stateDash.draft.department_shares[dep.id] = 100;
        if (!stateDash.draft.lead_department) stateDash.draft.lead_department = dep.id;
        renderGantt();
        renderLoad();
    }

    function renderLaneBlock(lane, laneIdx, isActive, b, canClose, canPin, isPinned){
        var hasDraft = !!lane.draft;
        var d = lane.draft || {
            name: 'Проверка не выбрана (линия жизни)',
            task_type: dirTaskType(stateDash.dir),
            start_date: todayISO(),
            deadline: addDaysISO(todayISO(), 90),
            department_ids: [],
            stages: []
        };
        var stages = hasDraft ? plan2027NormalizeStages(d) : [];
        b = b || plan2027TimeBounds(laneOffset(lane));
        var rangeStart = b.startISO, rangeEnd = b.endISO, totalDays = b.days || 180;

        function pctX(iso){
            var dd = Math.round((parse(iso) - parse(rangeStart)) / 86400000);
            return Math.max(-5, Math.min(105, (dd / totalDays) * 100));
        }

        var ticks = [], p27Bands = '', p27Lines = '';
        if (stateDash.mode === 'year') {
            var mc = parse(rangeStart); mc = new Date(mc.getFullYear(), mc.getMonth(), 1);
            var endD = parse(rangeEnd), runs = [];
            while (mc <= endD) {
                var nx = new Date(mc.getFullYear(), mc.getMonth() + 1, 1);
                var ms = ymd(mc) < rangeStart ? rangeStart : ymd(mc);
                var me = ymd(nx) > addDaysISO(rangeEnd, 1) ? addDaysISO(rangeEnd, 1) : ymd(nx);
                var x0m = Math.max(0, pctX(ms)), x1m = Math.min(100, pctX(me));
                if (ymd(mc) >= rangeStart) p27Lines += '<div class="p27-mline" style="left:' + x0m + '%"></div>';
                ticks.push('<div class="p27-mlab" style="left:' + ((x0m + x1m) / 2) + '%">' + P27_MON[mc.getMonth()] + '</div>');
                var sk = p27SeasonOf(mc.getMonth());
                if (runs.length && runs[runs.length-1].k === sk) runs[runs.length-1].x1 = x1m;
                else runs.push({ k: sk, x0: x0m, x1: x1m });
                mc = nx;
            }
            p27Bands = runs.map(function(r){
                var S = P27_SEASONS[r.k];
                return '<div class="p27-season p27-s-' + r.k + '" style="left:' + r.x0 + '%;width:' + (r.x1 - r.x0) + '%;--p27c:' + S.rgb + '" title="' + S.ico + ' ' + S.name + ' · ' + S.q + '"></div>';
            }).join('');
        }
        var useDays = (stateDash.mode === 'large');
        var step = useDays ? (totalDays > 60 ? 3 : 1) : 7;
        for (var ti = 0; stateDash.mode !== 'year' && ti <= totalDays; ti += step) {
            var iso = addDaysISO(rangeStart, ti);
            var dt = parse(iso);
            var lbl = String(dt.getDate()).padStart(2,'0') + '.' + String(dt.getMonth()+1).padStart(2,'0');
            ticks.push('<div class="dash-tl-tick" style="left:' + ((ti / totalDays) * 100) + '%"><span>' + escapeHtml(lbl) + '</span></div>');
        }
        var todayMarker = (todayISO() >= rangeStart && todayISO() <= rangeEnd) ? '<div class="dash-tl-today" style="left:' + pctX(todayISO()) + '%" title="Сегодня"></div>' : '';
        var header = '<div class="dash-lane-header">'
            + '<div class="dash-lane-title">Ось ' + (laneIdx+1) + (hasDraft ? ' · ' + escapeHtml(d.name || 'Проверка') : '') + (lane.p27Carry ? ' · <span class="p27-carry-title" title="Переходящая из 2026: ' + escapeHtml(lane.p27Carry.draft.name || 'Проверка') + '">↪ ' + escapeHtml(lane.p27Carry.draft.name || 'Проверка') + ' (2026)</span>' : '') + '</div>'
            + '<div class="dash-lane-header-actions">'
            + '<button class="p27-chips-toggle' + ((stateDash.p27ChipsOpen && stateDash.p27ChipsOpen[laneIdx]) ? ' active' : '') + '" type="button" data-p27-chips-toggle="' + laneIdx + '" title="Показать/скрыть банки и этапы">⊞</button>'
            + (canPin ? '<button class="dash-lane-pin' + (isPinned ? ' active' : '') + '" type="button" data-lane-pin="' + laneIdx + '" title="' + (isPinned ? 'Открепить ось' : 'Закрепить ось') + '">📌</button>' : '')
            + (canClose ? '<button class="dash-lane-close" type="button" data-lane-close="' + laneIdx + '" title="Удалить ось">×</button>' : '')
            + '</div></div>';

        var segs = '';
        if (hasDraft) {
            segs = stages.map(function(s, idx){
                if ((s.end||s.start)<rangeStart || s.start>rangeEnd) return '';
                var x0 = Math.max(0, Math.min(100,pctX(s.start)));
                var x1 = Math.max(0, Math.min(100,pctX(addDaysISO(s.end||s.start,1))));
                var w = Math.max(0, x1 - x0);
                var col = STAGE_COLORS[s.key] || '#48c9b0';
                var isDefault = (s.key === DASH_STAGE_KEY_DEFAULT);
                var p27Prelim = !d.id || !d.status || d.status === 'planning';
                var tip = stageLabel(s.key) + ': ' + s.start + ' → ' + (s.end || s.start) + ' (вес ' + fmtNum(s.weight) + ')';
                return '<div class="dash-seg' + (isDefault ? ' dash-seg-lead' : '') + (p27Prelim ? ' p27-prelim' : '') + '" data-idx="' + idx + '" title="' + escapeHtml(tip + (p27Prelim ? ' · предварительная' : '')) + '" style="left:' + x0 + '%;width:' + w + '%;background:' + escapeHtml(col) + ';--p27seg:' + escapeHtml(col) + '">'
                    + '<span class="dash-seg-h dash-seg-h-l" data-idx="' + idx + '" data-edge="start" title="Тянуть начало"></span>'
                    + '<span class="dash-seg-lab">' + escapeHtml(p27StageShort(s.key)) + '</span>'
                    + '<span class="dash-seg-h dash-seg-h-r" data-idx="' + idx + '" data-edge="end" title="Тянуть конец"></span>'
                    + (isDefault ? '' : '<button class="dash-seg-del" type="button" data-del="' + idx + '" data-lane="' + laneIdx + '" title="Удалить этап">×</button>')
                    + '</div>';
            }).join('');
        } else {
            var rem = lane.p27Remaining || 0;
            var slotTip = !lane.p27GroupKey ? '' : (rem > 0 ? 'По плану нужно начать ещё ' + rem + ' ' + (rem%10===1&&rem%100!==11?'проверку':rem%10>=2&&rem%10<=4&&(rem%100<12||rem%100>14)?'проверки':'проверок') : '');
            segs = '<div class="dash-tl-empty-bar p27-empty-slot"' + (slotTip ? ' title="' + escapeHtml(slotTip) + '"' : '') + '></div>';
        }
        var carrySegs = '';
        if (lane.p27Carry) {
            var cy = lane.p27Carry, cst = plan2027NormalizeStages(cy.draft), firstLab = true;
            if (!cst.length) cst = [{ key:'', start:cy.start, end:cy.end }];
            carrySegs = cst.map(function(s){
                var se = s.end || s.start;
                if (se < rangeStart || s.start > rangeEnd) return '';
                var x0 = Math.max(0, Math.min(100, pctX(s.start)));
                var x1 = Math.max(0, Math.min(100, pctX(addDaysISO(se, 1))));
                if (x1 <= x0) return '';
                var col = STAGE_COLORS[s.key] || '#94a3b8';
                var lab = (firstLab ? '2026 · ' : '') + (s.key ? p27StageShort(s.key) : (cy.draft.name || ''));
                firstLab = false;
                var tip = 'Переходящая из 2026: «' + (cy.draft.name || 'Проверка') + '»' + (s.key ? ' · ' + stageLabel(s.key) : '') + ': ' + s.start + ' → ' + se + (cy.task.status === 'done' ? ' · завершена' : '') + ' · в план 2027 не входит';
                return '<div class="p27-carry-seg" data-p27-carry="' + escapeHtml(cy.id) + '" title="' + escapeHtml(tip) + '" style="left:' + x0 + '%;width:' + (x1 - x0) + '%;--p27seg:' + escapeHtml(col) + '"><span class="p27-carry-lab" data-p27-short="' + escapeHtml(lab.indexOf('2026') === 0 ? '2026' : '') + '">' + escapeHtml(lab) + '</span></div>';
            }).join('');
        }
        var trackId = isActive ? ' id="plan2027TlTrack"' : '';
        return '<div class="dash-lane-block" data-lane-block="' + laneIdx + '">'
            + header
            + '<div class="dash-timeline' + (stateDash.mode === 'year' ? ' p27-year' : '') + '">'
            + '<div class="p27-scale">' + p27Bands + p27Lines
            + '<div class="dash-tl-axis">' + ticks.join('') + '</div>'
            + '<div class="dash-tl-track"' + trackId + ' data-lane-track="' + laneIdx + '">' + todayMarker + carrySegs + segs + '</div>'
            + '</div></div>'
            + renderLaneControls(lane, laneIdx)
            + '</div>';
    }

    function renderLaneControls(lane, laneIdx){
        var hasDraft = !!lane.draft;
        if (!hasDraft) return '';
        var d = lane.draft;
        var allDeps = st().departments || [];
        var curIds = d.department_ids || [];

        /* Bank chips: white -> blue (on), lead -> yellow */
        var bankChips = '<div class="dash-bank-row"><div class="dash-bank-chips"><span class="dash-bank-chips-lbl" title="Клик по банку — включить/выключить">Банки:</span>'
            + allDeps.map(function(dep){
                var on = curIds.indexOf(dep.id) >= 0;
                var isLead = (d.lead_department === dep.id);
                var sh = (d.department_shares && d.department_shares[dep.id] != null) ? d.department_shares[dep.id] : 100;
                return '<button class="dash-bank-chip' + (on ? ' on' : '') + (isLead ? ' lead' : '') + '" type="button" data-toggle-bank="' + escapeHtml(dep.id) + '" data-lane="' + laneIdx + '" title="' + escapeHtml(dep.name + (isLead ? ' (\u0440\u0443\u043a\u043e\u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044c)' : '') + (on ? ' \u00b7 \u0434\u043e\u043b\u044f ' + sh + '%' : '')) + '">' + escapeHtml(p27Short(dep)) + (isLead ? ' \u2605' : '') + '</button>';
            }).join('')
            + '</div>'
            + '<button class="dash-lead-picker-btn" type="button" data-open-lead-picker="' + laneIdx + '" title="Сменить руководителя">★ Руководитель</button></div>';

        /* Stage chips: white -> stage color (on) */
        var existing = {};
        plan2027NormalizeStages(d).forEach(function(s){ existing[s.key] = true; });
        var stageChips = '<div class="dash-stage-chips"><span class="dash-bank-chips-lbl" title="Клик по этапу — включить/выключить">Этапы:</span>'
            + STAGE_ORDER.map(function(k){
                var on = !!existing[k];
                var col = STAGE_COLORS[k] || '#48c9b0';
                var isDefault = (k === DASH_STAGE_KEY_DEFAULT);
                var style = on ? ('style="background:' + col + ';border-color:' + col + ';color:#fff"') : '';
                return '<button class="dash-stage-chip' + (on ? ' on' : '') + (isDefault ? ' is-default' : '') + '" type="button" data-toggle-stage="' + escapeHtml(k) + '" data-lane="' + laneIdx + '" ' + style + ' title="' + escapeHtml(stageLabel(k) + (isDefault ? ' (\u0431\u0430\u0437\u043e\u0432\u044b\u0439, \u043d\u0435\u043b\u044c\u0437\u044f \u0432\u044b\u043a\u043b\u044e\u0447\u0438\u0442\u044c)' : '') + ' \u00b7 \u0432\u0435\u0441 ' + stageWeight(k)) + '">' + escapeHtml(p27StageShort(k)) + '</button>';
            }).join('')
            + '</div>';

        var p27Open = !!(stateDash.p27ChipsOpen && stateDash.p27ChipsOpen[laneIdx]);
        return '<div class="p27-chips-wrap' + (p27Open ? '' : ' p27-chips-hidden') + '" id="p27ChipsWrap' + laneIdx + '">' + bankChips + stageChips + '</div>';
    }

    function renderGantt(){
        var c = byId('plan2027GanttContainer');
        if (!c) return;
        stateDash.globalOffset = plan2027ClampGlobalOffset(stateDash.globalOffset || 0);
        var sliderCfg = plan2027GlobalSliderConfig();
        var gOff = stateDash.globalOffset || 0;
        var sliderHtml = '<div class="dash-global-slider-wrap p27-slider-wrap"><label class="p27-slider-lab" for="plan2027GlobalSlider">Сдвиг шкалы</label>'
            + '<input type="range" id="plan2027GlobalSlider" class="dash-global-slider" min="' + sliderCfg.min + '" max="' + sliderCfg.max + '" step="1" value="' + gOff + '" title="Сдвинуть шкалу незакреплённых осей (±3 месяца)">'
            + '<span class="p27-slider-val">' + (gOff ? (gOff > 0 ? '+' : '−') + Math.abs(gOff) + ' дн.' : 'с 1 января') + '</span></div>';
        var lanesHtml = p27GroupedLanes();
        var addBtn = stateDash.lanes.length < 30 ? '<div class="dash-lanes-foot"><button class="dash-lane-add" type="button" id="plan2027AddLaneBtn">+ Ось</button></div>' : '';
        var p27Legend = stateDash.mode === 'year' ? ('<div class="p27-legend">' + ['winter','spring','summer','autumn'].map(function(k){
            var S = P27_SEASONS[k];
            return '<span class="p27-leg" style="--p27c:' + S.rgb + '" title="Сезонный квартал: ' + S.mon + '"><i></i>' + S.ico + ' ' + S.q + ' · ' + S.mon + '</span>';
        }).join('') + '</div>') : '';
        c.innerHTML = sliderHtml + p27Legend + lanesHtml + addBtn + renderLeadPicker();
        plan2027ScheduleTicks();
        var addBtnEl = byId('plan2027AddLaneBtn');
        if (addBtnEl) addBtnEl.addEventListener('click', function(){ if (addLane()) { renderSelector(); syncControls(); renderGantt(); renderLoad(); } });
        c.querySelectorAll('[data-lane-close]').forEach(function(btn){ btn.addEventListener('click', function(e){ e.stopPropagation(); if (removeLane(+this.getAttribute('data-lane-close'))) { renderSelector(); syncControls(); renderGantt(); renderLoad(); } }); });
        c.querySelectorAll('[data-lane-pin]').forEach(function(btn){ btn.addEventListener('click', function(e){ e.stopPropagation(); var i=+this.getAttribute('data-lane-pin'); var lane=stateDash.lanes[i]; if(!lane) return; setLanePinned(i, !lane.pinned); renderGantt(); renderLoad(); }); });
        var gs = byId('plan2027GlobalSlider');
        if (gs) {
            var updateSliderValueFromEvent = function(ev){
                var rect = gs.getBoundingClientRect();
                if (!rect.width) return;
                var ratio = (ev.clientX - rect.left) / rect.width;
                if (ratio < 0) ratio = 0;
                if (ratio > 1) ratio = 1;
                var min = Number(gs.min || 0);
                var max = Number(gs.max || 0);
                var next = Math.round(min + ratio * (max - min));
                gs.value = String(next);
                stateDash.globalOffset = plan2027ClampGlobalOffset(next);
                renderGantt(); renderLoad(); syncControls();
            };
            gs.addEventListener('input', function(){ stateDash.globalOffset = plan2027ClampGlobalOffset(+this.value || 0); renderGantt(); renderLoad(); syncControls(); });
            gs.addEventListener('pointerdown', function(ev){ gs.classList.add('is-grabbing'); updateSliderValueFromEvent(ev); try { gs.setPointerCapture(ev.pointerId); } catch(_) {} });
            gs.addEventListener('pointermove', function(ev){ if ((ev.buttons & 1) !== 1) return; updateSliderValueFromEvent(ev); });
            var releaseSlider = function(ev){ gs.classList.remove('is-grabbing'); try { if (ev && ev.pointerId != null) gs.releasePointerCapture(ev.pointerId); } catch(_) {} };
            gs.addEventListener('pointerup', releaseSlider);
            gs.addEventListener('pointercancel', releaseSlider);
            gs.addEventListener('lostpointercapture', function(){ gs.classList.remove('is-grabbing'); });
        }
        c.querySelectorAll('[data-lane-block]').forEach(function(el){ el.addEventListener('pointerdown', function(e){ if (e.target.closest('[data-lane-close]') || e.target.closest('[data-lane-pin]') || e.target.closest('[data-p27-chips-toggle]')) return; var li = +this.getAttribute('data-lane-block'); if (li !== stateDash.activeLane) { switchLane(li); renderSelector(); syncControls(); renderGantt(); renderLoad(); } }, true); });
        c.querySelectorAll('[data-p27-chips-toggle]').forEach(function(btn){ btn.addEventListener('click', function(e){ e.stopPropagation(); var li = +this.getAttribute('data-p27-chips-toggle'); var wrap = document.getElementById('p27ChipsWrap' + li); if (wrap) { var hidden = wrap.classList.toggle('p27-chips-hidden'); this.classList.toggle('active', !hidden); stateDash.p27ChipsOpen = stateDash.p27ChipsOpen || {}; stateDash.p27ChipsOpen[li] = !hidden; } }); });
        c.querySelectorAll('[data-lane-name]').forEach(function(inp){ inp.addEventListener('change', function(){ var li=+this.getAttribute('data-lane-name'); var L=stateDash.lanes[li]; if (L && L.draft) { L.draft.name = this.value; if (li===stateDash.activeLane){stateDash.draft.name=this.value;} renderSelector(); } }); });
        c.querySelectorAll('[data-lane-start]').forEach(function(inp){ inp.addEventListener('change', function(){ var li=+this.getAttribute('data-lane-start'); var L=stateDash.lanes[li]; if (!L||!L.draft||!this.value) return; L.draft.start_date=this.value; var stg=plan2027NormalizeStages(L.draft); if(stg.length)stg[0].start=this.value; L.draft.stages=stg; switchLane(li); renderGantt(); renderLoad(); }); });
        c.querySelectorAll('[data-lane-end]').forEach(function(inp){ inp.addEventListener('change', function(){ var li=+this.getAttribute('data-lane-end'); var L=stateDash.lanes[li]; if (!L||!L.draft||!this.value) return; L.draft.deadline=this.value; var stg=plan2027NormalizeStages(L.draft); if(stg.length)stg[stg.length-1].end=this.value; L.draft.stages=stg; switchLane(li); renderGantt(); renderLoad(); }); });
        c.querySelectorAll('[data-toggle-bank]').forEach(function(btn){
            btn.addEventListener('click', function(){ var li=+this.getAttribute('data-lane'); switchLane(li); if (!stateDash.draft) return; var depId=this.getAttribute('data-toggle-bank'); var cur=(stateDash.draft.department_ids||[]).slice(); var k=cur.indexOf(depId); if (k>=0){ cur.splice(k,1); if(stateDash.draft.lead_department===depId) stateDash.draft.lead_department=cur[0]||''; } else { cur.push(depId); stateDash.draft.department_shares=stateDash.draft.department_shares||{}; if(stateDash.draft.department_shares[depId]==null)stateDash.draft.department_shares[depId]=100; if(!stateDash.draft.lead_department)stateDash.draft.lead_department=depId; } stateDash.draft.department_ids=cur; syncLane(); renderGantt(); renderLoad(); });
        });
        c.querySelectorAll('[data-open-lead-picker]').forEach(function(btn){
            btn.addEventListener('click', function(){
                var li = +this.getAttribute('data-open-lead-picker');
                switchLane(li);
                if (!stateDash.draft) return;
                var cur = (stateDash.draft.department_ids || []).slice();
                if (!cur.length) { notify('Добавьте хотя бы одного участника в проверку', 'error'); return; }
                openLeadPicker(li);
            });
        });
        c.querySelectorAll('[data-pick-lead]').forEach(function(btn){
            btn.addEventListener('click', function(){
                var li = +this.getAttribute('data-lane');
                switchLane(li);
                if (!stateDash.draft) return;
                var depId = this.getAttribute('data-pick-lead') || '';
                var cur = (stateDash.draft.department_ids || []);
                if (cur.indexOf(depId) < 0) { notify('Добавьте хотя бы одного участника в проверку', 'error'); return; }
                stateDash.draft.lead_department = depId;
                closeLeadPicker();
                syncLane(); renderGantt(); renderLoad();
            });
        });
        var leadClose = byId('plan2027LeadPickerClose');
        if (leadClose) leadClose.addEventListener('click', function(){ closeLeadPicker(); });
        var leadBackdrop = byId('plan2027LeadPickerBackdrop');
        if (leadBackdrop) leadBackdrop.addEventListener('click', function(e){ if (e.target === this) closeLeadPicker(); });
        c.querySelectorAll('[data-toggle-stage]').forEach(function(btn){
            btn.addEventListener('click', function(){
                var li=+this.getAttribute('data-lane'); switchLane(li);
                if (!stateDash.draft) return;
                var key=this.getAttribute('data-toggle-stage');
                if (key===DASH_STAGE_KEY_DEFAULT){ notify('Этап «Проверка НЖЯ» базовый и всегда активен', 'info'); return; }
                var stg=plan2027NormalizeStages(stateDash.draft), pos=stg.map(function(x){return x.key;}).indexOf(key);
                if (pos>=0){ stg.splice(pos,1); }
                else {
                    var lastEnd=stateDash.draft.deadline||stateDash.draft.start_date||todayISO(); stg.forEach(function(x){ if((x.end||x.start)>lastEnd) lastEnd=x.end||x.start; });
                    var ns, ne;
                    if (key === 'подготовка') { var ngStg = stg.filter(function(x){ return x.key === DASH_STAGE_KEY_DEFAULT; })[0]; var ngStart = ngStg ? (ngStg.start || stateDash.draft.start_date) : (stateDash.draft.start_date || todayISO()); ne = addDaysISO(ngStart, -1); ns = addDaysISO(ne, -13); }
                    else { ns=addDaysISO(lastEnd,1); ne=addDaysISO(ns,13); }
                    stg.push({key:key,start:ns,end:ne,weight:stageWeight(key)}); if (ne>stateDash.draft.deadline) stateDash.draft.deadline=ne;
                }
                stg.sort(function(a,b){ return STAGE_ORDER.indexOf(a.key) - STAGE_ORDER.indexOf(b.key); });
                for (var k = 1; k < stg.length; k++) { var prev = stg[k-1], cur = stg[k]; if (cur.start <= prev.end) { var curLen = Math.max(1, Math.round((parse(cur.end||cur.start) - parse(cur.start)) / 86400000)); cur.start = addDaysISO(prev.end, 1); cur.end = addDaysISO(cur.start, curLen); } }
                stateDash.draft.stages=stg; syncLane(); renderGantt(); renderLoad();
            });
        });
        c.querySelectorAll('[data-del]').forEach(function(btn){ btn.addEventListener('click', function(e){ e.stopPropagation(); var li=+this.getAttribute('data-lane'); switchLane(li); if (!stateDash.draft) return; var idx=+this.getAttribute('data-del'); var stg=plan2027NormalizeStages(stateDash.draft); if (stg[idx] && stg[idx].key!==DASH_STAGE_KEY_DEFAULT){ stg.splice(idx,1); stateDash.draft.stages=stg; syncLane(); renderGantt(); renderLoad(); } }); });
        c.querySelectorAll('[data-p27-select-pocket]').forEach(function(btn){btn.addEventListener('click',function(){var k=this.getAttribute('data-p27-select-pocket'),det=this.parentElement,opening=!(det&&det.open);stateDash.p27Open=stateDash.p27Open||{};stateDash.p27Open[k]=opening;if(opening)stateDash.selectedPocketKey=k;renderLoad();});});
        plan2027AttachDrag(c);
    }


    function renderLeadPicker(){
        var laneIdx = stateDash.leadPickerLane;
        if (laneIdx == null || laneIdx < 0) return '';
        var lane = (stateDash.lanes || [])[laneIdx];
        var draft = lane && lane.draft;
        if (!draft) return '';
        var ids = (draft.department_ids || []).slice();
        if (!ids.length) return '';
        var deps = st().departments || [];
        var buttons = ids.map(function(depId){
            var dep = deps.find ? deps.find(function(x){ return x.id === depId; }) : null;
            var name = dep ? dep.name : depId;
            var active = (draft.lead_department === depId);
            return '<button class="dash-lead-option' + (active ? ' active' : '') + '" type="button" data-pick-lead="' + escapeHtml(depId) + '" data-lane="' + laneIdx + '">' + escapeHtml(name) + '</button>';
        }).join('');
        return '<div class="dash-modal-backdrop" id="plan2027LeadPickerBackdrop"><div class="dash-modal dash-lead-modal">'
            + '<div class="dash-modal-head"><div class="dash-modal-title">Сменить руководителя</div><button class="dash-modal-close" type="button" id="plan2027LeadPickerClose">×</button></div>'
            + '<div class="dash-lead-modal-body">' + buttons + '</div>'
            + '</div></div>';
    }

    function openLeadPicker(laneIdx){
        stateDash.leadPickerLane = laneIdx;
        renderGantt();
    }

    function closeLeadPicker(){
        stateDash.leadPickerLane = null;
        renderGantt();
    }

    // Load view API: selectedPocketKey = direction + '|' + pocket; empty means no selection.
    // A lane draft replaces its persisted audit (including when cancelled or moved out of 2027).
    function plan2027LoadAudits(){
        var saved = new Map(), fresh = [], seenFresh = new Set();
        function put(t){
            if (!t) return;
            if (t.id !== undefined && t.id !== null && String(t.id) !== '') saved.set(String(t.id), t);
            else if (!seenFresh.has(t)) { seenFresh.add(t); fresh.push(t); }
        }
        (st().tasks || []).forEach(put);
        plan2027DraftsForLoad().forEach(put);
        if (stateDash.draft) put(stateDash.draft); // Active lane wins if a caller has not synced it yet.
        return Array.from(saved.values()).concat(fresh).filter(function(t){
            return (t.task_kind || 'audit') === 'audit' && t.status !== 'cancelled' && t.status !== 'archived';
        });
    }

    function plan2027LoadAuditBounds(t){
        function iso(value){
            var s = String(value || '').slice(0, 10);
            return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) ? s : '';
        }
        // Draft stage edges reflect unsaved moves/resizes, even if task-level dates are stale.
        var stages = Array.isArray(t.stages) ? t.stages.filter(function(s){ return s && iso(s.start); }) : [];
        var start = iso(t.start_date), end = iso(t.deadline);
        if (stages.length) {
            start = stages.reduce(function(a,s){ var v = iso(s.start); return !a || v < a ? v : a; }, '');
            end = stages.reduce(function(a,s){ var v = iso(s.end) || iso(s.start); return v > a ? v : a; }, '');
        } else if (t.stages && typeof t.stages === 'object') {
            Object.keys(t.stages).forEach(function(k){
                var v = iso(t.stages[k]);
                if (v && (!start || v < start)) start = v;
                if (v && (!end || v > end)) end = v;
            });
        }
        start = start || end;
        end = end || start;
        return start && end && start <= end ? { start:start, end:end } : null;
    }

    function plan2027LoadMatrix(audits, deps, pocketKey){
        var rows = deps.map(function(dep){ return { dep:dep, counts:Array(12).fill(0) }; });
        var rowById = new Map();
        rows.forEach(function(row){ rowById.set(String(row.dep.id), row); });
        audits.forEach(function(t){
            if (pocketKey && plan2027TaskDir(t) + '|' + String(t.pocket || '').trim() !== pocketKey) return;
            var bounds = plan2027LoadAuditBounds(t);
            if (!bounds) return;
            var ids = Array.isArray(t.department_ids) && t.department_ids.length ? t.department_ids : [t.lead_department];
            // One audit contributes at most once per bank/month, regardless of stages/shares/lead coefficient.
            new Set(ids.filter(function(id){ return id !== undefined && id !== null && id !== ''; }).map(String)).forEach(function(id){
                var row = rowById.get(id);
                if (!row) return;
                for (var m = 0; m < 12; m++) {
                    var first = P27_YEAR + '-' + String(m + 1).padStart(2, '0') + '-01';
                    var last = P27_YEAR + '-' + String(m + 1).padStart(2, '0') + '-' + new Date(P27_YEAR, m + 1, 0).getDate();
                    if (bounds.start <= last && bounds.end >= first) row.counts[m]++;
                }
            });
        });
        return rows;
    }

    function plan2027LoadHeatmap(title, rows, maxCount, key){
        var html = '<section class="p27-heatmap" data-load-scope="' + key + '"><h3>' + escapeHtml(title) + '</h3>';
        if (!rows.length) return html + '<div class="p27-load-empty">Справочник банков пуст — данные загружаются…</div></section>';
        html += '<table class="p27-load-table"><caption class="p27-load-sr">' + escapeHtml(title) + ' — число проверок по банкам и месяцам 2027 года</caption>'
            + '<colgroup><col class="p27-load-bank-col"><col span="12"></colgroup><thead><tr><th scope="col">ТБ</th>';
        P27_MON.forEach(function(month){ html += '<th scope="col">' + escapeHtml(month) + '</th>'; });
        html += '</tr></thead><tbody>';
        rows.forEach(function(row){
            var name = row.dep.name || row.dep.id;
            html += '<tr><th scope="row" title="' + escapeHtml(name) + '">' + escapeHtml(p27Short(row.dep)) + '</th>';
            row.counts.forEach(function(count,m){
                var level = count ? Math.max(1, Math.ceil(count / Math.max(1, maxCount) * 5)) : 0;
                var label = name + ' · ' + P27_MON[m] + ' 2027: ' + count;
                html += '<td data-count="' + count + '" data-level="' + level + '" title="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label) + '">' + count + '</td>';
            });
            html += '</tr>';
        });
        return html + '</tbody></table></section>';
    }

    function renderLoad(){
        var box = byId('plan2027LoadContainer');
        if (!box) return;
        var histogram = stateDash.plan2027LoadView === 'histograms';
        box.classList.toggle('p27-load-histograms', histogram);
        box.classList.toggle('p27-load-heatmaps', !histogram);
        box.innerHTML = '<div class="dash-load-head p27-load-head"><div class="dash-load-title">Нагрузка на ТБ</div>'
            + '<button id="plan2027LoadToggle" class="p27-load-toggle" type="button" aria-expanded="' + histogram + '" aria-controls="plan2027LoadBody"'
            + ' title="' + (histogram ? 'Вернуться к тепловым картам' : 'Показать гистограммы') + '" aria-label="'
            + (histogram ? 'Вернуться к тепловым картам' : 'Показать гистограммы') + '">' + (histogram ? '«' : '»') + '</button></div>'
            + '<div id="plan2027LoadBody" class="p27-load-body"></div>';
        var body = byId('plan2027LoadBody');
        if (histogram) {
            // Legacy weighted calculators close over global state and have no pocket argument.
            // Keep their behaviour explicit rather than offer a selector that cannot filter correctly.
            body.innerHTML = '<p class="p27-load-note">Гистограммы · все карманы. Взвешенная нагрузка по текущим фильтрам; фильтр кармана не применяется.</p>';
            var holder = document.createElement('div');
            renderHistograms(holder);
            var oldHead = holder.querySelector('.dash-load-head');
            if (oldHead) oldHead.remove();
            while (holder.firstChild) body.appendChild(holder.firstChild); // Preserve histogram event handlers.
        } else {
            var allDeps = st().departments || [];
            var deps = allDeps.slice(0, 11);
            var audits = plan2027LoadAudits();
            var key = String(stateDash.selectedPocketKey || '');
            var allRows = plan2027LoadMatrix(audits, deps, '');
            var maxCount = allRows.reduce(function(max,row){ return Math.max.apply(Math, [max].concat(row.counts)); }, 0);
            body.innerHTML = '<p class="p27-load-note">2027 · число проверок · зелёный = свободно, тёмно-красный = максимум. С учётом черновиков.</p>'
                + plan2027LoadHeatmap('Все проверки · все направления', allRows, maxCount, 'all');
            if (key) {
                var split = key.indexOf('|');
                var dir = key.slice(0, split), pocket = key.slice(split + 1);
                body.insertAdjacentHTML('beforeend', plan2027LoadHeatmap('Карман: ' + (pocket || 'Без кармана') + ' · ' + (DASH_DIR_LABEL[dir] || dir), plan2027LoadMatrix(audits, deps, key), maxCount, 'pocket'));
            } else {
                body.insertAdjacentHTML('beforeend', '<section class="p27-heatmap" data-load-scope="pocket"><h3>Выбранный карман</h3><div class="p27-load-empty">Выберите карман слева</div></section>');
            }
            if (allDeps.length > deps.length) body.insertAdjacentHTML('beforeend', '<p class="p27-load-note">Показаны первые 11 банков из ' + allDeps.length + '.</p>');
        }
        byId('plan2027LoadToggle').onclick = function(){
            stateDash.plan2027LoadView = histogram ? 'heatmaps' : 'histograms';
            renderLoad();
            var toggle = byId('plan2027LoadToggle');
            if (toggle) toggle.focus();
        };
    }

    function renderHistograms(target){
        var box = target || byId('plan2027LoadContainer');
        if (!box) return;
        var allDeps = st().departments || [];
        if (!allDeps.length) {
            box.innerHTML = '<div class="dash-empty">Справочник банков пуст — данные загружаются…</div>';
            return;
        }
        var drafts = plan2027DraftsForLoad();
        var depMap = {};
        drafts.forEach(function(d){ ((d && d.department_ids) || []).forEach(function(id){ depMap[id] = 1; }); });
        // Раскрыты автоматически банки, которые стоят на осях слева.
        // Ручной выбор (plan2027BankOpen) сохраняется, пока банк не добавят на ось заново.
        stateDash.plan2027BankOpen = stateDash.plan2027BankOpen || {};
        var prevDepMap = stateDash.plan2027PrevDepMap || {};
        Object.keys(depMap).forEach(function(id){ if (!prevDepMap[id]) delete stateDash.plan2027BankOpen[id]; });
        stateDash.plan2027PrevDepMap = depMap;
        function isBankOpen(id){
            var m = stateDash.plan2027BankOpen[id];
            return (m === true || m === false) ? m : !!depMap[id];
        }
        var shownDeps = allDeps.filter(function(d){ return depMap[d.id]; })
            .concat(allDeps.filter(function(d){ return !depMap[d.id]; }));
        var CH = Math.round(103 * DASH_DENSITY); // compact geometry; labels keep their original font
        var offsets = plan2027LoadOffsets();
        var slotGroups = offsets.map(function(off){ return { offset: off, slots: plan2027Slots(off) }; });

        var cards = shownDeps.map(function(dep){
            var depId = dep.id;
            var calcDir = (stateDash.dir === 'corp' || stateDash.dir === 'retail') ? stateDash.dir : 'retail';
            var poss = calcPossible(dep, calcDir);
            var inDraft = !!depMap[depId];
            var open = isBankOpen(depId);
            var lead = false;
            drafts.forEach(function(d){
                if (d && d.lead_department === depId && (d.department_ids || []).indexOf(depId) >= 0) lead = true;
            });
            var head = '<div class="dash-bank-head" data-bank-toggle="' + escapeHtml(depId) + '">'
                + '<button class="dash-bank-toggle" type="button" title="' + (open ? 'Скрыть' : 'Показать') + '" aria-expanded="' + (open ? 'true' : 'false') + '">' + (open ? '▾' : '▸') + '</button>'
                + '<div class="dash-bank-name">' + escapeHtml(dep.name || dep.id) + '</div>'
                + (lead ? '<span class="dash-badge lead">Руководитель</span>' : '')
                + '</div>';
            if (!open) {
                return '<div class="dash-bank-card is-collapsed' + (inDraft ? ' active' : '') + '">' + head + '</div>';
            }
            var vals = [];
            slotGroups.forEach(function(group){
                group.slots.forEach(function(slot){
                    var base = plan2027BaseLoad(depId, slot);
                    var draft = plan2027DraftStageLoad(slot.start, slot.end, depId);
                    vals.push({ slot: slot, total: Math.round((base + draft) * 100) / 100, base: base, draft: draft });
                });
            });
            // Верх шкалы = самый высокий столбик или лимит, без запаса сверху.
            var maxVal = vals.reduce(function(m, v){ return Math.max(m, v.total); }, poss || 0);
            if (!(maxVal > 0)) maxVal = 1;
            var today = todayISO();
            var bars = vals.map(function(v){
                var h = v.total > 0 ? Math.min(CH, Math.max(8, Math.round((v.total / maxVal) * CH))) : 3;
                var cls = '';
                if (poss !== null) {
                    if (v.total > poss) cls = ' over';
                    else if (v.total >= poss * 0.8) cls = ' warn';
                }
                var isToday = today >= ymd(v.slot.start) && today <= ymd(v.slot.end);
                var title = escapeHtml((v.slot.label || '') + ': нагрузка ' + fmtNum(v.total)
                    + (v.base ? ' · база ' + fmtNum(v.base) : '')
                    + (v.draft ? ' · черновик +' + fmtNum(v.draft) : '')
                    + (poss !== null ? ' · лимит ' + fmtNum(poss) : ''));
                return '<div class="dash-mini-col' + cls + (isToday ? ' is-today' : '') + '" title="' + title + '">'
                    + '<div class="dash-mini-bar" style="height:' + h + 'px"></div>'
                    + '</div>';
            }).join('');
            var grid = '';
            for (var i = 1; i <= 4; i++) {
                grid += '<div class="dash-grid-line" style="bottom:' + Math.round((i / 5) * CH) + 'px;"></div>';
            }
            if (poss !== null && poss > 0) {
                var possY = Math.round((poss / maxVal) * CH);
                // если над лимитом нет места, подпись ставим под линией
                var lblPos = (possY + 14 > CH) ? ('top:' + (CH - possY + 2) + 'px;') : ('bottom:' + (possY + 2) + 'px;');
                grid += '<div class="dash-limit-zone" style="bottom:' + possY + 'px;"></div>';
                grid += '<div class="dash-limit-line" style="bottom:' + possY + 'px;"></div>';
                grid += '<div class="dash-limit-label" style="' + lblPos + ' right:2px; position:absolute; color:rgba(239, 68, 68, 0.8); font-size:0.65rem; font-weight:600; line-height:1; z-index:3;">' + fmtNum(poss) + '</div>';
            }
            return '<div class="dash-bank-card' + (inDraft ? ' active' : '') + '">'
                + head
                + '<div class="dash-mini-chart-wrap" style="height:' + CH + 'px;">'
                + grid
                + '<div class="dash-mini-chart" style="position:relative; z-index:2; height:' + CH + 'px;">' + bars + '</div>'
                + '</div>'
                + '</div>';
        }).join('');

        box.innerHTML = ''
            + '<div class="dash-load-head">'
                + '<div class="dash-load-title">Нагрузка на ТБ</div>'
            + '</div>'
            + '<div class="dash-bank-grid">' + cards + '</div>';

        box.querySelectorAll('[data-bank-toggle]').forEach(function(el){
            el.onclick = function(ev){
                if (ev) ev.stopPropagation();
                var id = this.getAttribute('data-bank-toggle');
                stateDash.plan2027BankOpen[id] = !isBankOpen(id);
                renderLoad();
            };
        });

        box.querySelectorAll('[data-act]').forEach(function(btn){
            btn.onclick = function(){
                var depId = this.getAttribute('data-dep');
                var act = this.getAttribute('data-act');
                if (!stateDash.draft) return;
                if (act === 'add') {
                    var cur = (stateDash.draft.department_ids || []).slice();
                    if (cur.indexOf(depId) < 0) cur.push(depId);
                    stateDash.draft.department_ids = cur;
                    stateDash.draft.department_shares = stateDash.draft.department_shares || {};
                    if (stateDash.draft.department_shares[depId] == null) stateDash.draft.department_shares[depId] = 100;
                    if (!stateDash.draft.lead_department) stateDash.draft.lead_department = depId;
                } else if (act === 'remove') {
                    stateDash.draft.department_ids = (stateDash.draft.department_ids || []).filter(function(id){ return id !== depId; });
                    if (stateDash.draft.lead_department === depId) {
                        stateDash.draft.lead_department = stateDash.draft.department_ids[0] || '';
                    }
                } else if (act === 'lead') {
                    stateDash.draft.lead_department = (stateDash.draft.lead_department === depId) ? '' : depId;
                } else if (act === 'share') {
                    var curVal = (stateDash.draft.department_shares && stateDash.draft.department_shares[depId] != null)
                        ? stateDash.draft.department_shares[depId] : 100;
                    var val = window.prompt('Доля участия банка, %', String(curVal));
                    if (val === null) return;
                    var n = Number(String(val).replace(',', '.'));
                    if (!isFinite(n) || n <= 0) { notify('Введите число больше 0', 'error'); return; }
                    stateDash.draft.department_shares = stateDash.draft.department_shares || {};
                    stateDash.draft.department_shares[depId] = Math.round(n * 100) / 100;
                }
                renderGantt();
                renderLoad();
            };
        });
    }

    /* ===== Сохранение песочницы: все оси, сводка изменений, подтверждение (09.11.2026) ===== */
    function plan2027FmtD(iso){
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
        return m ? (m[3] + '.' + m[2] + '.' + m[1]) : '—';
    }
    function plan2027DepName(id){ var d = deptById(id); return d ? (d.name || id) : (id || '—'); }
    function plan2027StageMap(stages){
        var out = {};
        if (Array.isArray(stages)) {
            stages.forEach(function(x){ if (x && x.key && x.start) out[x.key] = x.start; });
        } else if (stages && typeof stages === 'object') {
            Object.keys(stages).forEach(function(k){ if (stages[k]) out[k] = stages[k]; });
        }
        return out;
    }
    function plan2027BuildPayload(d, orig){
        var base = orig ? clone(orig) : {};
        var normStages = plan2027NormalizeStages(d);
        var stageStarts = {};
        var prevDate = '';
        normStages.forEach(function(s){
            if (!s.key || !s.start) return;
            var dt = s.start;
            if (prevDate && dt <= prevDate) dt = addDaysISO(prevDate, 1);
            stageStarts[s.key] = dt;
            prevDate = dt;
        });
        var isNew = !(d.id || base.id);
        var leadDep = d.lead_department;
        if (!leadDep || (d.department_ids || []).indexOf(leadDep) < 0) leadDep = (d.department_ids || [])[0] || '';
        return {
            id: d.id || (base.id || ''),
            name: (d.name || '').trim(),
            icon: base.icon || '📋',
            description: base.description || '',
            // Новая проверка из песочницы всегда создаётся в статусе «Планирование»
            status: isNew ? 'planning' : (base.status || 'planning'),
            start_date: d.start_date || todayISO(),
            deadline: d.deadline || addDaysISO(d.start_date || todayISO(), 90),
            completed_at: base.completed_at || '',
            folder: base.folder || '',
            order_ref: base.order_ref || '',
            tags: (base.tags || []).slice(),
            assignees: (base.assignees || base.assignee_ids || []).slice(),
            department_ids: (d.department_ids || []).slice(),
            task_kind: 'audit',
            load_coef: base.load_coef || 0,
            lead_department: leadDep,
            lead_employee: base.lead_employee || '',
            is_urgent: !!base.is_urgent,
            links: (base.links || []).slice(),
            orders: (base.orders || []).slice(),
            task_type: d.task_type || base.task_type || (stateDash.dir !== 'all' ? dirTaskType(stateDash.dir) : 'розничная'),
            pocket: (d.pocket !== undefined && d.pocket !== null && d.pocket !== '') ? d.pocket : (base.pocket || ''),
            curator: isNew ? (d.curator || 'нет') : (base.curator || d.curator || ''),
            department_shares: clone(d.department_shares || {}),
            stages: stageStarts,
            force_duplicate: true
        };
    }
    function plan2027DiffLines(orig, p){
        var L = [];
        if (!orig) {
            L.push('статус: Планирование');
            L.push('сроки: ' + plan2027FmtD(p.start_date) + ' → ' + plan2027FmtD(p.deadline));
            if (p.task_type) L.push('направление: ' + p.task_type);
            if (p.pocket) L.push('карман: ' + p.pocket);
            L.push('банки: ' + (p.department_ids.map(plan2027DepName).join(', ') || '—'));
            if (p.lead_department) L.push('банк-руководитель: ' + plan2027DepName(p.lead_department));
            var ks = STAGE_ORDER.filter(function(k){ return p.stages[k]; });
            if (ks.length) L.push('этапы: ' + ks.map(function(k){ return stageLabel(k) + ' с ' + plan2027FmtD(p.stages[k]); }).join('; '));
            return L;
        }
        if ((orig.name || '') !== p.name) L.push('название: «' + (orig.name || '—') + '» → «' + p.name + '»');
        if ((orig.start_date || '') !== p.start_date) L.push('дата начала: ' + plan2027FmtD(orig.start_date) + ' → ' + plan2027FmtD(p.start_date));
        if ((orig.deadline || '') !== p.deadline) L.push('дедлайн: ' + plan2027FmtD(orig.deadline) + ' → ' + plan2027FmtD(p.deadline));
        var os = plan2027StageMap(orig.stages), ns = p.stages;
        var origHasStages = Object.keys(os).length > 0;
        STAGE_ORDER.concat(Object.keys(ns).filter(function(k){ return STAGE_ORDER.indexOf(k) < 0; })).forEach(function(k){
            var a = os[k] || '', b = ns[k] || '';
            if (a === b) return;
            // Этап по умолчанию, который песочница подставляет проверке без этапов, — не изменение
            if (!origHasStages && !a && k === DASH_STAGE_KEY_DEFAULT && b === p.start_date) return;
            if (!a) L.push('добавлен этап «' + stageLabel(k) + '» с ' + plan2027FmtD(b));
            else if (!b) L.push('убран этап «' + stageLabel(k) + '»');
            else L.push('этап «' + stageLabel(k) + '»: начало ' + plan2027FmtD(a) + ' → ' + plan2027FmtD(b));
        });
        var od = Array.isArray(orig.department_ids) ? orig.department_ids : [];
        p.department_ids.filter(function(x){ return od.indexOf(x) < 0; }).forEach(function(x){ L.push('добавлен банк «' + plan2027DepName(x) + '»'); });
        od.filter(function(x){ return p.department_ids.indexOf(x) < 0; }).forEach(function(x){ L.push('убран банк «' + plan2027DepName(x) + '»'); });
        if ((orig.lead_department || '') !== p.lead_department) {
            L.push('банк-руководитель: ' + (orig.lead_department ? '«' + plan2027DepName(orig.lead_department) + '»' : 'не указан') + ' → ' + (p.lead_department ? '«' + plan2027DepName(p.lead_department) + '»' : 'не указан'));
        }
        var osh = orig.department_shares || {};
        p.department_ids.filter(function(x){ return od.indexOf(x) >= 0; }).forEach(function(x){
            var a = (osh[x] == null || osh[x] === '') ? 100 : Number(osh[x]);
            var b = (p.department_shares[x] == null || p.department_shares[x] === '') ? 100 : Number(p.department_shares[x]);
            if (a !== b) L.push('доля банка «' + plan2027DepName(x) + '»: ' + fmtNum(a) + '% → ' + fmtNum(b) + '%');
        });
        if ((orig.task_type || '') !== (p.task_type || '')) L.push('направление: ' + (orig.task_type || '—') + ' → ' + (p.task_type || '—'));
        if ((orig.pocket || '') !== (p.pocket || '')) L.push('карман: ' + (orig.pocket || '—') + ' → ' + (p.pocket || '—'));
        if ((orig.curator || '') !== (p.curator || '')) L.push('куратор ЦА: ' + (orig.curator || '—') + ' → ' + (p.curator || '—'));
        return L;
    }
    function plan2027CollectChanges(){
        syncLane();
        var lanes = (Array.isArray(stateDash.lanes) && stateDash.lanes.length) ? stateDash.lanes : [{ task: stateDash.task, draft: stateDash.draft }];
        var items = [], errors = [], seen = {};
        lanes.forEach(function(l, li){
            if (!l || !l.draft) return;
            var d = l.draft;
            if (d.id) { if (seen[d.id]) return; seen[d.id] = 1; }
            var axis = 'Ось ' + (li + 1);
            if (!(d.name || '').trim()) { errors.push(axis + ': не указано название проверки'); return; }
            if (!(d.department_ids || []).length) { errors.push(axis + ' («' + d.name + '»): добавьте хотя бы один банк-участник'); return; }
            var tid = d.id || (l.task && l.task.id) || '';
            var orig = tid ? ((st().tasks || []).find(function(t){ return t.id === tid; }) || null) : null;
            var p = plan2027BuildPayload(d, orig);
            var lines = plan2027DiffLines(orig, p);
            if (orig && !lines.length) return;
            items.push({ lane: li, isNew: !orig, name: p.name, payload: p, lines: lines });
        });
        return { items: items, errors: errors };
    }
    function plan2027CloseSaveConfirm(){
        var ov = byId('plan2027SaveConfirm');
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        document.removeEventListener('keydown', plan2027SaveConfirmEsc);
    }
    function plan2027SaveConfirmEsc(e){ if (e.key === 'Escape') plan2027CloseSaveConfirm(); }
    function plan2027OpenSaveConfirm(items, onYes){
        plan2027CloseSaveConfirm();
        var html = items.map(function(it){
            var head = it.isNew
                ? 'Создаётся проверка «' + escapeHtml(it.name) + '»'
                : 'В проверке «' + escapeHtml(it.name) + '» изменится:';
            return '<div class="dash-sc-item' + (it.isNew ? ' dash-sc-item--new' : '') + '">'
                + '<div class="dash-sc-head">' + (it.isNew ? '✨ ' : '✏️ ') + head + '</div>'
                + '<ul class="dash-sc-list">' + it.lines.map(function(x){ return '<li>' + escapeHtml(x) + '</li>'; }).join('') + '</ul>'
                + '</div>';
        }).join('');
        var ov = document.createElement('div');
        ov.id = 'plan2027SaveConfirm';
        ov.className = 'tsum-confirm-overlay active dash-sc-overlay';
        ov.innerHTML = '<div class="tsum-confirm dash-sc" role="dialog" aria-modal="true">'
            + '<div class="dash-sc-title">Изменения в песочнице планирования</div>'
            + '<div class="dash-sc-body">' + html + '</div>'
            + '<p class="tsum-confirm-text dash-sc-ask">Уверены, что хотите внести данные изменения?</p>'
            + '<div class="tsum-confirm-actions">'
            +   '<button type="button" class="tsum-cbtn tsum-cbtn--no" id="plan2027ScNo">Нет</button>'
            +   '<button type="button" class="tsum-cbtn tsum-cbtn--yes" id="plan2027ScYes">Да</button>'
            + '</div></div>';
        document.body.appendChild(ov);
        ov.addEventListener('mousedown', function(e){ if (e.target === ov) plan2027CloseSaveConfirm(); });
        byId('plan2027ScNo').addEventListener('click', plan2027CloseSaveConfirm);
        byId('plan2027ScYes').addEventListener('click', function(){ plan2027CloseSaveConfirm(); onYes(); });
        document.addEventListener('keydown', plan2027SaveConfirmEsc);
        setTimeout(function(){ var y = byId('plan2027ScYes'); if (y) y.focus(); }, 30);
    }
    function plan2027RunSave(items){
        var btn = byId('plan2027SaveBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Сохранение…'; }
        var saved = [], failed = null;
        var chain = Promise.resolve();
        items.forEach(function(it){
            var lane=stateDash.lanes[it.lane], draft=lane&&lane.draft;
            chain = chain.then(function(){
                if (failed) return;
                return apiJson('/api/tracker/task/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(it.payload)
                }).then(function(r){
                    if (!r || !r.success) throw new Error((r && (r.message || r.error)) || 'Ошибка сохранения');
                    var id=r.id||it.payload.id;
                    if(!id)throw new Error('Сервер не вернул ID сохранённой проверки');
                    it.payload.id=id;
                    if(draft)draft.id=id;
                    saved.push({ lane: lane, draft: draft, id: id });
                }).catch(function(err){
                    failed = '«' + it.name + '»: ' + ((err && err.message) || 'Ошибка сохранения');
                });
            });
        });
        return chain.then(function(){
            if (!saved.length) return;
            var refreshFn = window.__trkRefreshAll || window.__trkLoadState;
            return (typeof refreshFn === 'function' ? Promise.resolve(refreshFn()) : Promise.resolve()).then(function(){
                var keep = stateDash.activeLane;
                saved.forEach(function(sv){
                    var nt = (st().tasks || []).find(function(t){ return String(t.id) === String(sv.id); });
                    var l = sv.lane;
                    if (nt && l && stateDash.lanes.indexOf(l)>=0 && l.draft===sv.draft) { l.task = nt; l.draft = plan2027BuildDraft(nt); }
                });
                switchLane(Math.min(keep, stateDash.lanes.length - 1));
                syncControls(); renderSelector(); renderGantt(); renderLoad();
            });
        }).then(function(){
            if (failed) {
                notify('❌ ' + failed + (saved.length ? ' (сохранено до ошибки: ' + saved.length + ')' : ''), 'error');
            } else if (window.trkShowCenterMsg) {
                window.trkShowCenterMsg('✅ Изменения сохранены (' + saved.length + ')');
            } else {
                notify('✅ Изменения сохранены (' + saved.length + ')', 'success');
            }
        }).catch(function(err){
            notify('❌ ' + ((err && err.message) || 'Ошибка обновления данных'), 'error');
        }).then(function(){
            var b2 = byId('plan2027SaveBtn');
            if (b2) { b2.disabled = false; b2.textContent = 'Сохранить изменения'; }
        });
    }
    function saveDraft(){
        var res = plan2027CollectChanges();
        if (res.errors.length) { notify(res.errors.join('; '), 'error'); return; }
        if (!res.items.length) {
            var anyDraft = (stateDash.lanes || []).some(function(l){ return l && l.draft; }) || !!stateDash.draft;
            notify(anyDraft ? 'Изменений нет' : 'Сначала выберите проверку или нажмите «+ Создать проверку»', anyDraft ? 'info' : 'error');
            return;
        }
        if (!(window.__trkState && window.__trkState.currentUser && window.__trkState.currentUser.role === 'admin')) { notify('Сохранение доступно только администратору', 'error'); return; }
        var _rd = [];
        res.items.forEach(function(it){
            var tid = it.payload && it.payload.id;
            var orig = tid ? ((st().tasks || []).find(function(t){ return t.id === tid; }) || {}) : {};
            _rd = _rd.concat(window.trkChangedDates ? window.trkChangedDates(orig, it.payload) : []);
        });
        if (window.trkRetroConfirm && !window.trkRetroConfirm(_rd)) return;
        plan2027OpenSaveConfirm(res.items, function(){ plan2027RunSave(res.items); });
    }
    window.__dashCollectChanges = plan2027CollectChanges;

    function bindControls(){
        var pocketSel=byId('plan2027PocketSelector');
        if(pocketSel&&!pocketSel.__p27Bound){pocketSel.__p27Bound=true;pocketSel.addEventListener('change',function(){syncLane();stateDash.p27PocketFilterKey=this.value;stateDash.selectedPocketKey=this.value;renderGantt();renderLoad();});}

        var btn = byId('tabPlan2027Btn');
        if (btn && !btn.__dashBound) {
            btn.__dashBound = true;
            btn.addEventListener('click', function(e){
                e.preventDefault();
                activatePlan2027Tab();
            });
        }
        var sel = byId('plan2027TaskSelector');
        if (sel && !sel.__dashBound) {
            sel.__dashBound = true;
            sel.addEventListener('focus', function(){ renderSelector(); });
            sel.addEventListener('change', function(){
                var tid = this.value;
                if (!tid) { loadDraft(null); return; }
                if (tid === '__new__') return;
                var task = (st().tasks || []).find(function(x){ return String(x.id) === String(tid); });
                if(task)loadDraft(task);else syncControls();
            });
        }
        var createBtn = byId('plan2027CreateTaskBtn');
        if (createBtn && !createBtn.__dashBound) {
            createBtn.__dashBound = true;
            createBtn.addEventListener('click', function(e){
                e.preventDefault();
                plan2027OpenCreateModal();
            });
        }
        var dirBox = byId('plan2027DirSwitch');
        if (dirBox && !dirBox.__dashBound) {
            dirBox.__dashBound = true;
            dirBox.addEventListener('click', function(e){
                var b = e.target && e.target.closest ? e.target.closest('[data-dir]') : null;
                if (!b) return;
                syncLane();
                stateDash.dir = b.getAttribute('data-dir') || 'all';
                stateDash.selectedPocketKey='';
                stateDash.p27PocketFilterKey='';
                syncControls();
                renderSelector();
                renderGantt();
                renderLoad();
            });
        }
        var sortSel = byId('plan2027SortSelector');
        if (sortSel && !sortSel.__dashBound) {
            sortSel.__dashBound = true;
            sortSel.value = p27SortMode();
            sortSel.addEventListener('change', function(){
                syncLane();
                stateDash.p27Sort = P27_SORTS.hasOwnProperty(this.value) ? this.value : 'dir';
                renderGantt();
            });
        }
        var modeBox = byId('plan2027ModeSwitch');
        if (modeBox && !modeBox.__dashBound) {
            modeBox.__dashBound = true;
            modeBox.addEventListener('click', function(e){
                var b = e.target && e.target.closest ? e.target.closest('[data-mode]') : null;
                if (!b) return;
                stateDash.mode = b.getAttribute('data-mode') || 'medium';
                stateDash.globalOffset = plan2027ClampGlobalOffset(stateDash.globalOffset || 0);
                syncControls();
                renderGantt();
                renderLoad();
            });
        }
        var slider = byId('plan2027TodaySlider');
        if (slider && !slider.__dashBound) {
            slider.__dashBound = true;
            slider.addEventListener('input', function(){
                stateDash.todayOffset = +this.value || 0;
                syncControls();
                renderGantt();
                renderLoad();
            });
        }
        var pkBtn = byId('plan2027PocketsBtn');
        if (pkBtn && !pkBtn.__dashBound) {
            pkBtn.__dashBound = true;
            pkBtn.addEventListener('click', function(e){
                e.preventDefault();
                if (typeof window.trkOpenPockets === 'function') window.trkOpenPockets({ year: P27_YEAR, editor: true });
                else notify('Плагин «Карманы» не загружен', 'error');
            });
        }
        var saveBtn = byId('plan2027SaveBtn');
        if (saveBtn && !saveBtn.__dashBound) {
            saveBtn.__dashBound = true;
            saveBtn.addEventListener('click', function(e){
                e.preventDefault();
                saveDraft();
            });
        }
    }

    var _waitCount = 0;
    function waitStateAndRefresh(){
        var hasData = (st().tasks && st().tasks.length) || (st().departments && st().departments.length);
        if (hasData) {
            renderSelector();
            syncControls();
            renderPlan2027Layout();
            renderGantt();
            renderLoad();
            return;
        }
        if (_waitCount++ < 35) {
            setTimeout(waitStateAndRefresh, 300);
        }
    }

    function renderPlan2027Layout(){
        var panel = byId('panel-plan2027');
        if (!panel) return;
        var toolbar = byId('plan2027Toolbar') || panel.querySelector('.dash-toolbar');
        var selector = byId('plan2027SelectorRow') || panel.querySelector('.dash-topbar');
        var gantt = byId('plan2027GanttContainer');
        var load = byId('plan2027LoadContainer');
        if (!gantt || !load) return;

        var split = panel.querySelector('.dash-split-wrap');
        if (!split) return;

        var mainPane = split.querySelector('.dash-main-pane');
        var sidePane = split.querySelector('.dash-side-pane');
        if (!mainPane || !sidePane) return;

        if (toolbar && toolbar.parentNode !== mainPane) {
            mainPane.insertBefore(toolbar, mainPane.firstChild || null);
        }
        if (selector && selector.parentNode !== mainPane) {
            if (toolbar && toolbar.parentNode === mainPane) {
                mainPane.insertBefore(selector, toolbar.nextSibling || null);
            } else {
                mainPane.insertBefore(selector, mainPane.firstChild || null);
            }
        }
        if (gantt.parentNode !== mainPane) mainPane.appendChild(gantt);
        if (load.parentNode !== sidePane) sidePane.appendChild(load);
    }

    function boot(){
        var main = document.querySelector('#panel-plan2027 .dash-main-pane');
        if (main && window.ResizeObserver) new ResizeObserver(plan2027ScheduleTicks).observe(main);
        window.addEventListener('resize', plan2027ScheduleTicks);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(plan2027ScheduleTicks);
        ensurePlan2027Tab();
        p27FetchPockets();
        bindControls();
        renderSelector();
        syncControls();
        renderPlan2027Layout();
        renderGantt();
        renderLoad();
        waitStateAndRefresh();
    }
    window.__plan2027Render = { activate: function(){
        p27FetchPockets();
        bindControls(); renderSelector(); syncControls(); renderPlan2027Layout(); renderGantt(); renderLoad();
    } };
    document.addEventListener('trk:pockets-changed', function(){
        p27FetchPockets();
        if (byId('panel-plan2027') && byId('panel-plan2027').classList.contains('active')) { renderSelector(); renderGantt(); renderLoad(); }
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    document.addEventListener('click', function(e){
        if (e.target && e.target.closest && e.target.closest('.tracker-tab[data-tab="plan2027"]')) {
            setTimeout(function(){
                bindControls();
                renderSelector();
                syncControls();
                renderPlan2027Layout();
                renderGantt();
                renderLoad();
            }, 40);
        }
    });
})();




/* ============================================================
   PATCH 2026-11-02 — nesting tabs: Employees menu + inline dashboards
   ============================================================ */
(function(){
'use strict';
if (window.__trkNestedTabsV20261102) return;
window.__trkNestedTabsV20261102 = true;

window.loadVacationTab = window.loadVacationTab || function(){
    if (window.__trkVacTabV3Activate) { try { window.__trkVacTabV3Activate(); } catch(e){} }
};
window.loadDicts = window.loadDicts || function(){};

function setActiveTab(tab){
    var employeeTabs = { heatmap:true, vacations:true, dicts:true };
    document.querySelectorAll('.tracker-panel').forEach(function(p){
        p.classList.toggle('active', p.id === 'panel-' + tab);
    });
    document.querySelectorAll('.tracker-tab').forEach(function(btn){
        var btab = btn.getAttribute('data-tab') || '';
        btn.classList.toggle('active', btab === tab);
    });
    var empBtn = document.getElementById('employeesTabBtn');
    if (empBtn) empBtn.classList.toggle('active', !!employeeTabs[tab]);
    try { localStorage.setItem('tracker_activeTab', tab); } catch(e){}
    if (tab === 'tasks' && typeof renderTasksFull === 'function') { try { renderTasksFull(); } catch(e){} }
    if (tab === 'completed' && typeof window.renderCompletedFull === 'function') { try { window.renderCompletedFull(); } catch(e){} }
    if (tab === 'heatmap' && typeof window.loadHeatmap === 'function') { try { window.loadHeatmap(); } catch(e){} }
    if (tab === 'heatmap' && typeof window.__hmEmpLoad === 'function') { try { window.__hmEmpLoad(); } catch(e){} }
    if (tab === 'vacations' && typeof window.loadVacationTab === 'function') { try { window.loadVacationTab(); } catch(e){} }
    if (tab === 'dicts' && typeof window.loadDicts === 'function') { try { window.loadDicts(); } catch(e){} }
    if (tab === 'dashboards' && window.__dashRender && typeof window.__dashRender.activate === 'function') {
        try { window.__dashRender.activate(); } catch(e){}
    }
    if (tab === 'plan2027' && window.__plan2027Render && typeof window.__plan2027Render.activate === 'function') {
        try { window.__plan2027Render.activate(); } catch(e){}
    }
}

function closeEmployeesMenu(){
    var wrap = document.getElementById('employeesTabMenu');
    if (wrap) wrap.classList.remove('open');
}

document.addEventListener('click', function(e){
    var menuBtn = e.target && e.target.closest ? e.target.closest('#employeesTabBtn') : null;
    if (menuBtn) {
        e.preventDefault();
        e.stopPropagation();
        var wrap = document.getElementById('employeesTabMenu');
        if (wrap) wrap.classList.toggle('open');
        return;
    }
    var menuItem = e.target && e.target.closest ? e.target.closest('#employeesTabDropdown [data-target-tab]') : null;
    if (menuItem) {
        e.preventDefault();
        e.stopPropagation();
        setActiveTab(menuItem.getAttribute('data-target-tab') || 'heatmap');
        closeEmployeesMenu();
        return;
    }
    if (!e.target || !e.target.closest || !e.target.closest('#employeesTabMenu')) closeEmployeesMenu();
}, true);

document.addEventListener('click', function(e){
    var btn = e.target && e.target.closest ? e.target.closest('#openDashboardsInlineBtn') : null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    setActiveTab('dashboards');
}, true);

document.addEventListener('click', function(e){
    var btn = e.target && e.target.closest ? e.target.closest('#openPlan2027InlineBtn') : null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    setActiveTab('plan2027');
}, true);

document.addEventListener('click', function(e){
    var btn = e.target && e.target.closest ? e.target.closest('.tracker-tab[data-tab]') : null;
    if (!btn || btn.getAttribute('data-tab') === 'dashboards' || btn.getAttribute('data-tab') === 'plan2027') return;
    // Existing navigation owns the other tabs.
});

// The two independent Sandbox tabs use the same visual controls but their own DOM/state.
document.addEventListener('click', function(e){
    var btn = e.target && e.target.closest ? e.target.closest('.tracker-tab[data-tab="dashboards"]') : null;
    if (btn) { e.preventDefault(); e.stopPropagation(); setActiveTab('dashboards'); }
}, true);
document.addEventListener('click', function(e){
    var btn = e.target && e.target.closest ? e.target.closest('.tracker-tab[data-tab="plan2027"]') : null;
    if (btn) { e.preventDefault(); e.stopPropagation(); setActiveTab('plan2027'); }
}, true);
})();


document.addEventListener('click', function(e) {
    if (!e.target || !e.target.closest) return;
    var _ntf = function(m, k){ if (window.trkNotify) window.trkNotify(m, k); };
    var cbtn = e.target.closest('#confirmExtendBtn');
    if (cbtn) {
        if (cbtn.disabled) return;
        var em = document.getElementById('extendTaskModal');
        var tidEl = document.getElementById('task_id');
        var tid = (em && em.getAttribute('data-task-id')) || (tidEl ? tidEl.value : '') || '';
        var days = parseInt(document.getElementById('extendDays').value, 10);
        var comment = document.getElementById('extendComment').value;
        if (!tid) { _ntf('❌ Не выбрана проверка', 'error'); return; }
        if (!days || days <= 0) { _ntf('❌ Укажите число дней больше нуля', 'error'); return; }
        cbtn.disabled = true;
        window.trkApiJson('/api/tracker/task/extend', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({id: tid, days: days, comment: comment})
        }).then(function(d) {
            cbtn.disabled = false;
            if (d && d.success) {
                if (em) em.classList.remove('active');
                var tm = document.getElementById('taskModal'); if (tm) tm.classList.remove('active');
                var sm = document.getElementById('taskSummaryModal');
                var reopen = sm && sm.classList.contains('active') && String(sm.getAttribute('data-task-id')) === String(tid);
                if (window.trkShowCenterMsg) window.trkShowCenterMsg('✅ Продление сделано успешно');
                else _ntf('✅ Продление сделано успешно');
                Promise.resolve(typeof window.__trkRefreshAll === 'function' ? window.__trkRefreshAll() : null).then(function() {
                    if (reopen && window.trkReopenTaskSummary) window.trkReopenTaskSummary(tid);
                });
            } else {
                _ntf('❌ ' + ((d && d.error) || 'Ошибка'), 'error');
            }
        }).catch(function() { cbtn.disabled = false; _ntf('❌ Не удалось продлить проверку', 'error'); });
        return;
    }
    if (e.target.closest('#taskDatesHistoryBtn')) {
        var hEl = document.getElementById('task_id');
        var hid = hEl ? hEl.value : '';
        if (!hid) { _ntf('Сначала сохраните задачу'); return; }
        window.loadTaskDateHistory(hid);
    }
}, true);


/* PATCH 2026-11-04: «Продлить»/«История» — боковая панель справа поверх карточки задачи */
(function(){
    var IDS = ['extendTaskModal', 'taskDatesModal'];
    function sync() {
        var open = IDS.some(function(id){ var m = document.getElementById(id); return m && m.classList.contains('active'); });
        document.body.classList.toggle('trk-side-panel-open', open);
    }
    function boot() {
        IDS.forEach(function(id){
            var m = document.getElementById(id);
            if (m) new MutationObserver(sync).observe(m, { attributes: true, attributeFilter: ['class'] });
        });
        var HOSTS = ['taskModal', 'taskSummaryModal'];
        function hostChanged() {
            var anyOpen = HOSTS.some(function(id){ var h = document.getElementById(id); return h && h.classList.contains('active'); });
            if (!anyOpen) IDS.forEach(function(id){ var m = document.getElementById(id); if (m) m.classList.remove('active'); });
            sync();
        }
        HOSTS.forEach(function(id){
            var h = document.getElementById(id);
            if (h) new MutationObserver(hostChanged).observe(h, { attributes: true, attributeFilter: ['class'] });
        });
        sync();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

/* === 10.11: сброс фильтров из пустого состояния «Карты проверок» === */
(function(){
    document.addEventListener('click', function(ev){
        var a = ev.target.closest && ev.target.closest('.trk-empty-reset');
        if (!a) return;
        ev.preventDefault();
        var si = document.getElementById('tskSearchInput');
        if (si) { si.value = ''; si.dispatchEvent(new Event('input', { bubbles: true })); }
        document.querySelectorAll('#panel-tasks select').forEach(function(s){ if (s.id !== 'tskSortSel' && s.options.length && s.selectedIndex !== 0) { s.selectedIndex = 0; s.dispatchEvent(new Event('change', { bubbles: true })); } });
        var b = document.querySelector('#tskDirSeg button[data-v=""]'); if (b) b.click();
        var m = document.querySelector('#tskViewMode button[data-mode="all"]'); if (m) m.click();
    });
    /* Узкие экраны: статусы «Карты проверок» — выпадающим списком */
    function buildStatusSelect(){
        var seg = document.getElementById('tskViewMode'); if (!seg || document.getElementById('tskViewModeSel')) return;
        var sel = document.createElement('select'); sel.id = 'tskViewModeSel'; sel.className = 'tsk-mode-sel'; sel.title = 'Статус';
        seg.querySelectorAll('button[data-mode]').forEach(function(b){ var o = document.createElement('option'); o.value = b.getAttribute('data-mode'); o.textContent = b.textContent.trim(); sel.appendChild(o); });
        function sync(){ var a = seg.querySelector('button.active'); if (a) sel.value = a.getAttribute('data-mode'); }
        sel.addEventListener('change', function(){ var b = seg.querySelector('button[data-mode="' + sel.value + '"]'); if (b) b.click(); });
        seg.addEventListener('click', function(){ setTimeout(sync, 0); });
        seg.parentNode.insertBefore(sel, seg.nextSibling); sync();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildStatusSelect); else buildStatusSelect();
})();


/* ===== Песочница: краткая инструкция (всплывающее окно) ===== */
(function(){
    var KEY = 'dash.help.hide';
    function hidden(){ try { return localStorage.getItem(KEY) === '1'; } catch(e){ return false; } }
    function close(){
        var ov = document.getElementById('dashHelpOv'); if (!ov) return;
        var cb = ov.querySelector('#dashHelpHide');
        try { if (cb && cb.checked) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch(e){}
        ov.remove(); document.removeEventListener('keydown', onKey, true);
    }
    function onKey(e){ if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    function open(){
        if (document.getElementById('dashHelpOv')) return;
        var ov = document.createElement('div');
        ov.id = 'dashHelpOv'; ov.className = 'dash-help-ov';
        ov.innerHTML = '<div class="dash-help-box" role="dialog" aria-modal="true" aria-labelledby="dashHelpTitle">'
          + '<button class="dash-help-x" type="button" title="Закрыть">×</button>'
          + '<h3 id="dashHelpTitle">🧪 Песочница — как пользоваться</h3>'
          + '<p class="dash-help-lead">Здесь можно примерить сроки проверок и сразу увидеть, как меняется нагрузка ТБ. В базу ничего не попадает, пока вы не сохраните.</p>'
          + '<ol class="dash-help-list">'
          + '<li><b>Выберите проверку</b> в списке сверху или нажмите «+ Создать проверку» — она появится на оси.</li>'
          + '<li><b>Кликните по оси и тяните.</b> За пустое место — двигается вся проверка, за цветной этап — только этот этап, за край этапа — меняется его длительность.</li>'
          + '<li><b>Следите за гистограммами справа.</b> Нагрузка ТБ пересчитывается прямо во время перетаскивания — видно, где появляется перегруз.</li>'
          + '<li><b>«+ Ось»</b> добавляет ещё одну проверку (до 5), чтобы сравнить их влияние вместе. 📌 закрепляет ось.</li>'
          + '<li><b>«Сохранить изменения»</b> покажет список правок и запишет их только после подтверждения.</li>'
          + '</ol>'
          + '<div class="dash-help-foot"><label><input type="checkbox" id="dashHelpHide"' + (hidden() ? ' checked' : '') + '> Не показывать при входе</label>'
          + '<button class="btn dash-help-ok" type="button">Понятно</button></div>'
          + '</div>';
        document.body.appendChild(ov);
        ov.addEventListener('mousedown', function(e){ if (e.target === ov) close(); });
        ov.querySelector('.dash-help-x').addEventListener('click', close);
        ov.querySelector('.dash-help-ok').addEventListener('click', close);
        document.addEventListener('keydown', onKey, true);
        setTimeout(function(){ var b = ov.querySelector('.dash-help-ok'); if (b) b.focus(); }, 30);
    }
    window.openDashHelp = open;
    function autoShow(){
        if (hidden()) return;
        var p = document.getElementById('panel-dashboards');
        if (p && p.classList.contains('active')) open();
    }
    document.addEventListener('click', function(e){
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('#dashHelpBtn')) { e.preventDefault(); open(); return; }
        if (e.target.closest('#openDashboardsInlineBtn')) setTimeout(autoShow, 350);
    }, true);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(autoShow, 600); });
    else setTimeout(autoShow, 600);
})();

