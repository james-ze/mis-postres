import * as DB from './db.js';
'use strict';

/* ============ ESTADO ============ */
var S={catalogo:{},clientes:{},rondas:{},pedidos:{},gastos:{},config:{nombre:'Mis Postres'}};
var tab='inicio', modal=null, filtro='pendientes', dbReady=false, pend=false;
var usuario=null, sinPermiso=null, estadoNube='ok', P={catalogo:{},clientes:{},rondas:{},pedidos:{},gastos:{}};
var METODOS=['Efectivo','Nequi','Daviplata','Transferencia','Otro'];
var CATS=['Ingredientes','Empaques','Domicilios','Publicidad','Utensilios','Servicios','Otros'];
var EMO=['🍰','🧁','🍮','🍓','🍫','🥮','🍪','🎂'];

/* ============ UTILES ============ */
function num(n){
  if(typeof n==='number')return isFinite(n)?n:0;
  if(n==null)return 0;
  var s=String(n).trim().replace(/[^0-9.,-]/g,'');
  if(!s||s==='-')return 0;
  s=s.replace(/\./g,'').replace(/,/g,'.');
  var v=Number(s);
  return isFinite(v)?v:0;
}
function money(n){return '$'+Math.round(num(n)).toLocaleString('es-CO');}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function hoy(){var d=new Date();return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());}
function p2(n){return (n<10?'0':'')+n;}
function fdate(s){if(!s)return '—';var p=String(s).split('-');if(p.length<3)return esc(s);return esc(p[2]+'/'+p[1]);}
function flarga(s){if(!s)return '—';var p=String(s).split('-');if(p.length<3)return esc(s);
  var M=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return esc(Number(p[2])+' '+(M[Number(p[1])-1]||'')+' '+p[0]);}
function dias(s){if(!s)return 9999;var a=new Date(s+'T00:00:00'),b=new Date(hoy()+'T00:00:00');
  return Math.round((a-b)/86400000);}
function sortBy(arr,f,dir){return arr.slice().sort(function(a,b){var x=f(a),y=f(b);
  if(x<y)return dir==='desc'?1:-1; if(x>y)return dir==='desc'?-1:1; return 0;});}

/* ============ CALCULOS ============ */
function costoUnit(s){
  if(!s)return 0;
  var rec=(s.ingredientes||[]).reduce(function(a,i){return a+num(i.c);},0);
  if(rec>0)return rec/Math.max(num(s.rinde)||1,1);
  return num(s.costoManual);
}
function costoReceta(s){return (s&&s.ingredientes||[]).reduce(function(a,i){return a+num(i.c);},0);}
function gananciaUnit(s){return num(s&&s.precio)-costoUnit(s);}
function margen(s){var p=num(s&&s.precio);return p>0?gananciaUnit(s)/p:0;}
function pTotal(p){return (p&&p.items||[]).reduce(function(a,i){return a+num(i.q)*num(i.p);},0);}
function pPagado(p){return (p&&p.pagos||[]).reduce(function(a,x){return a+num(x.v);},0);}
function pSaldo(p){return Math.max(pTotal(p)-pPagado(p),0);}
function pEstado(p){var t=pTotal(p),g=pPagado(p);
  if(t>0&&g>=t)return 'pagado'; if(g>0)return 'abonado'; return 'pendiente';}
function pCosto(p){return (p&&p.items||[]).reduce(function(a,i){return a+num(i.q)*costoUnit(S.catalogo[i.s]);},0);}
function pGanancia(p){return pTotal(p)-pCosto(p);}
function pUnidades(p){return (p&&p.items||[]).reduce(function(a,i){return a+num(i.q);},0);}

function stockDe(rid){
  var r=S.rondas[rid],m={};
  if(!r)return m;
  (r.items||[]).forEach(function(it){m[it.s]={prod:num(it.q),vend:0,merma:0,disp:0};});
  (r.merma||[]).forEach(function(it){if(!m[it.s])m[it.s]={prod:0,vend:0,merma:0,disp:0};m[it.s].merma+=num(it.q);});
  Object.keys(S.pedidos).forEach(function(k){
    (S.pedidos[k].items||[]).forEach(function(it){
      if(it.r!==rid)return;
      if(!m[it.s])m[it.s]={prod:0,vend:0,merma:0,disp:0};
      m[it.s].vend+=num(it.q);
    });
  });
  Object.keys(m).forEach(function(k){m[k].disp=m[k].prod-m[k].vend-m[k].merma;});
  return m;
}
function dispGlobal(sid,excluir){
  var t=0;
  Object.keys(S.rondas).forEach(function(rid){
    var st=stockDe(rid)[sid];
    if(st)t+=st.disp;
  });
  if(excluir)t+=excluir;
  return t;
}
function rondasConStock(sid){
  var out=[];
  Object.keys(S.rondas).forEach(function(rid){
    var st=stockDe(rid)[sid];
    if(st&&st.disp>0)out.push({r:rid,disp:st.disp,f:S.rondas[rid].fecha});
  });
  return sortBy(out,function(x){return x.f;});
}
function costoRonda(r){
  return (r&&r.items||[]).reduce(function(a,i){return a+num(i.q)*costoUnit(S.catalogo[i.s]);},0);
}
function resumenRonda(rid){
  var st=stockDe(rid);
  var o={prod:0,vend:0,merma:0,disp:0,invertido:0,costoVendido:0,costoStock:0,perdidoMerma:0,
         ingresos:0,cobrado:0,porCobrar:0,porSabor:{}};
  Object.keys(st).forEach(function(s){
    var x=st[s],cu=costoUnit(S.catalogo[s]);
    o.prod+=x.prod; o.vend+=x.vend; o.merma+=x.merma; o.disp+=x.disp;
    o.invertido+=x.prod*cu; o.costoVendido+=x.vend*cu;
    o.costoStock+=x.disp*cu; o.perdidoMerma+=x.merma*cu;
    o.porSabor[s]={prod:x.prod,vend:x.vend,merma:x.merma,disp:x.disp,cu:cu,ing:0,gan:0};
  });
  Object.keys(S.pedidos).forEach(function(k){
    var p=S.pedidos[k],tot=pTotal(p),pag=pPagado(p),sub=0;
    (p.items||[]).forEach(function(i){if(i.r===rid)sub+=num(i.q)*num(i.p);});
    if(sub<=0)return;
    o.ingresos+=sub;
    o.cobrado+=tot>0?pag*(sub/tot):0;
    (p.items||[]).forEach(function(i){
      if(i.r!==rid)return;
      var cu=costoUnit(S.catalogo[i.s]);
      if(!o.porSabor[i.s])o.porSabor[i.s]={prod:0,vend:0,merma:0,disp:0,cu:cu,ing:0,gan:0};
      o.porSabor[i.s].ing+=num(i.q)*num(i.p);
      o.porSabor[i.s].gan+=num(i.q)*(num(i.p)-cu);
    });
  });
  o.cobrado=Math.round(o.cobrado);
  o.porCobrar=Math.max(0,o.ingresos-o.cobrado);
  o.ganancia=o.ingresos-o.costoVendido;
  o.resultado=o.ingresos-o.invertido;
  o.faltaRecuperar=Math.max(0,o.invertido-o.ingresos);
  o.pctRecuperado=o.invertido>0?Math.min(100,Math.round(o.ingresos/o.invertido*100)):(o.ingresos>0?100:0);
  o.valorStock=0;
  Object.keys(o.porSabor).forEach(function(s){
    o.valorStock+=o.porSabor[s].disp*num(S.catalogo[s]&&S.catalogo[s].precio);
  });
  o.gananciaPotencial=o.ganancia+(o.valorStock-o.costoStock);
  return o;
}
function totales(){
  var t={ventas:0,cobrado:0,porCobrar:0,gananciaEst:0,gastos:0,pedidos:0,pendEntrega:0,unidades:0};
  Object.keys(S.pedidos).forEach(function(k){
    var p=S.pedidos[k];
    t.ventas+=pTotal(p); t.cobrado+=pPagado(p); t.porCobrar+=pSaldo(p);
    t.gananciaEst+=pGanancia(p); t.pedidos++; t.unidades+=pUnidades(p);
    if(!p.entregado)t.pendEntrega++;
  });
  Object.keys(S.gastos).forEach(function(k){t.gastos+=num(S.gastos[k].valor);});
  t.gananciaReal=t.ventas-t.gastos;
  return t;
}
function ventasPorSabor(){
  var m={};
  Object.keys(S.catalogo).forEach(function(s){m[s]={u:0,v:0,g:0};});
  Object.keys(S.pedidos).forEach(function(k){
    (S.pedidos[k].items||[]).forEach(function(it){
      if(!m[it.s])m[it.s]={u:0,v:0,g:0};
      m[it.s].u+=num(it.q);
      m[it.s].v+=num(it.q)*num(it.p);
      m[it.s].g+=num(it.q)*(num(it.p)-costoUnit(S.catalogo[it.s]));
    });
  });
  return m;
}
function saldosPorCliente(){
  var m={};
  Object.keys(S.pedidos).forEach(function(k){
    var p=S.pedidos[k],s=pSaldo(p);
    if(s<=0)return;
    if(!m[p.clienteId])m[p.clienteId]={saldo:0,n:0};
    m[p.clienteId].saldo+=s; m[p.clienteId].n++;
  });
  return m;
}
function nombreSabor(id){var s=S.catalogo[id];return s?s.nombre:'(sabor borrado)';}
function emoSabor(id){var s=S.catalogo[id];return s&&s.emo?esc(s.emo):'🍰';}
function nombreCliente(id){var c=S.clientes[id];return c?c.nombre:'Sin cliente';}

/* ============ TOAST ============ */
var tmr=null;
function toast(msg,bad){
  var t=document.getElementById('toast');
  t.innerHTML='<div class="toast'+(bad?' bad':'')+'">'+esc(msg)+'</div>';
  clearTimeout(tmr); tmr=setTimeout(function(){t.innerHTML='';},2600);
}

/* ============ GUARDADO EN EL DISPOSITIVO ============ */
function newId(col){return DB.nuevoId(col);}
function aplicarDatos(d,pap){
  d=d||{};
  ['catalogo','clientes','rondas','pedidos','gastos'].forEach(function(c){
    S[c]=(d[c]&&typeof d[c]==='object')?Object.assign({},d[c]):{};
  });
  var cf=d.config&&d.config.app;
  S.config=(cf&&typeof cf==='object')?cf:{nombre:'Mis Postres'};
  if(!S.config.nombre)S.config.nombre='Mis Postres';
  if(pap){P={};Object.keys(pap).forEach(function(c){P[c]=Object.assign({},pap[c]);});}
}
function datosPlanos(){return DB.exportar();}
function save(col,id,data){
  var i=id||newId(col);
  var cuerpo=JSON.parse(JSON.stringify(data));
  if(col==='config'){S.config=cuerpo;}
  else{if(!S[col])S[col]={};S[col][i]=cuerpo;}
  DB.guardar(col,i,cuerpo);
  return i;
}
function borrar(col,id){
  if(S[col])delete S[col][id];
  DB.borrar(col,id);
  return true;
}

