// Decides which notifications are due. Pure: no I/O, so it can be tested anywhere.
// Mirrors computeStatus() in index.html, using the household's timezone.

var WINDOW_MIN = 45; // GitHub's cron can run late; a reminder still goes out within this window

function localParts(date, tz){
  var parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  var p = {};
  parts.forEach(function(x){ p[x.type] = x.value; });
  return { day: p.year + '-' + p.month + '-' + p.day, hm: p.hour + ':' + p.minute };
}
function parseDay(s){ var a = s.split('-').map(Number); return new Date(Date.UTC(a[0], a[1]-1, a[2])); }
function dayKey(d){ return d.toISOString().slice(0, 10); }
function addDays(s, n){ var d = parseDay(s); d.setUTCDate(d.getUTCDate() + n); return dayKey(d); }
function weekday(s){ return parseDay(s).getUTCDay(); }
function toMin(hm){ var a = hm.split(':').map(Number); return a[0]*60 + a[1]; }

function startDay(t, tz){ return t.startDate || localParts(new Date(t.createdAt || Date.now()), tz).day; }

function status(t, today, tz){
  var last = t.lastDoneAt ? localParts(new Date(t.lastDoneAt), tz).day : null;
  var doneToday = last === today;
  var due;
  if(t.freqType === 'once'){
    due = t.date || startDay(t, tz);
    if(last) return doneToday ? 'done_today' : 'finished';
  } else if(t.freqType === 'daily'){
    due = last ? addDays(last, 1) : startDay(t, tz);
  } else if(t.freqType === 'weekly'){
    var w = (t.weekdays && t.weekdays.length) ? t.weekdays : [1];
    due = last ? addDays(last, 1) : startDay(t, tz);
    for(var i = 0; i < 8 && w.indexOf(weekday(due)) === -1; i++) due = addDays(due, 1);
  } else {
    due = last ? addDays(last, Math.max(1, t.intervalDays || 7)) : startDay(t, tz);
  }
  if(doneToday) return 'done_today';
  if(due < today) return 'overdue';
  if(due === today) return 'today';
  return 'upcoming';
}

function alertsFor(settings, p){
  var a = (settings.alerts || {})[p] || {};
  return { times: a.times || ['09:00'], overdue: a.overdue !== false, newTask: a.newTask !== false, atTaskTime: a.atTaskTime !== false };
}
function nameOf(settings, p){ return (p === 'A' ? settings.nameA : settings.nameB) || (p === 'A' ? 'Persona A' : 'Persona B'); }
function label(t){ return ((t.icon ? t.icon + ' ' : '') + t.title).trim(); }

// people: list of persons ('A'/'B') with at least one push subscription.
// sent: map of already-sent keys. Returns [{person, key, payload}].
function plan(input){
  var settings = input.settings, tasks = input.tasks, sent = input.sent || {}, now = input.now;
  var tz = settings.tz || 'Europe/Madrid';
  var local = localParts(now, tz), today = local.day, nowMin = toMin(local.hm);
  function within(hm){ var d = nowMin - toMin(hm); return d >= 0 && d < WINDOW_MIN; }
  var out = [];

  input.people.forEach(function(p){
    var a = alertsFor(settings, p);
    function add(key, title, body, tag){
      var k = today + '|' + p + '|' + key;
      if(!sent[k]) out.push({ person: p, key: k, payload: { title: title, body: body, tag: tag || key, url: './' } });
    }
    var active = tasks.filter(function(t){ return t.active !== false; });
    var mine = active.filter(function(t){ return t.assignee === p; })
      .map(function(t){ return { t: t, st: status(t, today, tz) }; })
      .filter(function(x){ return x.st === 'today' || x.st === 'overdue'; });
    var overdue = mine.filter(function(x){ return x.st === 'overdue'; });

    a.times.forEach(function(tm){
      if(!within(tm) || !mine.length) return;
      var title = mine.length === 1 ? 'Tienes 1 tarea pendiente' : 'Tienes ' + mine.length + ' tareas pendientes';
      var body = mine.slice(0, 3).map(function(x){ return label(x.t); }).join(', ') +
        (overdue.length ? ' · ' + overdue.length + ' atrasada' + (overdue.length === 1 ? '' : 's') : '');
      add('time' + tm, title, body, 'resumen');
    });

    if(a.atTaskTime){
      mine.forEach(function(x){
        if(x.st === 'today' && x.t.time && within(x.t.time)){
          add('task' + x.t.id, 'Es hora de: ' + label(x.t), 'Vale ' + (x.t.points || 10) + ' puntos.', 'tarea-' + x.t.id);
        }
      });
    }

    if(a.overdue && overdue.length && nowMin >= toMin('10:00') && nowMin < toMin('21:00')){
      add('overdue', overdue.length === 1 ? 'Tienes 1 tarea atrasada' : 'Tienes ' + overdue.length + ' tareas atrasadas',
        overdue.slice(0, 3).map(function(x){ return label(x.t); }).join(', '), 'atrasadas');
    }

    if(a.newTask){
      active.forEach(function(t){
        if(t.assignee !== p || !t.createdBy || t.createdBy === p || !t.createdAt) return;
        if(now.getTime() - new Date(t.createdAt).getTime() > 2 * 86400000) return;
        var k = 'new|' + t.id + '|' + p;
        if(sent[k]) return;
        var when = t.freqType === 'once' ? (t.date === today ? 'hoy' : t.date) : 'repite';
        out.push({ person: p, key: k, payload: {
          title: nameOf(settings, t.createdBy) + ' te asignó una tarea',
          body: label(t) + ' · ' + when + (t.time ? ' a las ' + t.time : ''),
          tag: 'nueva-' + t.id, url: './'
        }});
      });
    }
  });
  return out;
}

if(typeof module !== 'undefined') module.exports = { plan: plan, status: status, localParts: localParts, WINDOW_MIN: WINDOW_MIN };
