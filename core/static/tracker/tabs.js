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

    var stateDash = { task:null, mode:'medium', dir:'all', draft:null, lanes:[{task:null,draft:null,offset:0,pinned:false}], activeLane:0, globalOffset:0, leadPickerLane:null };
    var MODE_MONTHS = { small:12, medium:6, large:3 };
    // Compact geometry preserves the original fonts; use native browser zoom.
    var DASH_DENSITY = 0.6;
    // Measure actual rendered labels, not an assumed number of pixels per day.
    function plan2027FitTicks(){
        document.querySelectorAll('#plan2027GanttContainer .dash-tl-axis').forEach(function(axis){
            var right = -Infinity;
            axis.querySelectorAll('.dash-tl-tick').forEach(function(tick){
                tick.style.visibility = '';
                var r = tick.getBoundingClientRect();
                if (r.left < right + 8) tick.style.visibility = 'hidden';
                else right = r.right;
            });
        });
    }
    function plan2027ScheduleTicks(){ window.requestAnimationFrame(plan2027FitTicks); }

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
        draft.stages = plan2027NormalizeStages(draft);
        draft.lead_department = draft.lead_department || (draft.department_ids[0] || '');
        return draft;
    }

    function plan2027CreateDraft(opts){
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
        notify('Черновик «' + draft.name + '» добавлен на ось (' + DASH_DIR_LABEL[dir] + ', ' + DASH_NEW_LENGTH_MONTHS + ' мес: ' + plan2027FmtD(start) + ' → ' + plan2027FmtD(end) + '). В БД он попадёт после «Сохранить изменения»', 'info');
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
        var defDir = stateDash.dir === 'corp' ? 'corp' : 'retail';
        // Список существующих карманов
        function pocketOptsFor(dir){
            var tt = dirTaskType(dir), o = ['<option value="">— Вне кармана —</option>'];
            (window.trkPocketsFor ? window.trkPocketsFor(tt, '') : (window.__trkPocketList || [])).forEach(function(p){ if (p.direction === tt && p.is_active) o.push('<option value="'+escapeHtml(p.name)+'">'+escapeHtml(p.name)+'</option>'); });
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
        stateDash.task = t || null;
        stateDash.draft = t ? plan2027BuildDraft(t) : null;
        syncLane();
        syncControls();
        renderSelector();
        renderGantt();
        renderLoad();
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

    function plan2027GlobalSliderConfig(){
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
        var trackId = isActive ? ' id="plan2027TlTrack"' : '';
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
        plan2027NormalizeStages(d).forEach(function(s){ existing[s.key] = true; });
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
        var c = byId('plan2027GanttContainer');
        if (!c) return;
        stateDash.globalOffset = plan2027ClampGlobalOffset(stateDash.globalOffset || 0);
        var sliderCfg = plan2027GlobalSliderConfig();
        var sliderHtml = '<div class="dash-global-slider-wrap"><input type="range" id="plan2027GlobalSlider" class="dash-global-slider" min="' + sliderCfg.min + '" max="' + sliderCfg.max + '" step="1" value="' + (stateDash.globalOffset || 0) + '"></div>';
        var lanesHtml = stateDash.lanes.map(function(l, i){
            var isActive = (i === stateDash.activeLane);
            return renderLaneBlock(l, i, isActive, plan2027TimeBounds(laneOffset(l)), stateDash.lanes.length > 1, stateDash.lanes.length > 1, !!l.pinned);
        }).join('');
        var addBtn = stateDash.lanes.length < 5 ? '<div class="dash-lanes-foot"><button class="dash-lane-add" type="button" id="plan2027AddLaneBtn">+ Ось</button></div>' : '';
        c.innerHTML = sliderHtml + lanesHtml + addBtn + renderLeadPicker();
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
        c.querySelectorAll('[data-lane-block]').forEach(function(el){ el.addEventListener('pointerdown', function(e){ if (e.target.closest('[data-lane-close]') || e.target.closest('[data-lane-pin]')) return; var li = +this.getAttribute('data-lane-block'); if (li !== stateDash.activeLane) { switchLane(li); renderSelector(); syncControls(); renderGantt(); renderLoad(); } }, true); });
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
                    if (key === 'подготовка') { var ngStg = stg.filter(function(x){ return x.key === DASH_STAGE_KEY_DEFAULT; })[0]; var ngStart = ngStg ? (ngStg.start || stateDash.draft.start_date) : (stateDash.draft.start_date || todayISO()); ne = addDaysISO(ngStart, -1); ns = addDaysISO(ne, -6); }
                    else { ns=addDaysISO(lastEnd,1); ne=addDaysISO(ns,13); }
                    stg.push({key:key,start:ns,end:ne,weight:stageWeight(key)}); if (ne>stateDash.draft.deadline) stateDash.draft.deadline=ne;
                }
                stg.sort(function(a,b){ return STAGE_ORDER.indexOf(a.key) - STAGE_ORDER.indexOf(b.key); });
                for (var k = 1; k < stg.length; k++) { var prev = stg[k-1], cur = stg[k]; if (cur.start <= prev.end) { var curLen = Math.max(1, Math.round((parse(cur.end||cur.start) - parse(cur.start)) / 86400000)); cur.start = addDaysISO(prev.end, 1); cur.end = addDaysISO(cur.start, curLen); } }
                stateDash.draft.stages=stg; syncLane(); renderGantt(); renderLoad();
            });
        });
        c.querySelectorAll('[data-del]').forEach(function(btn){ btn.addEventListener('click', function(e){ e.stopPropagation(); var li=+this.getAttribute('data-lane'); switchLane(li); if (!stateDash.draft) return; var idx=+this.getAttribute('data-del'); var stg=plan2027NormalizeStages(stateDash.draft); if (stg[idx] && stg[idx].key!==DASH_STAGE_KEY_DEFAULT){ stg.splice(idx,1); stateDash.draft.stages=stg; syncLane(); renderGantt(); renderLoad(); } }); });
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

    function renderLoad(){
        var box = byId('plan2027LoadContainer');
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
                    if (nt && l) { l.task = nt; l.draft = plan2027BuildDraft(nt); }
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
                var task = (st().tasks || []).find(function(x){ return x.id === tid; });
                loadDraft(task || null);
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
                stateDash.dir = b.getAttribute('data-dir') || 'all';
                // Сброс выбранной проверки, если её направление не совпадает с фильтром
                if (stateDash.task && !plan2027DirMatch(stateDash.task)) {
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
        bindControls();
        renderSelector();
        syncControls();
        renderPlan2027Layout();
        renderGantt();
        renderLoad();
        waitStateAndRefresh();
    }
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