/* ============ RENDER PRINCIPAL ============ */
function render(){
  if(modal){pend=true;renderModal();return;}
  var r=document.getElementById('root');
  if(!dbReady){return;}
  var body='';
  if(tab==='inicio')body=vInicio();
  else if(tab==='pedidos')body=vPedidos();
  else if(tab==='rondas')body=vRondas();
  else if(tab==='sabores')body=vSabores();
  else body=vMas();
  r.innerHTML=avisoAlmacen()+body+navBar()+fab();
  document.getElementById('modal').innerHTML='';
  lockBody(false);
}
function avisoAlmacen(){
  if(DB.hayCacheLocal())return '';
  return '<div class="wrap"><div class="card" style="background:var(--warn-bg)">'+
    '<div style="font-weight:700;color:var(--warn)">⚠️ Este navegador no guarda copia en el celular</div>'+
    '<div class="tiny" style="margin-top:5px">Funciona, pero sin señal no podrás ver tus datos. '+
    'Si estás en modo incógnito, abre el link en una pestaña normal.</div></div></div>';
}
function pildoraNube(){
  var t={ok:['ok','✓ Guardado'],guardando:['gray','☁️ Guardando…'],
    sinsenal:['warn','📴 Sin señal · se sube después'],error:['bad','⚠️ No se guardó']}[estadoNube]||['gray',''];
  return '<span class="chip '+t[0]+'" id="nube" data-act="verNube">'+t[1]+'</span>';
}
function navBar(){
  var it=[['inicio','🏠','Inicio'],['pedidos','🧾','Pedidos'],['rondas','🍳','Rondas'],['sabores','🍰','Sabores'],['mas','⚙️','Más']];
  return '<div class="nav"><div class="wrap">'+it.map(function(x){
    return '<button data-act="tab" data-v="'+x[0]+'" class="'+(tab===x[0]?'on':'')+'"><span class="ic">'+x[1]+'</span>'+x[2]+'</button>';
  }).join('')+'</div></div>';
}
function fab(){
  if(tab==='inicio'||tab==='pedidos')return '<button class="fab" data-act="nuevoPedido">+</button>';
  if(tab==='rondas')return '<button class="fab" data-act="nuevaRonda">+</button>';
  if(tab==='sabores')return '<button class="fab" data-act="nuevoSabor">+</button>';
  return '';
}
function header(t,sub){
  return '<div class="top"><div class="wrap"><div style="flex:1;min-width:0"><h1>'+esc(t)+'</h1>'+
    (sub?'<div class="sub">'+esc(sub)+'</div>':'')+'</div>'+pildoraNube()+'</div></div>';
}
function vacio(e,t,s){
  return '<div class="empty"><div class="e">'+e+'</div><h3>'+esc(t)+'</h3><p>'+esc(s||'')+'</p></div>';
}

/* ============ INICIO ============ */
function vInicio(){
  var T=totales(), h='';
  h+=header(S.config.nombre||'Mis Postres', flarga(hoy()));
  h+='<div class="wrap">';
  h+='<div class="grid2">'+
     kpi('Ventas',money(T.ventas))+kpi('Ganancia',money(T.gananciaEst))+
     kpi('Te deben',money(T.porCobrar),T.porCobrar>0?'bad':'')+kpi('Ya cobrado',money(T.cobrado),'ok')+
     '</div>';

  var pend=sortBy(Object.keys(S.pedidos).filter(function(k){return !S.pedidos[k].entregado;}),
    function(k){return S.pedidos[k].entrega||'9999';});
  h+='<div class="sec">Próximas entregas</div>';
  if(!pend.length)h+='<div class="card"><div class="row"><div class="dot">✅</div><div class="gr"><div style="font-weight:700">Todo entregado</div><div class="muted">No tienes pedidos pendientes</div></div></div></div>';
  else{
    h+='<div class="card">';
    pend.slice(0,5).forEach(function(k){h+=filaPedido(k,true);});
    h+='</div>';
    if(pend.length>5)h+='<button class="btn sec2" data-act="tab" data-v="pedidos">Ver los '+pend.length+' pendientes</button>';
  }

  var sc=saldosPorCliente(), ks=Object.keys(sc);
  if(ks.length){
    h+='<div class="sec">Quién me debe</div><div class="card">';
    sortBy(ks,function(k){return sc[k].saldo;},'desc').forEach(function(k){
      h+='<div class="item"><div class="dot">💸</div><div class="gr"><div class="nm">'+esc(nombreCliente(k))+'</div>'+
         '<div class="muted">'+sc[k].n+' pedido'+(sc[k].n>1?'s':'')+' con saldo</div></div>'+
         '<div style="font-weight:700;color:var(--bad)">'+money(sc[k].saldo)+'</div></div>';
    });
    h+='</div>';
  }

  var stk=[];
  Object.keys(S.rondas).forEach(function(rid){
    var st=stockDe(rid);
    Object.keys(st).forEach(function(s){if(st[s].disp>0)stk.push({s:s,d:st[s].disp});});
  });
  var agr={};
  stk.forEach(function(x){agr[x.s]=(agr[x.s]||0)+x.d;});
  h+='<div class="sec">Me queda para vender</div>';
  if(!Object.keys(agr).length)h+='<div class="card"><div class="row"><div class="dot">🍳</div><div class="gr"><div style="font-weight:700">No hay nada en stock</div><div class="muted">Crea una ronda de producción</div></div><button class="btn sm" data-act="nuevaRonda">Crear</button></div></div>';
  else{
    h+='<div class="card">';
    sortBy(Object.keys(agr),function(k){return agr[k];},'desc').forEach(function(s){
      h+='<div class="item"><div class="dot">'+emoSabor(s)+'</div><div class="gr"><div class="nm">'+esc(nombreSabor(s))+'</div>'+
         '<div class="muted">'+money(num(S.catalogo[s]&&S.catalogo[s].precio))+' c/u</div></div>'+
         '<div class="chip'+(agr[s]<=3?' warn':' ok')+'">'+agr[s]+' disponibles</div></div>';
    });
    h+='</div>';
  }
  h+='<div style="height:10px"></div></div>';
  return h;
}
function kpi(l,v,cl){
  return '<div class="kpi"><div class="lb">'+esc(l)+'</div><div class="vl"'+(cl==='bad'?' style="color:var(--bad)"':cl==='ok'?' style="color:var(--ok)"':'')+'>'+v+'</div></div>';
}

/* ============ PEDIDOS ============ */
function filaPedido(k,corto){
  var p=S.pedidos[k],est=pEstado(p),sal=pSaldo(p),d=dias(p.entrega);
  var chip=est==='pagado'?'<span class="chip ok">Pagado</span>':
           est==='abonado'?'<span class="chip warn">Debe '+money(sal)+'</span>':
           '<span class="chip bad">Sin pagar</span>';
  var ent=p.entregado?'<span class="chip gray">Entregado</span>':
    (d<0?'<span class="chip bad">Atrasado</span>':d===0?'<span class="chip bad">¡Hoy!</span>':
     d===1?'<span class="chip warn">Mañana</span>':'<span class="chip gray">'+fdate(p.entrega)+'</span>');
  var det=(p.items||[]).map(function(i){return i.q+' '+nombreSabor(i.s);}).join(' · ');
  return '<div class="item tap" data-act="verPedido" data-id="'+k+'">'+
    '<div class="dot">'+(p.entregado?'📦':'🛍️')+'</div>'+
    '<div class="gr"><div class="nm">'+esc(nombreCliente(p.clienteId))+'</div>'+
    '<div class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(det||'sin postres')+'</div>'+
    '<div style="margin-top:5px;display:flex;gap:6px;flex-wrap:wrap">'+ent+(corto?'':chip)+'</div></div>'+
    '<div style="text-align:right"><div style="font-weight:700">'+money(pTotal(p))+'</div>'+
    (corto?'':'')+'</div></div>';
}
function vPedidos(){
  var h=header('Pedidos'), ks=Object.keys(S.pedidos);
  var f={pendientes:function(k){return !S.pedidos[k].entregado;},
         deben:function(k){return pSaldo(S.pedidos[k])>0;},
         todos:function(){return true;},
         entregados:function(k){return S.pedidos[k].entregado;}};
  var lista=sortBy(ks.filter(f[filtro]||f.todos),function(k){
    return (filtro==='entregados'?'z':'')+(S.pedidos[k].entrega||'9999')+k;},filtro==='entregados'?'desc':'asc');
  h+='<div class="wrap"><div class="tabs">'+
    [['pendientes','Por entregar'],['deben','Me deben'],['todos','Todos'],['entregados','Entregados']]
    .map(function(x){return '<button data-act="filtro" data-v="'+x[0]+'" class="'+(filtro===x[0]?'on':'')+'">'+x[1]+'</button>';}).join('')+
    '</div>';
  if(!lista.length)h+=vacio('🧾','Nada por aquí','Toca el botón + para registrar un pedido');
  else{h+='<div class="card">';lista.forEach(function(k){h+=filaPedido(k);});h+='</div>';}
  h+='<div style="height:10px"></div></div>';
  return h;
}

/* ============ RONDAS ============ */
function vRondas(){
  var h=header('Rondas de producción','Cada tanda con su propia ganancia');
  var ks=sortBy(Object.keys(S.rondas),function(k){return S.rondas[k].fecha||'';},'desc');
  h+='<div class="wrap">';
  if(!ks.length){
    h+=vacio('🍳','Aún no hay rondas','Toca + para registrar lo que preparaste');
    h+='<div style="height:10px"></div></div>';
    return h;
  }
  var inv=0,ing=0,gan=0;
  ks.forEach(function(rid){var R=resumenRonda(rid);inv+=R.invertido;ing+=R.ingresos;gan+=R.ganancia;});
  h+='<div class="card" style="background:var(--rose-l)"><div class="row sb">'+
    '<div><div class="muted">Sumando todas las tandas</div>'+
    '<div class="big" style="color:'+(gan>=0?'var(--ok)':'var(--bad)')+'">'+money(gan)+'</div>'+
    '<div class="tiny">de ganancia en lo que ya vendiste</div></div>'+
    '<div style="text-align:right"><div class="tiny">Puesto en ingredientes</div><b>'+money(inv)+'</b>'+
    '<div class="tiny" style="margin-top:6px">Recuperado</div><b>'+money(ing)+'</b></div></div></div>';

  ks.forEach(function(rid){
    var r=S.rondas[rid],R=resumenRonda(rid);
    var recuperada=R.faltaRecuperar<=0;
    h+='<div class="card tap" data-act="verRonda" data-id="'+rid+'">'+
      '<div class="row sb" style="align-items:flex-start"><div style="min-width:0">'+
      '<div style="font-weight:700;font-size:17px">'+esc(r.nombre||('Ronda del '+fdate(r.fecha)))+'</div>'+
      '<div class="muted">'+flarga(r.fecha)+' · '+R.prod+' postres</div></div>'+
      '<div style="text-align:right;flex:0 0 auto"><div class="tiny">Ganancia</div>'+
      '<div style="font-weight:700;font-size:19px;color:'+(R.ganancia>0?'var(--ok)':'var(--ink2)')+'">'+money(R.ganancia)+'</div></div></div>'+
      '<div class="bar"><i style="width:'+R.pctRecuperado+'%;background:'+(recuperada?'var(--ok)':'var(--rose)')+'"></i></div>'+
      '<div class="row sb" style="margin-top:7px">'+
      (recuperada
        ? '<span class="chip ok">Ya recuperaste lo invertido</span>'
        : '<span class="chip warn">Te falta '+money(R.faltaRecuperar)+' para recuperar</span>')+
      '<span class="tiny">'+R.vend+' de '+R.prod+' vendidos</span></div>'+
      '<div class="row sb" style="margin-top:9px;border-top:1.5px solid var(--line);padding-top:9px">'+
      '<span class="tiny">Invertí '+money(R.invertido)+'</span>'+
      '<span class="tiny">Vendido '+money(R.ingresos)+'</span>'+
      '<span class="tiny">Quedan '+R.disp+'</span></div></div>';
  });
  h+='<div style="height:10px"></div></div>';
  return h;
}

/* ============ SABORES ============ */
function vSabores(){
  var h=header('Mis sabores','Precio, receta y ganancia');
  var ks=sortBy(Object.keys(S.catalogo),function(k){return S.catalogo[k].nombre||'';});
  h+='<div class="wrap">';
  if(!ks.length)h+=vacio('🍰','Sin sabores todavía','Toca + para crear tu primer postre');
  ks.forEach(function(sid){
    var s=S.catalogo[sid],cu=costoUnit(s),g=gananciaUnit(s),m=margen(s);
    var tieneRec=costoReceta(s)>0;
    h+='<div class="card tap" data-act="verSabor" data-id="'+sid+'">'+
      '<div class="row"><div class="dot">'+(s.emo?esc(s.emo):'🍰')+'</div>'+
      '<div class="gr"><div class="nm" style="font-size:17px">'+esc(s.nombre)+'</div>'+
      '<div class="muted">Vendes a '+money(s.precio)+' · te cuesta '+money(cu)+'</div></div>'+
      '<div style="text-align:right"><div style="font-weight:700;color:'+(g>0?'var(--ok)':'var(--bad)')+'">'+money(g)+'</div>'+
      '<div class="tiny">'+Math.round(m*100)+'% margen</div></div></div>'+
      (tieneRec?'':'<div class="tiny" style="margin-top:8px">⚠️ Sin receta cargada — usa el costo aproximado</div>')+
      '</div>';
  });
  h+='<div style="height:10px"></div></div>';
  return h;
}

/* ============ MAS ============ */
function vMas(){
  var T=totales(),h=header('Mi negocio','Cuentas, clientes y gastos');
  h+='<div class="wrap">';
  h+='<div class="sec">Cómo voy de plata</div><div class="grid2">'+
     kpi('Vendido',money(T.ventas))+kpi('Gastado',money(T.gastos))+
     kpi('Ganancia real',money(T.gananciaReal),T.gananciaReal>=0?'ok':'bad')+
     kpi('Ganancia por receta',money(T.gananciaEst))+'</div>';
  h+='<div class="card mt"><div class="tiny">La <b>ganancia real</b> es lo vendido menos todo lo que compraste. La <b>ganancia por receta</b> cuenta solo los ingredientes de lo que vendiste. Si compras para varias tandas, la real se ve baja al principio.</div></div>';

  var vs=ventasPorSabor(),kv=Object.keys(vs).filter(function(k){return vs[k].u>0;});
  if(kv.length){
    h+='<div class="sec">Cómo va cada sabor</div><div class="card">';
    sortBy(kv,function(k){return vs[k].g;},'desc').forEach(function(s){
      h+='<div class="item"><div class="dot">'+emoSabor(s)+'</div><div class="gr"><div class="nm">'+esc(nombreSabor(s))+'</div>'+
        '<div class="muted">'+vs[s].u+' vendidos · '+money(vs[s].v)+'</div></div>'+
        '<div style="font-weight:700;color:var(--ok)">'+money(vs[s].g)+'</div></div>';
    });
    h+='</div>';
  }

  h+='<div class="sec">Gastos</div>';
  var kg=sortBy(Object.keys(S.gastos),function(k){return S.gastos[k].fecha||'';},'desc');
  h+='<div class="card">';
  if(!kg.length)h+='<div class="muted" style="padding:6px 0">Todavía no has registrado gastos</div>';
  kg.slice(0,6).forEach(function(k){
    var g=S.gastos[k];
    h+='<div class="item tap" data-act="verGasto" data-id="'+k+'"><div class="dot">🧾</div>'+
      '<div class="gr"><div class="nm">'+esc(g.desc||g.cat)+'</div><div class="muted">'+esc(g.cat||'')+' · '+fdate(g.fecha)+'</div></div>'+
      '<div style="font-weight:700">'+money(g.valor)+'</div></div>';
  });
  h+='</div>';
  if(kg.length>6)h+='<div class="tiny" style="text-align:center;margin:-4px 0 12px">Mostrando los 6 más recientes de '+kg.length+'</div>';
  h+='<button class="btn sec2" data-act="nuevoGasto">＋ Registrar un gasto</button>';

  h+='<div class="sec">Clientes</div><div class="card">';
  var kc=sortBy(Object.keys(S.clientes),function(k){return S.clientes[k].nombre||'';});
  if(!kc.length)h+='<div class="muted" style="padding:6px 0">Aún no hay clientes guardados</div>';
  kc.forEach(function(k){
    var c=S.clientes[k],n=0;
    Object.keys(S.pedidos).forEach(function(j){if(S.pedidos[j].clienteId===k)n++;});
    h+='<div class="item tap" data-act="verCliente" data-id="'+k+'"><div class="dot">👤</div>'+
      '<div class="gr"><div class="nm">'+esc(c.nombre)+'</div><div class="muted">'+n+' pedido'+(n===1?'':'s')+(c.tel?' · '+esc(c.tel):'')+'</div></div>'+
      '<div class="tiny">›</div></div>';
  });
  h+='</div><button class="btn sec2" data-act="nuevoCliente">＋ Agregar cliente</button>';

  h+='<div class="sec">Ajustes</div>';
  h+='<button class="btn sec2" data-act="ajustes">✏️ Cambiar el nombre del negocio</button>';
  h+='<div style="height:8px"></div><button class="btn sec2" data-act="respaldo">💾 Respaldo y recuperación</button>';
  var nPap=0;Object.keys(P).forEach(function(c){nPap+=Object.keys(P[c]||{}).length;});
  h+='<div style="height:8px"></div><button class="btn sec2" data-act="papelera">🗑️ Papelera'+(nPap?' ('+nPap+')':'')+'</button>';
  h+='<div class="tiny" style="text-align:center;margin-top:14px">Todo se guarda en la nube y en este celular. Puedes entrar desde cualquier celular con tu cuenta.</div>';
  h+='<div class="tiny" style="text-align:center;margin-top:6px">Cuenta: '+esc(DB.correo()||'')+' · <a href="#" data-act="salir" style="color:var(--rose)">Salir</a></div>';
  h+='<div style="height:14px"></div></div>';
  return h;
}

/* ============ MODALES ============ */
function lockBody(on){
  if(!document.body)return;
  if(on)document.body.classList.add('noscroll');
  else document.body.classList.remove('noscroll');
}
function renderModal(){
  var m=document.getElementById('modal');
  if(!modal){m.innerHTML='';lockBody(false);return;}
  var prev=m.querySelector('.sheet');
  var top=(prev&&modal.__abierto)?prev.scrollTop:0;
  var f={pedido:mPedido,verPedido:mVerPedido,ronda:mRonda,verRonda:mVerRonda,
    sabor:mSabor,cliente:mCliente,gasto:mGasto,ajustes:mAjustes,respaldo:mRespaldo,papelera:mPapelera}[modal.t];
  var cuerpo=f?f():'';
  m.innerHTML='<div class="ov" data-act="cerrarFuera">'+cuerpo+'</div>';
  modal.__abierto=true;
  var ahora=m.querySelector('.sheet');
  if(ahora&&top>0)ahora.scrollTop=top;
  lockBody(true);
}
function sheet(t,bd){
  return '<div class="sheet'+(modal&&modal.__abierto?'':' anim')+'" data-stop="1">'+
    '<div class="hd"><h2>'+esc(t)+'</h2>'+
    '<button class="x" data-act="cerrar">✕</button></div><div class="bd">'+bd+'</div></div>';
}
function abrir(t,d){modal={t:t,d:d||{}};renderModal();}
function confirmar(k){
  if(!modal)return false;
  if(modal.d.__c===k){modal.d.__c=null;return true;}
  modal.d.__c=k;renderModal();toast('Toca otra vez para confirmar');
  return false;
}
function txtBorrar(k,normal){return modal&&modal.d.__c===k?'⚠️ Toca otra vez para eliminar':normal;}
function cerrar(){modal=null;pend=false;document.getElementById('modal').innerHTML='';lockBody(false);render();}

/* ---- NUEVO / EDITAR PEDIDO ---- */
function mPedido(){
  var d=modal.d;
  var h='';
  var ksC=sortBy(Object.keys(S.clientes),function(k){return S.clientes[k].nombre||'';});
  h+='<label>¿Para quién es?</label>';
  h+='<select data-in="clienteId">'+'<option value="">— Elige un cliente —</option>'+
     ksC.map(function(k){return '<option value="'+k+'"'+(d.clienteId===k?' selected':'')+'>'+esc(S.clientes[k].nombre)+'</option>';}).join('')+
     '<option value="__new">➕ Cliente nuevo…</option></select>';
  if(d.clienteId==='__new')
    h+='<div style="margin-top:8px"><input data-in="clienteNuevo" placeholder="Nombre del cliente nuevo" value="'+esc(d.clienteNuevo||'')+'"></div>';

  h+='<div class="sec">¿Qué lleva?</div>';
  var ksS=sortBy(Object.keys(S.catalogo),function(k){return S.catalogo[k].nombre||'';});
  if(!ksS.length)h+='<div class="card flat"><div class="muted">Primero crea tus sabores en la pestaña Sabores.</div></div>';
  h+='<div class="card flat">';
  ksS.forEach(function(sid){
    var q=num(d.items&&d.items[sid]);
    var libre=dispGlobal(sid)+ (d.editando? num(d.orig&&d.orig[sid]) :0);
    var max=libre;
    h+='<div class="item"><div class="dot">'+emoSabor(sid)+'</div>'+
      '<div class="gr"><div class="nm">'+esc(nombreSabor(sid))+'</div>'+
      '<div class="muted">'+money(S.catalogo[sid].precio)+' · '+(max>0?max+' disponibles':'<span style="color:var(--bad)">sin stock</span>')+'</div></div>'+
      '<div class="stepper"><button data-act="qty" data-id="'+sid+'" data-v="-1">−</button>'+
      '<span class="q">'+q+'</span>'+
      '<button class="pl" data-act="qty" data-id="'+sid+'" data-v="1"'+(q>=max?' disabled':'')+'>+</button></div></div>';
  });
  h+='</div>';

  var tot=0,uds=0;
  Object.keys(d.items||{}).forEach(function(s){
    var q=num(d.items[s]); if(q<=0)return;
    tot+=q*num(S.catalogo[s]&&S.catalogo[s].precio); uds+=q;
  });
  h+='<div class="card" style="background:var(--rose-l)"><div class="row sb">'+
    '<div><div class="muted">'+uds+' postre'+(uds===1?'':'s')+'</div><div class="big">'+money(tot)+'</div></div>'+
    '<div class="tiny" style="text-align:right;max-width:130px">Se descuenta del stock al guardar</div></div></div>';

  h+='<div class="sec">Entrega</div>';
  h+='<label>¿Qué día se lo entregas?</label><input type="date" data-in="entrega" value="'+esc(d.entrega||'')+'">';
  h+='<div style="height:10px"></div><label>Nota (opcional)</label>'+
     '<input data-in="notas" placeholder="Ej: entregar en la tarde" value="'+esc(d.notas||'')+'">';

  h+='<div class="sec">Pago</div>';
  var pg=d.pagos||[];
  var pagado=pg.reduce(function(a,x){return a+num(x.v);},0);
  h+='<div class="card flat">';
  if(!pg.length)h+='<div class="muted" style="padding:4px 0 10px">Todavía no ha pagado nada</div>';
  pg.forEach(function(x,i){
    h+='<div class="item"><div class="dot">💵</div><div class="gr"><div class="nm">'+esc(x.m)+'</div>'+
      '<div class="muted">'+money(x.v)+'</div></div>'+
      '<button class="btn danger sm" data-act="delPago" data-i="'+i+'">Quitar</button></div>';
  });
  h+='<div class="row" style="gap:8px;margin-top:10px">'+
    '<select data-in="pm" style="flex:1.1">'+METODOS.map(function(m){return '<option'+(d.pm===m?' selected':'')+'>'+m+'</option>';}).join('')+'</select>'+
    '<input data-in="pv" inputmode="numeric" placeholder="Monto" value="'+esc(d.pv||'')+'" style="flex:1">'+
    '<button class="btn sm" data-act="addPago">Añadir</button></div>';
  if(tot-pagado>0)
    h+='<div class="row" style="gap:8px;margin-top:8px"><button class="btn sec2 sm" data-act="pagoTodo">Pagó todo ('+money(tot-pagado)+')</button>'+
       '<button class="btn sec2 sm" data-act="pagoMitad">Abonó la mitad</button></div>';
  h+='</div>';
  h+='<div class="card" style="background:var(--card2)"><div class="row sb"><span class="muted">Le falta pagar</span>'+
     '<b style="color:'+(tot-pagado>0?'var(--bad)':'var(--ok)')+'">'+money(Math.max(tot-pagado,0))+'</b></div></div>';

  h+='<div style="height:6px"></div><button class="btn" data-act="guardarPedido">'+(d.editando?'Guardar cambios':'Guardar pedido')+'</button>';
  h+='<div style="height:20px"></div>';
  return sheet(d.editando?'Editar pedido':'Nuevo pedido',h);
}

/* ---- VER PEDIDO ---- */
function mVerPedido(){
  var k=modal.d.id,p=S.pedidos[k];
  if(!p)return sheet('Pedido','<div class="muted">Este pedido ya no existe.</div>');
  var tot=pTotal(p),pag=pPagado(p),sal=pSaldo(p),est=pEstado(p);
  var h='';
  h+='<div class="card"><div class="row"><div class="dot">👤</div><div class="gr">'+
    '<div style="font-weight:700;font-size:17px">'+esc(nombreCliente(p.clienteId))+'</div>'+
    '<div class="muted">Pedido del '+flarga(p.fecha)+'</div></div></div>'+
    '<div class="row" style="gap:6px;margin-top:10px;flex-wrap:wrap">'+
    (p.entregado?'<span class="chip ok">Entregado '+fdate(p.entregadoEn)+'</span>':'<span class="chip bad">Entrega '+fdate(p.entrega)+'</span>')+
    (est==='pagado'?'<span class="chip ok">Pagado</span>':est==='abonado'?'<span class="chip warn">Abonado</span>':'<span class="chip bad">Sin pagar</span>')+
    '</div>'+(p.notas?'<div class="tiny" style="margin-top:9px">📝 '+esc(p.notas)+'</div>':'')+'</div>';

  h+='<div class="sec">Lo que lleva</div><div class="card">';
  (p.items||[]).forEach(function(i){
    h+='<div class="item"><div class="dot">'+emoSabor(i.s)+'</div><div class="gr">'+
      '<div class="nm">'+num(i.q)+' × '+esc(nombreSabor(i.s))+'</div>'+
      '<div class="muted">'+money(i.p)+' c/u'+(S.rondas[i.r]?' · ronda '+fdate(S.rondas[i.r].fecha):'')+'</div></div>'+
      '<div style="font-weight:700">'+money(num(i.q)*num(i.p))+'</div></div>';
  });
  h+='<div class="item"><div class="gr"><b>Total</b></div><div class="big">'+money(tot)+'</div></div></div>';

  h+='<div class="sec">Pagos</div><div class="card">';
  modal.d.vistos=(p.pagos||[]).slice();
  if(!(p.pagos||[]).length)h+='<div class="muted" style="padding:4px 0">No ha pagado nada todavía</div>';
  (p.pagos||[]).forEach(function(x,i){
    h+='<div class="item"><div class="dot">💵</div><div class="gr"><div class="nm">'+esc(x.m)+'</div>'+
      '<div class="muted">'+fdate(x.f)+'</div></div><div style="font-weight:700">'+money(x.v)+'</div>'+
      '<button class="btn danger sm" data-act="delPagoG" data-i="'+i+'">✕</button></div>';
  });
  h+='<div class="item"><div class="gr"><b>'+(sal>0?'Le falta':'Está al día')+'</b></div>'+
     '<div class="big" style="color:'+(sal>0?'var(--bad)':'var(--ok)')+'">'+money(sal)+'</div></div>';
  if(sal>0){
    h+='<div class="row" style="gap:8px;margin-top:10px">'+
      '<select data-in="gpm" style="flex:1.1">'+METODOS.map(function(m){return '<option>'+m+'</option>';}).join('')+'</select>'+
      '<input data-in="gpv" inputmode="numeric" placeholder="Monto" value="'+esc(modal.d.gpv||'')+'" style="flex:1">'+
      '<button class="btn sm" data-act="addPagoG">Añadir</button></div>'+
      '<button class="btn sec2 sm" style="width:100%;margin-top:8px" data-act="pagoTodoG">Pagó todo lo que faltaba ('+money(sal)+')</button>';
  }
  h+='</div>';

  h+='<div class="sec">Acciones</div>';
  if(!p.entregado)h+='<button class="btn" data-act="entregar">📦 Marcar como entregado</button><div style="height:8px"></div>';
  else h+='<button class="btn sec2" data-act="desentregar">↩️ Marcar como NO entregado</button><div style="height:8px"></div>';
  h+='<button class="btn sec2" data-act="editarPedido">✏️ Editar este pedido</button><div style="height:8px"></div>';
  h+='<button class="btn danger" data-act="borrarPedido">'+txtBorrar('ped','🗑️ Eliminar (devuelve el stock)')+'</button>';
  h+='<div style="height:20px"></div>';
  return sheet('Pedido',h);
}

/* ---- RONDA ---- */
function mRonda(){
  var d=modal.d,h='';
  h+='<label>¿Qué día preparaste?</label><input type="date" data-in="fecha" value="'+esc(d.fecha||hoy())+'">';
  h+='<div style="height:10px"></div><label>Nombre (opcional)</label>'+
     '<input data-in="nombre" placeholder="Ej: tanda del fin de semana" value="'+esc(d.nombre||'')+'">';
  h+='<div class="sec">¿Cuántos hiciste de cada uno?</div>';
  var ks=sortBy(Object.keys(S.catalogo),function(k){return S.catalogo[k].nombre||'';});
  if(!ks.length)h+='<div class="card flat"><div class="muted">Primero crea tus sabores.</div></div>';
  h+='<div class="card flat">';
  ks.forEach(function(sid){
    var q=num(d.items&&d.items[sid]);
    h+='<div class="item"><div class="dot">'+emoSabor(sid)+'</div>'+
      '<div class="gr"><div class="nm">'+esc(nombreSabor(sid))+'</div>'+
      '<div class="muted">te cuesta '+money(costoUnit(S.catalogo[sid]))+' c/u</div></div>'+
      '<div class="stepper"><button data-act="rqty" data-id="'+sid+'" data-v="-1">−</button>'+
      '<span class="q">'+q+'</span><button class="pl" data-act="rqty" data-id="'+sid+'" data-v="1">+</button></div></div>';
  });
  h+='</div>';
  var cst=0,tq=0;
  Object.keys(d.items||{}).forEach(function(s){var q=num(d.items[s]);if(q<=0)return;tq+=q;cst+=q*costoUnit(S.catalogo[s]);});
  h+='<div class="card" style="background:var(--rose-l)"><div class="row sb">'+
    '<div><div class="muted">'+tq+' postres</div><div class="big">'+money(cst)+'</div></div>'+
    '<div class="tiny" style="text-align:right;max-width:140px">Lo que te costó producir esta ronda</div></div></div>';
  h+='<button class="btn" data-act="guardarRonda">'+(d.editando?'Guardar cambios':'Guardar ronda')+'</button>';
  h+='<div style="height:20px"></div>';
  return sheet(d.editando?'Editar ronda':'Nueva ronda',h);
}
function mVerRonda(){
  var rid=modal.d.id,r=S.rondas[rid];
  if(!r)return sheet('Ronda','<div class="muted">Esta ronda ya no existe.</div>');
  var R=resumenRonda(rid),h='';

  h+='<div class="card" style="background:var(--rose-l);text-align:center">'+
    '<div style="font-weight:700;font-size:17px">'+esc(r.nombre||('Ronda del '+fdate(r.fecha)))+'</div>'+
    '<div class="muted">'+flarga(r.fecha)+'</div>'+
    '<div class="tiny" style="margin-top:12px">GANANCIA DE ESTA RONDA</div>'+
    '<div style="font-size:34px;font-weight:700;letter-spacing:-1px;color:'+(R.ganancia>0?'var(--ok)':'var(--ink2)')+'">'+money(R.ganancia)+'</div>'+
    '<div class="tiny">solo de esta tanda, aparte de las demás</div></div>';

  h+='<div class="grid2">'+
    kpi('Invertí en hacerla',money(R.invertido))+
    kpi('He vendido',money(R.ingresos))+
    kpi('Ya me pagaron',money(R.cobrado),'ok')+
    kpi('Me deben de esta',money(R.porCobrar),R.porCobrar>0?'bad':'')+'</div>';

  h+='<div class="card mt">';
  if(R.faltaRecuperar>0){
    h+='<div class="row sb"><span class="muted">Para recuperar lo invertido</span>'+
       '<b style="color:var(--bad)">faltan '+money(R.faltaRecuperar)+'</b></div>'+
       '<div class="bar"><i style="width:'+R.pctRecuperado+'%"></i></div>'+
       '<div class="tiny" style="margin-top:7px">Llevas '+R.pctRecuperado+'% de la inversión recuperada. '+
       'Todo lo que vendas de aquí en adelante es ganancia limpia.</div>';
  }else{
    h+='<div class="row sb"><span class="muted">Inversión recuperada</span>'+
       '<b style="color:var(--ok)">✅ completa</b></div>'+
       '<div class="bar"><i style="width:100%;background:var(--ok)"></i></div>'+
       '<div class="tiny" style="margin-top:7px">Ya cubriste los '+money(R.invertido)+' que pusiste. '+
       'Lo demás es ganancia.</div>';
  }
  h+='</div>';

  if(R.disp>0)
    h+='<div class="card"><div class="row sb"><span class="muted">Si vendes lo que te queda</span>'+
      '<b style="color:var(--ok)">'+money(R.gananciaPotencial)+'</b></div>'+
      '<div class="tiny" style="margin-top:5px">Te quedan '+R.disp+' postres que valen '+money(R.valorStock)+'</div></div>';
  if(R.perdidoMerma>0)
    h+='<div class="card"><div class="row sb"><span class="muted">Perdido en postres dañados</span>'+
      '<b style="color:var(--bad)">−'+money(R.perdidoMerma)+'</b></div></div>';

  h+='<div class="sec">Sabor por sabor</div><div class="card">';
  var ks=Object.keys(R.porSabor);
  if(!ks.length)h+='<div class="muted" style="padding:6px 0">Esta ronda no tiene postres.</div>';
  sortBy(ks,function(s){return R.porSabor[s].gan;},'desc').forEach(function(s){
    var x=R.porSabor[s];
    h+='<div class="item"><div class="dot">'+emoSabor(s)+'</div><div class="gr">'+
      '<div class="nm">'+esc(nombreSabor(s))+'</div>'+
      '<div class="muted">Vendí '+x.vend+' de '+x.prod+(x.merma?' · perdí '+x.merma:'')+' · '+money(x.ing)+'</div>'+
      '<div style="margin-top:5px"><span class="chip'+(x.disp>0?(x.disp<=3?' warn':' ok'):' gray')+'">'+x.disp+' quedan</span></div></div>'+
      '<div style="text-align:right"><div class="tiny">ganancia</div>'+
      '<div style="font-weight:700;color:'+(x.gan>0?'var(--ok)':'var(--ink2)')+'">'+money(x.gan)+'</div></div></div>';
  });
  h+='</div>';

  h+='<div class="sec">¿Se te dañaron o sobraron?</div><div class="card flat">'+
    '<div class="row" style="gap:8px">'+
    '<select data-in="ms" style="flex:1.3">'+ks.map(function(s){return '<option value="'+s+'">'+esc(nombreSabor(s))+'</option>';}).join('')+'</select>'+
    '<input data-in="mq" inputmode="numeric" placeholder="Cuántos" value="'+esc(modal.d.mq||'')+'" style="flex:.8">'+
    '<button class="btn sm" data-act="addMerma">Anotar</button></div>'+
    '<div class="tiny" style="margin-top:8px">Se restan del stock pero no cuentan como venta.</div></div>';
  h+='<button class="btn sec2" data-act="editarRonda">✏️ Editar cantidades</button><div style="height:8px"></div>';
  h+='<button class="btn danger" data-act="borrarRonda">'+txtBorrar('ron','🗑️ Eliminar ronda')+'</button>';
  h+='<div style="height:20px"></div>';
  return sheet('Ronda',h);
}

/* ---- SABOR ---- */
function mSabor(){
  var d=modal.d,h='';
  var s=d.id?S.catalogo[d.id]:null;
  h+='<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:12px">'+
    EMO.map(function(e){return '<button class="dot tap'+(d.emo===e?'':'')+'" data-act="emo" data-v="'+e+'" style="'+(d.emo===e?'outline:2.5px solid var(--rose);outline-offset:2px':'')+'">'+e+'</button>';}).join('')+'</div>';
  h+='<label>¿Cómo se llama?</label><input data-in="nombre" placeholder="Ej: Cheesecake de oreo" value="'+esc(d.nombre||'')+'">';
  h+='<div class="grid2 mt"><div><label>Lo vendes a</label><input data-in="precio" inputmode="numeric" value="'+esc(d.precio||'')+'"></div>'+
     '<div><label>Salen por tanda</label><input data-in="rinde" inputmode="numeric" value="'+esc(d.rinde||'')+'"></div></div>';

  h+='<div class="sec">Ingredientes de una tanda</div>';
  var ing=d.ingredientes||[];
  h+='<div class="card flat">';
  if(!ing.length)h+='<div class="muted" style="padding:4px 0 10px">Agrega los ingredientes y sabrás exactamente cuánto te cuesta.</div>';
  ing.forEach(function(x,i){
    h+='<div class="item"><div class="dot">🥣</div><div class="gr"><div class="nm">'+esc(x.n)+'</div>'+
      '<div class="muted">'+money(x.c)+'</div></div>'+
      '<button class="btn danger sm" data-act="delIng" data-i="'+i+'">✕</button></div>';
  });
  h+='<div class="row" style="gap:8px;margin-top:10px">'+
    '<input data-in="ingN" placeholder="Ingrediente" value="'+esc(d.ingN||'')+'" style="flex:1.4">'+
    '<input data-in="ingC" inputmode="numeric" placeholder="Costo" value="'+esc(d.ingC||'')+'" style="flex:1">'+
    '<button class="btn sm" data-act="addIng">＋</button></div></div>';

  var rec=ing.reduce(function(a,x){return a+num(x.c);},0);
  var rinde=Math.max(num(d.rinde)||1,1);
  var cu=rec>0?rec/rinde:num(d.costoManual);
  var gan=num(d.precio)-cu;
  h+='<div class="card" style="background:var(--rose-l)">'+
    '<div class="row sb"><span class="muted">Costo de la tanda</span><b>'+money(rec)+'</b></div>'+
    '<div class="row sb" style="margin-top:6px"><span class="muted">Te cuesta cada uno</span><b>'+money(cu)+'</b></div>'+
    '<div class="row sb" style="margin-top:6px"><span class="muted">Te ganas por cada uno</span>'+
    '<b style="color:'+(gan>0?'var(--ok)':'var(--bad)')+'">'+money(gan)+'</b></div>'+
    '<div class="bar"><i style="width:'+Math.max(0,Math.min(100,Math.round(num(d.precio)>0?gan/num(d.precio)*100:0)))+'%"></i></div>'+
    '<div class="tiny" style="margin-top:6px">'+(num(d.precio)>0?Math.round(gan/num(d.precio)*100):0)+'% de cada venta es ganancia</div></div>';

  if(!rec)h+='<div><label>Si aún no tienes la receta, ¿cuánto crees que te cuesta uno?</label>'+
    '<input data-in="costoManual" inputmode="numeric" value="'+esc(d.costoManual||'')+'"></div><div style="height:12px"></div>';

  h+='<button class="btn" data-act="guardarSabor">Guardar</button>';
  if(d.id){
    h+='<div style="height:8px"></div><button class="btn danger" data-act="borrarSabor">'+txtBorrar('sab','🗑️ Eliminar sabor')+'</button>';
  }
  h+='<div style="height:20px"></div>';
  return sheet(s?'Editar sabor':'Nuevo sabor',h);
}

/* ---- CLIENTE / GASTO / AJUSTES ---- */
function mCliente(){
  var d=modal.d,h='';
  h+='<label>Nombre</label><input data-in="nombre" value="'+esc(d.nombre||'')+'" placeholder="Ej: Michel">';
  h+='<div style="height:10px"></div><label>Teléfono (opcional)</label><input data-in="tel" inputmode="tel" value="'+esc(d.tel||'')+'">';
  h+='<div style="height:10px"></div><label>Nota (opcional)</label><input data-in="notas" value="'+esc(d.notas||'')+'" placeholder="Ej: le gusta sin azúcar">';
  if(d.id){
    var hist=sortBy(Object.keys(S.pedidos).filter(function(k){return S.pedidos[k].clienteId===d.id;}),
      function(k){return S.pedidos[k].fecha||'';},'desc');
    if(hist.length){
      h+='<div class="sec">Sus pedidos</div><div class="card">';
      hist.forEach(function(k){h+=filaPedido(k);});
      h+='</div>';
    }
  }
  h+='<div style="height:6px"></div><button class="btn" data-act="guardarCliente">Guardar</button>';
  if(d.id)h+='<div style="height:8px"></div><button class="btn danger" data-act="borrarCliente">'+txtBorrar('cli','🗑️ Eliminar cliente')+'</button>';
  h+='<div style="height:20px"></div>';
  return sheet(d.id?'Cliente':'Nuevo cliente',h);
}
function mGasto(){
  var d=modal.d,h='';
  h+='<label>¿Qué compraste?</label><input data-in="desc" value="'+esc(d.desc||'')+'" placeholder="Ej: harina y huevos">';
  h+='<div class="grid2 mt"><div><label>Valor</label><input data-in="valor" inputmode="numeric" value="'+esc(d.valor||'')+'"></div>'+
     '<div><label>Fecha</label><input type="date" data-in="fecha" value="'+esc(d.fecha||hoy())+'"></div></div>';
  h+='<div class="mt"><label>Categoría</label><select data-in="cat">'+
     CATS.map(function(c){return '<option'+(d.cat===c?' selected':'')+'>'+c+'</option>';}).join('')+'</select></div>';
  h+='<div class="mt"><label>¿Fue para un sabor en especial? (opcional)</label><select data-in="saborId">'+
     '<option value="">Para todo en general</option>'+
     sortBy(Object.keys(S.catalogo),function(k){return S.catalogo[k].nombre||'';}).map(function(k){
       return '<option value="'+k+'"'+(d.saborId===k?' selected':'')+'>'+esc(S.catalogo[k].nombre)+'</option>';}).join('')+
     '</select></div>';
  h+='<div style="height:16px"></div><button class="btn" data-act="guardarGasto">Guardar gasto</button>';
  if(d.id)h+='<div style="height:8px"></div><button class="btn danger" data-act="borrarGasto">'+txtBorrar('gas','🗑️ Eliminar')+'</button>';
  h+='<div style="height:20px"></div>';
  return sheet(d.id?'Gasto':'Nuevo gasto',h);
}
function mRespaldo(){
  var d=modal.d,h='';
  var n=Object.keys(S.pedidos).length,c=Object.keys(S.clientes).length;
  h+='<div class="card" style="background:var(--ok-bg)"><div class="tiny">GUARDADO EN LA NUBE</div>'+
    '<div style="margin-top:4px">'+n+' pedidos · '+c+' clientes · '+Object.keys(S.catalogo).length+' sabores</div>'+
    '<div class="tiny" style="margin-top:8px">Tus datos están en la nube de Google y en este celular. Si cambias de celular, solo entra con la misma cuenta. '+
    'Cada cambio queda anotado en el historial y lo que eliminas va a la papelera.</div></div>';
  h+='<div class="sec">Guardar una copia extra</div>';
  h+='<button class="btn" data-act="bajarRespaldo">⬇️ Descargar respaldo</button>';
  h+='<div class="tiny" style="text-align:center;margin-top:8px">Opcional: un archivo con todo, por si acaso.</div>';
  if(d.texto){
    h+='<div class="card mt"><div class="tiny">No se pudo descargar aquí. Copia este texto y guárdalo donde quieras:</div>'+
      '<textarea rows="5" style="margin-top:8px;font-size:11px" readonly>'+esc(d.texto)+'</textarea></div>';
  }
  h+='<div class="sec">Traer datos de un respaldo</div>';
  h+='<div class="card flat"><label>Elige el archivo de respaldo (sirve el de la app anterior)</label>'+
     '<input type="file" accept=".json,application/json,text/plain" data-in="archivo" id="fileResp">'+
     '<div class="tiny" style="margin-top:10px">O pega aquí el texto del respaldo:</div>'+
     '<textarea rows="4" data-in="pegado" placeholder="Pega el respaldo aquí" style="margin-top:6px;font-size:12px">'+esc(d.pegado||'')+'</textarea>'+
     '<div style="height:10px"></div><button class="btn sec2" data-act="restaurar"'+(d.trayendo?' disabled':'')+'>'+
     (d.trayendo?'Trayendo…':d.__c==='rest'?'⚠️ Toca otra vez para traer los datos':'♻️ Traer datos del respaldo')+'</button>'+
     (d.resultado?'<div class="card mt" style="background:var(--ok-bg)"><b>'+d.resultado.nuevos+' registros agregados.</b>'+
       (d.resultado.yaEstaban?'<div class="tiny" style="margin-top:4px">'+d.resultado.yaEstaban+' ya estaban y no se tocaron.</div>':'')+
       (d.resultado.invalidos?'<div class="tiny" style="margin-top:4px">'+d.resultado.invalidos+' no se entendieron y se dejaron por fuera.</div>':'')+
       (d.resultado.fallidos?'<div class="tiny" style="margin-top:4px;color:var(--bad)">'+d.resultado.fallidos+' no se pudieron guardar.</div>':'')+'</div>':'')+
     '<div class="tiny" style="margin-top:8px">Solo agrega lo que no tengas. Lo que ya está en la app (o en la papelera) no se toca. Necesita señal.</div></div>';
  h+='<div class="sec">Últimos cambios</div>';
  if(!d.hist)h+='<button class="btn sec2" data-act="verHistorial">'+(d.cargandoHist?'Cargando…':'🕘 Ver los últimos cambios')+'</button>';
  else{
    h+='<div class="card">';
    if(!d.hist.length)h+='<div class="muted">Sin cambios todavía</div>';
    var NOM={catalogo:'sabor',clientes:'cliente',rondas:'ronda',pedidos:'pedido',gastos:'gasto',config:'ajustes'};
    d.hist.forEach(function(x){
      var v=x.despues||x.antes||{};
      var cual=v.nombre||v.desc||(v.clienteId?nombreCliente(v.clienteId):'')||(v.v?money(v.v):'')||'';
      var f=x.cuando&&x.cuando.toDate?x.cuando.toDate():null;
      h+='<div class="item"><div class="gr"><div class="nm">'+esc((x.accion||'')+' '+(NOM[x.col]||x.col))+(cual?' · '+esc(cual):'')+'</div>'+
        '<div class="muted">'+(f?f.toLocaleString('es-CO'):'subiendo…')+' · '+esc(x.por||'')+'</div></div></div>';
    });
    h+='</div>';
  }
  h+='<div style="height:20px"></div>';
  return sheet('Respaldo',h);
}
function mPapelera(){
  var h='',hay=false;
  var NOM={catalogo:['Sabores','🍰'],clientes:['Clientes','👤'],rondas:['Rondas','🍳'],pedidos:['Pedidos','🧾'],gastos:['Gastos','💸']};
  h+='<div class="tiny" style="margin-bottom:10px">Lo que eliminas no se pierde: queda aquí y lo puedes recuperar cuando quieras.</div>';
  Object.keys(NOM).forEach(function(c){
    var ks=Object.keys(P[c]||{});
    if(!ks.length)return;
    hay=true;
    h+='<div class="sec">'+NOM[c][0]+'</div><div class="card">';
    sortBy(ks,function(k){return P[c][k]._cuando||0;},'desc').forEach(function(k){
      var v=P[c][k];
      var nm=v.nombre||v.desc||(v.clienteId?nombreCliente(v.clienteId)+' · '+money(pTotal(v)):'')||k;
      h+='<div class="item"><div class="dot">'+NOM[c][1]+'</div><div class="gr"><div class="nm">'+esc(nm)+'</div>'+
        '<div class="muted">'+(v._cuando?new Date(v._cuando).toLocaleDateString('es-CO'):'')+'</div></div>'+
        '<button class="btn sm" data-act="restaurarBorrado" data-c="'+c+'" data-id="'+esc(k)+'">Recuperar</button></div>';
    });
    h+='</div>';
  });
  if(!hay)h+=vacio('🗑️','La papelera está vacía','');
  h+='<div style="height:20px"></div>';
  return sheet('Papelera',h);
}
function mAjustes(){
  var d=modal.d;
  var h='<label>Nombre de tu negocio</label><input data-in="nombre" value="'+esc(d.nombre||'')+'">'+
    '<div style="height:16px"></div><button class="btn" data-act="guardarAjustes">Guardar</button><div style="height:20px"></div>';
  return sheet('Ajustes',h);
}

/* ============ ACCIONES ============ */
var ACT={};

ACT.tab=function(el){tab=el.dataset.v;filtro=tab==='pedidos'?'pendientes':filtro;render();window.scrollTo(0,0);};
ACT.filtro=function(el){filtro=el.dataset.v;render();};
ACT.cerrar=function(){cerrar();};
ACT.cerrarFuera=function(el,e){if(e.target.classList.contains('ov'))cerrar();};

/* -- pedido -- */
ACT.nuevoPedido=function(){
  if(!Object.keys(S.catalogo).length){toast('Primero crea un sabor 🍰');tab='sabores';render();return;}
  abrir('pedido',{items:{},pagos:[],entrega:hoy(),pm:METODOS[0]});
};
ACT.qty=function(el){
  var d=modal.d,sid=el.dataset.id,v=Number(el.dataset.v);
  d.items=d.items||{};
  var cur=num(d.items[sid]);
  var max=dispGlobal(sid)+(d.editando?num(d.orig&&d.orig[sid]):0);
  var nv=cur+v;
  if(nv<0)nv=0;
  if(nv>max){toast('Solo te quedan '+max+' de ese sabor');nv=max;}
  if(nv===0)delete d.items[sid]; else d.items[sid]=nv;
  renderModal();
};
ACT.addPago=function(){
  var d=modal.d,v=num(d.pv);
  if(v<=0){toast('Escribe cuánto te pagó',1);return;}
  var tot=0;
  Object.keys(d.items||{}).forEach(function(s){tot+=num(d.items[s])*num(S.catalogo[s]&&S.catalogo[s].precio);});
  var falta=tot-(d.pagos||[]).reduce(function(a,x){return a+num(x.v);},0);
  if(falta<=0){toast('Este pedido ya está pagado completo');return;}
  if(v>falta){v=falta;toast('Solo faltaban '+money(falta), 0);}
  d.pagos=d.pagos||[];d.pagos.push(pagoNuevo(d.pm||METODOS[0],v));
  d.pv='';renderModal();
};
ACT.delPago=function(el){modal.d.pagos.splice(Number(el.dataset.i),1);renderModal();};
ACT.pagoTodo=function(){
  var d=modal.d,tot=0;
  Object.keys(d.items||{}).forEach(function(s){tot+=num(d.items[s])*num(S.catalogo[s]&&S.catalogo[s].precio);});
  var falta=tot-(d.pagos||[]).reduce(function(a,x){return a+num(x.v);},0);
  if(falta<=0)return;
  d.pagos=d.pagos||[];d.pagos.push(pagoNuevo(d.pm||METODOS[0],falta));renderModal();
};
ACT.pagoMitad=function(){
  var d=modal.d,tot=0;
  Object.keys(d.items||{}).forEach(function(s){tot+=num(d.items[s])*num(S.catalogo[s]&&S.catalogo[s].precio);});
  var falta=tot-(d.pagos||[]).reduce(function(a,x){return a+num(x.v);},0);
  if(falta<=0)return;
  d.pagos=d.pagos||[];d.pagos.push(pagoNuevo(d.pm||METODOS[0],Math.round(falta/2)));renderModal();
};
ACT.guardarPedido=async function(){
  var d=modal.d;
  var its=Object.keys(d.items||{}).filter(function(s){return num(d.items[s])>0;});
  if(!its.length){toast('Agrega al menos un postre',1);return;}
  var cid=d.clienteId;
  if(cid==='__new'){
    var nm=(d.clienteNuevo||'').trim();
    if(!nm){toast('Escribe el nombre del cliente',1);return;}
    var id=await save('clientes',null,{nombre:nm,tel:'',notas:'',creado:hoy()});
    if(!id)return;
    S.clientes[id]={nombre:nm,tel:'',notas:'',creado:hoy()};
    cid=id;
  }
  if(!cid){toast('Elige a quién le vendes',1);return;}
  var items=[],falla=null,prevAlloc=d.origAlloc||{};
  function meter(sid,rid,q,precio){
    var ex=null;
    items.forEach(function(it){if(it.s===sid&&it.r===rid)ex=it;});
    if(ex)ex.q+=q; else items.push({s:sid,q:q,p:precio,r:rid});
  }
  its.forEach(function(sid){
    var q=num(d.items[sid]),precio=num(S.catalogo[sid].precio);
    (prevAlloc[sid]||[]).forEach(function(a){
      if(q<=0)return;
      var t=Math.min(q,num(a.q));
      if(t>0){meter(sid,a.r,t,precio);q-=t;}
    });
    var rs=rondasConStock(sid);
    for(var i=0;i<rs.length&&q>0;i++){
      var t2=Math.min(q,rs[i].disp);
      if(t2<=0)continue;
      meter(sid,rs[i].r,t2,precio);q-=t2;
    }
    if(q>0)falla=nombreSabor(sid);
  });
  if(falla){toast('No hay stock suficiente de '+falla,1);return;}
  var campos={clienteId:cid,items:items,entrega:d.entrega||hoy(),fecha:d.fecha||hoy(),notas:d.notas||''};
  var pid;
  if(d.editando&&S.pedidos[d.id]){
    // Solo se mandan los campos del formulario y los pagos que se agregaron o quitaron aquí.
    // Así no se pisa lo que otro celular haya anotado mientras tanto (pagos, entrega).
    pid=d.id;
    var orig=d.pagosOrig||[],ahora=d.pagos||[];
    var agregados=ahora.filter(function(x){return orig.indexOf(x)<0;});
    var quitados=orig.filter(function(x){return ahora.indexOf(x)<0;});
    DB.editarPedido(pid,campos,agregados,quitados);
    S.pedidos[pid]=Object.assign({},S.pedidos[pid],campos,{pagos:ahora});
  }else{
    var body=Object.assign({},campos,{pagos:d.pagos||[],entregado:false,entregadoEn:''});
    pid=save('pedidos',null,body);
    S.pedidos[pid]=body;
  }
  cerrar();
  toast(d.editando?'Pedido actualizado ✨':'¡Pedido guardado! 🎉');
};
ACT.verPedido=function(el){abrir('verPedido',{id:el.dataset.id});};
function pagoNuevo(m,v){return {id:'pg'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),m:m,v:v,f:hoy()};}
ACT.addPagoG=function(){
  var k=modal.d.id,p=S.pedidos[k],v=num(modal.d.gpv),sal=pSaldo(p);
  if(v<=0){toast('Escribe el monto',1);return;}
  if(sal<=0){toast('Este pedido ya está pagado completo');return;}
  if(v>sal){v=sal;toast('Solo faltaban '+money(sal));}
  var m=(document.querySelector('[data-in="gpm"]')||{}).value||METODOS[0];
  var pg=pagoNuevo(m,v);
  S.pedidos[k]=Object.assign({},p,{pagos:(p.pagos||[]).concat([pg])});
  DB.agregarPago(k,pg);
  modal.d.gpv='';renderModal();toast('Pago registrado 💵');
};
ACT.pagoTodoG=function(){
  var k=modal.d.id,p=S.pedidos[k],s=pSaldo(p);
  if(s<=0)return;
  var m=(document.querySelector('[data-in="gpm"]')||{}).value||METODOS[0];
  var pg=pagoNuevo(m,s);
  S.pedidos[k]=Object.assign({},p,{pagos:(p.pagos||[]).concat([pg])});
  DB.agregarPago(k,pg);
  renderModal();toast('¡Quedó al día! ✅');
};
function mismoPago(a,b){return a&&b&&(a.id||b.id?a.id===b.id:JSON.stringify(a)===JSON.stringify(b));}
ACT.delPagoG=function(el){
  var k=modal.d.id,p=S.pedidos[k],pagos=(p.pagos||[]).slice();
  var visto=(modal.d.vistos||[])[Number(el.dataset.i)];
  var i=-1;pagos.forEach(function(x,j){if(i<0&&mismoPago(x,visto))i=j;});
  if(i<0){toast('Ese pago ya había cambiado en otro celular');renderModal();return;}
  var quitado=pagos.splice(i,1)[0];
  S.pedidos[k]=Object.assign({},p,{pagos:pagos});
  DB.quitarPago(k,quitado);
  renderModal();
};
ACT.entregar=function(){
  var k=modal.d.id,c={entregado:true,entregadoEn:hoy()};
  S.pedidos[k]=Object.assign({},S.pedidos[k],c);
  DB.actualizar('pedidos',k,c);
  renderModal();toast('¡Entregado! 📦');
};
ACT.desentregar=function(){
  var k=modal.d.id,c={entregado:false,entregadoEn:''};
  S.pedidos[k]=Object.assign({},S.pedidos[k],c);
  DB.actualizar('pedidos',k,c);
  renderModal();
};
ACT.editarPedido=function(){
  var k=modal.d.id,p=S.pedidos[k],items={},alloc={};
  (p.items||[]).forEach(function(i){
    items[i.s]=num(items[i.s])+num(i.q);
    (alloc[i.s]=alloc[i.s]||[]).push({r:i.r,q:num(i.q)});
  });
  abrir('pedido',{id:k,editando:true,items:items,orig:JSON.parse(JSON.stringify(items)),origAlloc:alloc,
    pagos:(p.pagos||[]).slice(),pagosOrig:(p.pagos||[]).slice(),clienteId:p.clienteId,entrega:p.entrega,fecha:p.fecha,notas:p.notas,
    pm:METODOS[0]});
};
ACT.borrarPedido=async function(){
  var k=modal.d.id;
  if(!confirmar('ped'))return;
  if(!await borrar('pedidos',k))return;
  delete S.pedidos[k];cerrar();toast('Pedido eliminado');
};

/* -- ronda -- */
ACT.nuevaRonda=function(){
  if(!Object.keys(S.catalogo).length){toast('Primero crea un sabor 🍰');tab='sabores';render();return;}
  abrir('ronda',{items:{},fecha:hoy()});
};
ACT.rqty=function(el){
  var d=modal.d,sid=el.dataset.id,v=Number(el.dataset.v);
  d.items=d.items||{};
  var nv=num(d.items[sid])+v;
  if(nv<0)nv=0;
  var min=0;
  if(d.editando){
    var st=stockDe(d.id)[sid];
    if(st)min=st.vend+st.merma;
    if(nv<min){toast('Ya vendiste '+min+', no puedes bajar de ahí');nv=min;}
  }
  if(nv===0)delete d.items[sid];else d.items[sid]=nv;
  renderModal();
};
ACT.guardarRonda=async function(){
  var d=modal.d;
  var its=Object.keys(d.items||{}).filter(function(s){return num(d.items[s])>0;});
  if(!its.length){toast('Agrega al menos un postre',1);return;}
  var prev=d.id?S.rondas[d.id]:null;
  var campos={fecha:d.fecha||hoy(),nombre:d.nombre||'',items:its.map(function(s){return {s:s,q:num(d.items[s])};})};
  var rid;
  if(prev){rid=d.id;DB.actualizar('rondas',rid,campos);S.rondas[rid]=Object.assign({},prev,campos);}
  else{var body=Object.assign({},campos,{merma:[],creado:hoy()});rid=save('rondas',null,body);S.rondas[rid]=body;}
  cerrar();toast(d.editando?'Ronda actualizada ✨':'¡Ronda guardada! 🍳');
};
ACT.verRonda=function(el){abrir('verRonda',{id:el.dataset.id});};
ACT.editarRonda=function(){
  var rid=modal.d.id,r=S.rondas[rid],items={};
  (r.items||[]).forEach(function(i){items[i.s]=num(i.q);});
  abrir('ronda',{id:rid,editando:true,items:items,fecha:r.fecha,nombre:r.nombre});
};
ACT.addMerma=async function(){
  var rid=modal.d.id,r=S.rondas[rid];
  var sel=document.querySelector('[data-in="ms"]');
  var sid=sel?sel.value:'';
  var q=num(modal.d.mq);
  if(!sid||q<=0){toast('Elige el sabor y la cantidad',1);return;}
  var st=stockDe(rid)[sid];
  if(!st||q>st.disp){toast('Solo quedan '+(st?st.disp:0),1);return;}
  var mm={id:'mm'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),s:sid,q:q,f:hoy()};
  S.rondas[rid]=Object.assign({},r,{merma:(r.merma||[]).concat([mm])});
  DB.agregarMerma(rid,mm);
  modal.d.mq='';renderModal();toast('Anotado');
};
ACT.borrarRonda=async function(){
  var rid=modal.d.id,usada=false;
  Object.keys(S.pedidos).forEach(function(k){
    (S.pedidos[k].items||[]).forEach(function(i){if(i.r===rid)usada=true;});
  });
  if(usada){toast('No puedes borrarla: ya vendiste de esta ronda',1);return;}
  if(!confirmar('ron'))return;
  if(!await borrar('rondas',rid))return;
  delete S.rondas[rid];cerrar();toast('Ronda eliminada');
};

/* -- sabor -- */
ACT.nuevoSabor=function(){abrir('sabor',{emo:'🍰',ingredientes:[],rinde:10});};
ACT.verSabor=function(el){
  var id=el.dataset.id,s=S.catalogo[id];
  abrir('sabor',{id:id,nombre:s.nombre,precio:s.precio,rinde:s.rinde,emo:s.emo||'🍰',
    costoManual:s.costoManual,ingredientes:(s.ingredientes||[]).slice()});
};
ACT.emo=function(el){modal.d.emo=el.dataset.v;renderModal();};
ACT.addIng=function(){
  var d=modal.d,n=(d.ingN||'').trim(),c=num(d.ingC);
  if(!n){toast('Escribe el ingrediente',1);return;}
  if(c<=0){toast('Escribe cuánto te costó',1);return;}
  d.ingredientes=(d.ingredientes||[]).concat([{n:n,c:c}]);
  d.ingN='';d.ingC='';renderModal();
};
ACT.delIng=function(el){modal.d.ingredientes.splice(Number(el.dataset.i),1);renderModal();};
ACT.guardarSabor=async function(){
  var d=modal.d,nm=(d.nombre||'').trim();
  if(!nm){toast('Ponle un nombre al postre',1);return;}
  if(num(d.precio)<=0){toast('Escribe a cuánto lo vendes',1);return;}
  var body={nombre:nm,precio:num(d.precio),rinde:Math.max(num(d.rinde)||1,1),emo:d.emo||'🍰',
    costoManual:num(d.costoManual),ingredientes:(d.ingredientes||[]).map(function(x){return {n:x.n,c:num(x.c)};})};
  var id=await save('catalogo',d.id||null,body);
  if(!id)return;
  S.catalogo[id]=body;cerrar();toast('Guardado ✨');
};
ACT.borrarSabor=async function(){
  var id=modal.d.id,usado=false;
  Object.keys(S.pedidos).forEach(function(k){(S.pedidos[k].items||[]).forEach(function(i){if(i.s===id)usado=true;});});
  Object.keys(S.rondas).forEach(function(k){(S.rondas[k].items||[]).forEach(function(i){if(i.s===id)usado=true;});});
  if(usado){toast('No puedes borrarlo: ya lo usaste en rondas o pedidos',1);return;}
  if(!confirmar('sab'))return;
  if(!await borrar('catalogo',id))return;
  delete S.catalogo[id];cerrar();toast('Sabor eliminado');
};

/* -- cliente / gasto / ajustes -- */
ACT.nuevoCliente=function(){abrir('cliente',{});};
ACT.verCliente=function(el){var id=el.dataset.id,c=S.clientes[id];abrir('cliente',{id:id,nombre:c.nombre,tel:c.tel,notas:c.notas});};
ACT.guardarCliente=async function(){
  var d=modal.d,nm=(d.nombre||'').trim();
  if(!nm){toast('Escribe el nombre',1);return;}
  var body={nombre:nm,tel:d.tel||'',notas:d.notas||'',creado:hoy()};
  var id=await save('clientes',d.id||null,body);
  if(!id)return;
  S.clientes[id]=body;cerrar();toast('Guardado ✨');
};
ACT.borrarCliente=async function(){
  var id=modal.d.id,usado=false;
  Object.keys(S.pedidos).forEach(function(k){if(S.pedidos[k].clienteId===id)usado=true;});
  if(usado){toast('No puedes borrarlo: tiene pedidos',1);return;}
  if(!confirmar('cli'))return;
  if(!await borrar('clientes',id))return;
  delete S.clientes[id];cerrar();toast('Cliente eliminado');
};
ACT.nuevoGasto=function(){abrir('gasto',{fecha:hoy(),cat:CATS[0]});};
ACT.verGasto=function(el){var id=el.dataset.id,g=S.gastos[id];
  abrir('gasto',{id:id,desc:g.desc,valor:g.valor,fecha:g.fecha,cat:g.cat,saborId:g.saborId});};
ACT.guardarGasto=async function(){
  var d=modal.d;
  if(num(d.valor)<=0){toast('Escribe cuánto gastaste',1);return;}
  var body={desc:(d.desc||'').trim()||d.cat||'Gasto',valor:num(d.valor),fecha:d.fecha||hoy(),
    cat:d.cat||CATS[0],saborId:d.saborId||''};
  var id=await save('gastos',d.id||null,body);
  if(!id)return;
  S.gastos[id]=body;cerrar();toast('Gasto guardado');
};
ACT.borrarGasto=async function(){
  var id=modal.d.id;
  if(!confirmar('gas'))return;
  if(!await borrar('gastos',id))return;
  delete S.gastos[id];cerrar();toast('Gasto eliminado');
};
ACT.ajustes=function(){abrir('ajustes',{nombre:S.config.nombre||''});};
ACT.guardarAjustes=async function(){
  var nm=(modal.d.nombre||'').trim()||'Mis Postres';
  var body={nombre:nm};
  if(!await save('config','app',body))return;
  S.config=body;cerrar();toast('Listo ✨');
};
ACT.respaldo=function(){abrir('respaldo',{});};
ACT.bajarRespaldo=function(){
  var txt=JSON.stringify(datosPlanos(),null,1);
  try{
    var url=URL.createObjectURL(new Blob([txt],{type:'application/json'}));
    var a=document.createElement('a');
    a.href=url;a.download='respaldo-postres-'+hoy()+'.json';
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},4000);
    toast('Respaldo descargado ⬇️');
  }catch(e){
    modal.d.texto=txt;renderModal();
    toast('Copia el texto y guárdalo',1);
  }
};
ACT.restaurar=async function(){
  var d=modal.d,txt=(d.pegado||'').trim();
  if(!txt&&d.contenidoArchivo)txt=d.contenidoArchivo;
  if(!txt){toast('Elige el archivo o pega el texto',1);return;}
  var obj;
  try{obj=JSON.parse(txt);}catch(e){toast('Ese respaldo no se entiende',1);return;}
  if(!obj||typeof obj!=='object'||(!obj.pedidos&&!obj.catalogo)){toast('Ese archivo no es un respaldo válido',1);return;}
  if(!confirmar('rest'))return;
  if(d.trayendo)return;
  d.trayendo=true;renderModal();
  var r;
  try{r=await DB.importar(normalizarRespaldo(obj));}
  catch(e){d.trayendo=false;renderModal();toast(e.message||'No se pudo traer el respaldo',1);return;}
  d.trayendo=false;
  d.resultado=r;renderModal();
  toast(r.fallidos?'Algunos registros no se pudieron guardar':'¡Listo! Se agregaron '+r.nuevos+' registros ✨',r.fallidos>0);
};
// Lo que venga de un archivo se limpia antes de guardarlo: emojis conocidos y números de verdad.
function normalizarRespaldo(obj){
  var o=JSON.parse(JSON.stringify(obj));
  Object.keys(o.catalogo||{}).forEach(function(k){
    var s=o.catalogo[k];if(!s||typeof s!=='object')return;
    if(EMO.indexOf(s.emo)<0)s.emo='🍰';
    s.precio=num(s.precio);s.rinde=Math.max(num(s.rinde)||1,1);s.costoManual=num(s.costoManual);
    s.ingredientes=Array.isArray(s.ingredientes)?s.ingredientes.map(function(x){return {n:String((x&&x.n)||''),c:num(x&&x.c)};}):[];
  });
  Object.keys(o.pedidos||{}).forEach(function(k){
    var p=o.pedidos[k];if(!p||typeof p!=='object')return;
    p.items=Array.isArray(p.items)?p.items.map(function(i){return {s:String((i&&i.s)||''),q:num(i&&i.q),p:num(i&&i.p),r:String((i&&i.r)||'')};}):[];
    p.pagos=Array.isArray(p.pagos)?p.pagos.map(function(x){var y={m:String((x&&x.m)||'Otro'),v:num(x&&x.v),f:String((x&&x.f)||'')};if(x&&x.id)y.id=String(x.id);return y;}):[];
  });
  Object.keys(o.rondas||{}).forEach(function(k){
    var r=o.rondas[k];if(!r||typeof r!=='object')return;
    r.items=Array.isArray(r.items)?r.items.map(function(i){return {s:String((i&&i.s)||''),q:num(i&&i.q)};}):[];
    r.merma=Array.isArray(r.merma)?r.merma.map(function(x){var y={s:String((x&&x.s)||''),q:num(x&&x.q)};if(x&&x.id)y.id=String(x.id);if(x&&x.f)y.f=String(x.f);return y;}):[];
  });
  Object.keys(o.gastos||{}).forEach(function(k){var g=o.gastos[k];if(g&&typeof g==='object')g.valor=num(g.valor);});
  return o;
}
ACT.verHistorial=async function(){
  modal.d.cargandoHist=true;renderModal();
  try{modal.d.hist=await DB.historial(40);}
  catch(e){modal.d.hist=[];toast('Sin señal: el historial se ve cuando haya conexión',1);}
  modal.d.cargandoHist=false;if(modal)renderModal();
};
ACT.papelera=function(){abrir('papelera',{});};
ACT.restaurarBorrado=function(el){
  var c=el.dataset.c,id=el.dataset.id,v=P[c]&&P[c][id];
  if(!v)return;
  var limpio={};Object.keys(v).forEach(function(x){if(x[0]!=='_')limpio[x]=v[x];});
  S[c][id]=limpio;delete P[c][id];
  DB.restaurar(c,id);
  renderModal();toast('Recuperado ✨');
};
ACT.verNube=function(){
  var t={ok:'Todo está guardado en la nube.',guardando:'Subiendo tus cambios a la nube…',
    sinsenal:'No hay señal. Tus cambios están guardados en este celular y se suben cuando abras la app con señal.',
    error:ultimoErr||'Hubo un problema guardando.'}[estadoNube];
  toast(t,estadoNube==='error');
};
ACT.entrar=async function(){
  try{await DB.entrar();}catch(e){toast('No se pudo entrar: '+(e.message||e),1);}
};
ACT.salir=function(){
  if(DB.cambiosPendientes()){toast('Todavía hay cambios sin subir. Abre la app con señal y espera el ✓ Guardado antes de salir.',1);return;}
  modal=null;DB.salir();
};

/* ============ EVENTOS ============ */
document.addEventListener('click',function(e){
  if(e.target.closest('input,select,textarea,label,option'))return;
  var el=e.target.closest('[data-act]');
  if(!el)return;
  var a=el.dataset.act;
  if(a==='cerrarFuera'){if(e.target===el)cerrar();return;}
  var f=ACT[a];
  if(f){
    e.preventDefault();
    var r=f(el,e);
    // Si llegaron datos nuevos mientras escribía, se muestran apenas termina la acción.
    Promise.resolve(r).then(function(){if(pend){pend=false;if(modal)renderModal();else render();}});
  }
});
document.addEventListener('click',function(e){
  var el=e.target;
  if(el&&el.tagName==='INPUT'&&el.type==='date'&&typeof el.showPicker==='function'){
    try{el.showPicker();}catch(err){}
  }
});
document.addEventListener('input',function(e){
  var el=e.target.closest('[data-in]');
  if(!el||!modal)return;
  modal.d[el.dataset.in]=el.value;
  if(el.dataset.in==='clienteId')renderModal();
});
document.addEventListener('change',function(e){
  var el=e.target.closest('[data-in]');
  if(!el||!modal)return;
  if(el.type==='file'){
    var f=el.files&&el.files[0];
    if(f&&typeof FileReader!=='undefined'){
      var rd=new FileReader();
      rd.onload=function(){modal.d.contenidoArchivo=String(rd.result||'');toast('Archivo listo, toca Restaurar');};
      rd.readAsText(f);
    }
    return;
  }
  modal.d[el.dataset.in]=el.value;
  if(el.dataset.in==='clienteId')renderModal();
});

/* ============ ARRANQUE ============ */
var ultimoErr=null;
function pantalla(html){
  document.getElementById('modal').innerHTML='';lockBody(false);
  document.getElementById('root').innerHTML='<div class="load" style="height:auto;min-height:80vh">'+html+'</div>';
}
function vEntrar(){
  pantalla('<div style="font-size:54px">🍰</div><h2>Mis Postres</h2>'+
    '<div class="muted" style="max-width:300px">Entra con tu cuenta de Google. Tus datos quedan guardados en la nube y puedes verlos desde cualquier celular.</div>'+
    '<button class="btn" style="max-width:300px" data-act="entrar">Entrar con Google</button>');
}
function boot(){
  DB.iniciar({
    onUsuario:function(u){
      usuario=u;sinPermiso=null;dbReady=false;
      if(!u){vEntrar();return;}
      pantalla('<div class="spin"></div><div>Abriendo tu negocio…</div>');
    },
    onDatos:function(d,pap,info){
      aplicarDatos(d,pap);
      var vacio=['catalogo','clientes','rondas','pedidos','gastos'].every(function(c){return !Object.keys(S[c]).length;});
      if(info&&!info.confiable&&vacio){
        // Celular nuevo sin señal: no mostramos un negocio vacío como si fuera el real.
        dbReady=false;
        pantalla('<div class="spin"></div><div>Bajando tus datos de la nube…</div>'+
          '<div class="muted" style="max-width:300px">La primera vez en este celular se necesita internet. Si no hay señal, conéctate y espera un momento.</div>');
        return;
      }
      dbReady=true;
      // Si hay una ventana abierta con algo escrito, no la redibujamos para no borrar lo que escribe.
      if(modal){
        var foco=document.activeElement;
        if(foco&&/INPUT|TEXTAREA|SELECT/.test(foco.tagName))pend=true;
        else renderModal();
        return;
      }
      render();
    },
    onEstado:function(e,err){
      estadoNube=e;ultimoErr=err;
      var el=document.getElementById('nube');
      if(el)el.outerHTML=pildoraNube();
    },
    onError:function(msg){toast(msg,1);},
    onCacheLocal:function(){if(dbReady&&!modal)render();},
    onFalloCarga:function(msg){
      if(dbReady)return;
      pantalla('<div style="font-size:48px">⚠️</div><h2>No se pudieron abrir los datos</h2>'+
        '<div class="muted" style="max-width:320px">'+esc(msg)+'</div>'+
        '<button class="btn" style="max-width:300px" onclick="location.reload()">Reintentar</button>');
    },
    onSinPermiso:function(email){
      sinPermiso=email;
      pantalla('<div style="font-size:48px">🔒</div><h2>Esta cuenta no tiene permiso</h2>'+
        '<div class="muted" style="max-width:320px">Entraste como <b>'+esc(email||'')+'</b>. '+
        'Pídele a quien administra la app que agregue este correo, o entra con otra cuenta.</div>'+
        '<button class="btn sec2" style="max-width:300px" data-act="salir">Entrar con otra cuenta</button>');
    }
  });
}

window.__app={S:S,costoUnit:costoUnit,pTotal:pTotal,pPagado:pPagado,pSaldo:pSaldo,pEstado:pEstado,
  pCosto:pCosto,pGanancia:pGanancia,stockDe:stockDe,dispGlobal:dispGlobal,rondasConStock:rondasConStock,
  totales:totales,ventasPorSabor:ventasPorSabor,saldosPorCliente:saldosPorCliente,costoRonda:costoRonda,
  resumenRonda:resumenRonda,
  ACT:ACT,render:render,abrir:abrir,cerrar:cerrar,getModal:function(){return modal;},
  setTab:function(t){tab=t;render();},
  money:money,dias:dias,margen:margen,datosPlanos:datosPlanos,DB:DB};
if(typeof document!=='undefined'){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);
  else boot();
}

// Guarda la app en el celular para que abra aunque no haya señal.
if(typeof navigator!=='undefined'&&'serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost')){
  window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){});});
}
