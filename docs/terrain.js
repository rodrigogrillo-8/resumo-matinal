// terrain.js — desenha o relevo do dia a partir dos eventos.
//
// Uma linha so, continua, de borda a borda. Altitude = carga do dia.
// Nenhuma dependencia. Nenhuma cor fixa: tudo sai dos tokens do CSS.

const NS = 'http://www.w3.org/2000/svg';

export const LARGURA = 840;
export const ALTURA = 170;

const VALE_Y = 148;   // dia vazio
const PICO_Y = 31;    // pico maximo
const AMPLITUDE = VALE_Y - PICO_Y;

const MIN_INICIO = 6 * 60;    // 06:00
const MIN_FIM = 22 * 60;      // 22:00
const PASSO = 15;             // intervalo de amostragem, em minutos
const N = (MIN_FIM - MIN_INICIO) / PASSO;   // 64 amostras
const JANELA = 3;             // media movel de +/-45 min

// dayShape define a escala vertical do relevo.
const ESCALA = { HEAVY: 1, NORMAL: 0.78, OPEN: 0.56 };

// Um dia inteiro de eventos "full" encostados da carga 1. Sobreposicao passa disso,
// entao o teto fica um pouco acima de 1 para que colisoes cheguem ao pico.
const CARGA_TETO = 1.15;

const PESO = { full: 1, light: 0.4 };

const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

/* ---------------------------------------------------------------- tempo */

// Le a hora de parede tal como escrita no ISO. Nao converte para o fuso de quem
// esta lendo: o brief descreve um dia especifico, e e esse dia que desenhamos.
function minutosAbsolutos(iso) {
  const m = RE_ISO.exec(String(iso ?? ''));
  if (!m) return null;
  const dias = Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000;
  return dias * 1440 + (+m[4]) * 60 + (+m[5]);
}

function inicioDoDiaAbsoluto(iso) {
  const m = RE_ISO.exec(String(iso ?? ''));
  if (!m) return null;
  return (Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) * 1440;
}

function normalizarEventos(eventos, diaBase) {
  const brutos = [];
  for (const ev of Array.isArray(eventos) ? eventos : []) {
    const ini = minutosAbsolutos(ev && ev.start);
    const fim = minutosAbsolutos(ev && ev.end);
    if (ini === null || fim === null || fim <= ini) continue;
    brutos.push({ ini, fim, leve: ev.weight === 'light', titulo: String(ev.title ?? '') });
  }
  if (!brutos.length) return [];

  const base = inicioDoDiaAbsoluto(diaBase)
    ?? Math.floor(Math.min(...brutos.map((e) => e.ini)) / 1440) * 1440;

  return brutos
    .map((e) => ({ ...e, ini: e.ini - base, fim: e.fim - base }))
    .sort((a, b) => a.ini - b.ini || a.fim - b.fim);
}

/* -------------------------------------------------------------- geometria */

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

const xDe = (minuto) =>
  clamp(((minuto - MIN_INICIO) / (MIN_FIM - MIN_INICIO)) * LARGURA, 0, LARGURA);

const arred = (n) => Math.round(n * 100) / 100;

// Carga por intervalo de 15 min: minutos ocupados, ponderados por peso.
function cargaPorIntervalo(eventos) {
  const carga = new Array(N).fill(0);
  for (const ev of eventos) {
    const peso = ev.leve ? PESO.light : PESO.full;
    for (let i = 0; i < N; i++) {
      const a = MIN_INICIO + i * PASSO;
      const ocupado = Math.min(ev.fim, a + PASSO) - Math.max(ev.ini, a);
      if (ocupado > 0) carga[i] += ocupado * peso;
    }
  }
  return carga;
}

// Media movel de +/-45 min: vira relevo, nao grafico de barras.
function suavizar(carga) {
  return carga.map((_, i) => {
    let soma = 0;
    for (let j = i - JANELA; j <= i + JANELA; j++) {
      soma += carga[clamp(j, 0, N - 1)];   // estende as bordas, nao afunda nelas
    }
    return soma / (JANELA * 2 + 1);
  });
}

function pontosDoRelevo(eventos, dayShape) {
  const carga = cargaPorIntervalo(eventos);
  const suave = suavizar(carga);
  const total = carga.reduce((a, b) => a + b, 0);
  const amplitude = AMPLITUDE * (ESCALA[dayShape] ?? ESCALA.NORMAL);

  const ys = suave.map((v, i) => {
    // Dia sem nada e agua parada: uma ondulacao minima no vale, jamais uma montanha.
    if (total === 0) {
      return VALE_Y + Math.sin(i * 0.68) * 1.2 + Math.sin(i * 0.21) * 0.7;
    }
    const t = clamp(v / PASSO / CARGA_TETO, 0, 1);
    return VALE_Y - Math.pow(t, 0.8) * amplitude;
  });

  const pontos = ys.map((y, i) => ({ x: xDe(MIN_INICIO + i * PASSO + PASSO / 2), y }));
  // De borda a borda.
  pontos.unshift({ x: 0, y: ys[0] });
  pontos.push({ x: LARGURA, y: ys[ys.length - 1] });
  return pontos;
}

// Catmull-Rom -> Bezier cubica.
function segmentos(pontos) {
  const segs = [];
  for (let i = 0; i < pontos.length - 1; i++) {
    const p0 = pontos[i - 1] || pontos[i];
    const p1 = pontos[i];
    const p2 = pontos[i + 1];
    const p3 = pontos[i + 2] || p2;
    segs.push({
      p1,
      p2,
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
    });
  }
  return segs;
}

function caminho(segs) {
  let d = 'M ' + arred(segs[0].p1.x) + ' ' + arred(segs[0].p1.y);
  for (const s of segs) {
    d += ' C ' + arred(s.c1.x) + ' ' + arred(s.c1.y) +
         ', ' + arred(s.c2.x) + ' ' + arred(s.c2.y) +
         ', ' + arred(s.p2.x) + ' ' + arred(s.p2.y);
  }
  return d;
}

function bezier(a, b, c, d, t) {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

// y exato sobre a curva desenhada — os pontos precisam ficar grudados nela,
// nao perto dela. Bissecao no x da Bezier, que e monotonico aqui.
function yNaCurva(segs, x) {
  let seg = segs[segs.length - 1];
  for (const s of segs) {
    if (x <= s.p2.x) { seg = s; break; }
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 28; i++) {
    const t = (lo + hi) / 2;
    if (bezier(seg.p1.x, seg.c1.x, seg.c2.x, seg.p2.x, t) < x) lo = t;
    else hi = t;
  }
  return bezier(seg.p1.y, seg.c1.y, seg.c2.y, seg.p2.y, (lo + hi) / 2);
}

/* --------------------------------------------------------------- elementos */

function no(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const chave of Object.keys(attrs)) el.setAttribute(chave, String(attrs[chave]));
  return el;
}

function traco(d, cor, largura) {
  return no('path', {
    d: d,
    fill: 'none',
    stroke: cor,
    'stroke-width': largura,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
}

/* ---------------------------------------------------------------- motivos */

function motivoSol(x, y) {
  const g = no('g', {});
  g.appendChild(no('circle', {
    cx: arred(x), cy: arred(y), r: 7.5,
    fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6,
  }));
  let d = '';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    d += ' M ' + arred(x + Math.cos(a) * 11) + ' ' + arred(y + Math.sin(a) * 11) +
         ' L ' + arred(x + Math.cos(a) * 15.5) + ' ' + arred(y + Math.sin(a) * 15.5);
  }
  g.appendChild(traco(d.trim(), 'currentColor', 1.6));
  return g;
}

function motivoSolNascente(x, y) {
  const g = no('g', {});
  g.appendChild(traco('M ' + arred(x - 21) + ' ' + arred(y) +
                      ' L ' + arred(x + 21) + ' ' + arred(y), 'currentColor', 1.6));
  g.appendChild(traco('M ' + arred(x - 10) + ' ' + arred(y) +
                      ' A 10 10 0 0 1 ' + arred(x + 10) + ' ' + arred(y), 'currentColor', 1.6));
  let d = '';
  for (const a of [-2.6, -Math.PI / 2, -0.55]) {
    d += ' M ' + arred(x + Math.cos(a) * 14) + ' ' + arred(y + Math.sin(a) * 14) +
         ' L ' + arred(x + Math.cos(a) * 18.5) + ' ' + arred(y + Math.sin(a) * 18.5);
  }
  g.appendChild(traco(d.trim(), 'currentColor', 1.6));
  return g;
}

function motivoLua(x, y) {
  const g = no('g', {});
  g.appendChild(traco(
    'M ' + arred(x + 2.5) + ' ' + arred(y - 10.5) +
    ' A 11 11 0 1 0 ' + arred(x + 2.5) + ' ' + arred(y + 10.5) +
    ' A 8.6 8.6 0 1 1 ' + arred(x + 2.5) + ' ' + arred(y - 10.5) + ' Z',
    'currentColor', 1.6));
  return g;
}

function motivoPassaros(x, y) {
  const g = no('g', {});
  const asa = (cx, cy, e) =>
    'M ' + arred(cx - 7.5 * e) + ' ' + arred(cy) +
    ' c ' + arred(2.8 * e) + ' ' + arred(-3.4 * e) + ' ' + arred(5 * e) + ' ' +
    arred(-3.4 * e) + ' ' + arred(7.5 * e) + ' 0' +
    ' c ' + arred(2.5 * e) + ' ' + arred(-3.4 * e) + ' ' + arred(4.7 * e) + ' ' +
    arred(-3.4 * e) + ' ' + arred(7.5 * e) + ' 0';
  g.appendChild(traco(asa(x, y, 1), 'currentColor', 1.5));
  g.appendChild(traco(asa(x - 23, y + 8, 0.82), 'currentColor', 1.5));
  g.appendChild(traco(asa(x + 20, y + 10.5, 0.72), 'currentColor', 1.5));
  return g;
}

function motivoTensao(x, y) {
  const g = no('g', {});
  g.appendChild(traco(
    'M ' + arred(x - 12) + ' ' + arred(y) + ' l 4 6 l 3.5 -9 l 4 10 l 4 -8 l 3 5',
    'var(--clay)', 1.6));
  return g;
}

const DESENHOS = {
  sol: motivoSol,
  sol_nascente: motivoSolNascente,
  lua: motivoLua,
  passaros: motivoPassaros,
  tensao: motivoTensao,
};

/* ------------------------------------------------------ pontos do dia */

const raioDe = (ev) => clamp(6 + ((ev.fim - ev.ini) / 90) * 7, 6, 13);

// Junta em um mesmo grupo todo evento que se sobrepoe a outro, direta ou
// indiretamente. Um grupo com mais de um membro vira circulos que se cruzam.
function agrupar(eventos) {
  const pai = eventos.map((_, i) => i);
  const achar = (i) => (pai[i] === i ? i : (pai[i] = achar(pai[i])));

  const colisoes = [];
  for (let i = 0; i < eventos.length; i++) {
    for (let j = i + 1; j < eventos.length; j++) {
      if (eventos[i].ini < eventos[j].fim && eventos[j].ini < eventos[i].fim) {
        pai[achar(i)] = achar(j);
        colisoes.push({
          i,
          j,
          meio: (Math.max(eventos[i].ini, eventos[j].ini) +
                 Math.min(eventos[i].fim, eventos[j].fim)) / 2,
        });
      }
    }
  }

  const mapa = new Map();
  for (let i = 0; i < eventos.length; i++) {
    const r = achar(i);
    if (!mapa.has(r)) mapa.set(r, []);
    mapa.get(r).push(i);
  }

  const grupos = Array.from(mapa.values()).map((membros) => ({
    membros,
    // O grupo se planta sobre a colisao, nao sobre a media dos eventos.
    centro: media(colisoes.filter((c) => membros.includes(c.i)).map((c) => c.meio)),
  }));

  const cruzados = new Set();
  for (const g of grupos) if (g.membros.length > 1) g.membros.forEach((i) => cruzados.add(i));

  return { grupos, cruzados };
}

const media = (ns) => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0);

// Evento sozinho fica no x do proprio meio. Evento em colisao entra numa fila
// justa o bastante para os circulos vizinhos se cruzarem sempre.
function posicoesEmX(eventos, grupos) {
  const posX = new Array(eventos.length);

  for (const g of grupos) {
    if (g.membros.length === 1) {
      const ev = eventos[g.membros[0]];
      posX[g.membros[0]] = xDe(clamp((ev.ini + ev.fim) / 2, MIN_INICIO, MIN_FIM));
      continue;
    }

    const membros = g.membros.slice().sort((a, b) => eventos[a].ini - eventos[b].ini);
    const raios = membros.map((i) => raioDe(eventos[i]));

    // 0.7 da soma dos raios: sempre menor que a soma, entao sempre se cruzam.
    const desloc = [0];
    for (let k = 1; k < membros.length; k++) {
      desloc.push(desloc[k - 1] + 0.7 * (raios[k - 1] + raios[k]));
    }

    const centro = xDe(clamp(g.centro, MIN_INICIO, MIN_FIM));
    const meioDaFila = desloc[desloc.length - 1] / 2;
    membros.forEach((i, k) => {
      posX[i] = clamp(centro + desloc[k] - meioDaFila, 0, LARGURA);
    });
  }

  return posX;
}

/* --------------------------------------------------- escolha dos motivos */

// Intervalos livres dentro da janela 06:00-22:00.
function vaosLivres(eventos) {
  const ocupados = [];
  for (const ev of eventos) {
    const a = clamp(ev.ini, MIN_INICIO, MIN_FIM);
    const b = clamp(ev.fim, MIN_INICIO, MIN_FIM);
    if (b > a) ocupados.push([a, b]);
  }
  ocupados.sort((p, q) => p[0] - q[0]);

  const unidos = [];
  for (const iv of ocupados) {
    const ult = unidos[unidos.length - 1];
    if (ult && iv[0] <= ult[1]) ult[1] = Math.max(ult[1], iv[1]);
    else unidos.push([iv[0], iv[1]]);
  }

  const vaos = [];
  let cursor = MIN_INICIO;
  for (const par of unidos) {
    if (par[0] - cursor > 0) vaos.push([cursor, par[0]]);
    cursor = Math.max(cursor, par[1]);
  }
  if (MIN_FIM - cursor > 0) vaos.push([cursor, MIN_FIM]);

  return vaos.map((par) => ({
    a: par[0], b: par[1], dur: par[1] - par[0], meio: (par[0] + par[1]) / 2,
  }));
}

function piorColisao(eventos) {
  let pior = null;
  for (let i = 0; i < eventos.length; i++) {
    for (let j = i + 1; j < eventos.length; j++) {
      const a = eventos[i];
      const b = eventos[j];
      const sobra = Math.min(a.fim, b.fim) - Math.max(a.ini, b.ini);
      if (sobra > 0 && (!pior || sobra > pior.sobra)) {
        pior = { sobra, meio: (Math.max(a.ini, b.ini) + Math.min(a.fim, b.fim)) / 2 };
      }
    }
  }
  return pior;
}

function candidatos(eventos) {
  const lista = [];
  const vaos = vaosLivres(eventos).sort((p, q) => q.dur - p.dur);

  const colisao = piorColisao(eventos);
  if (colisao) {
    lista.push({ tipo: 'tensao', minuto: colisao.meio, prioridade: 1, clay: true, abaixo: true });
  }

  if (eventos.length) {
    if (eventos[0].ini < 7 * 60 + 30) {
      lista.push({ tipo: 'sol_nascente', minuto: MIN_INICIO + 38, prioridade: 2 });
    }
    const ultimoFim = Math.max.apply(null, eventos.map((e) => e.fim));
    if (ultimoFim > 19 * 60) {
      lista.push({
        tipo: 'lua',
        minuto: clamp(ultimoFim + 28, MIN_INICIO, MIN_FIM - 30),
        prioridade: 2,
      });
    }
  }

  // Bloco livre e criativo de 2h ou mais.
  const grande = vaos.find((v) => v.dur >= 120);
  if (grande) lista.push({ tipo: 'sol', minuto: grande.meio, prioridade: 3 });

  // Espaco para respirar.
  const respiro = vaos.find((v) => v.dur >= 45 && v.dur < 120);
  if (respiro) lista.push({ tipo: 'passaros', minuto: respiro.meio, prioridade: 4 });

  return { lista, vaos };
}

// No maximo um motivo por ato.
function escolher(lista, nAtos) {
  const regioes = Math.max(1, nAtos || 3);
  const largura = (MIN_FIM - MIN_INICIO) / regioes;
  const usadas = new Set();
  const escolhidos = [];

  for (const c of lista.slice().sort((a, b) => a.prioridade - b.prioridade)) {
    const r = clamp(Math.floor((c.minuto - MIN_INICIO) / largura), 0, regioes - 1);
    if (usadas.has(r)) continue;
    usadas.add(r);
    escolhidos.push(c);
  }
  return escolhidos;
}

/* ------------------------------------------------------------- desenho */

/**
 * Desenha o relevo dentro de svg. O elemento e limpo antes.
 *
 * @param {SVGElement} svg
 * @param {object} brief  { events, dayShape, acts, generatedAt }
 * @returns {{ temAcentoClay: boolean, aplicarAcentoClay: function, descricao: string }}
 */
export function desenharTerreno(svg, brief) {
  const dados = brief || {};
  const eventos = normalizarEventos(dados.events, dados.generatedAt);
  const dayShape = ESCALA[dados.dayShape] ? dados.dayShape : 'NORMAL';
  const nAtos = Array.isArray(dados.acts) ? dados.acts.length : 0;

  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute('viewBox', '0 0 ' + LARGURA + ' ' + ALTURA);

  const pontos = pontosDoRelevo(eventos, dayShape);
  const segs = segmentos(pontos);

  // Motivos entram primeiro para ficarem atras da linha e dos pontos.
  const gMotivos = no('g', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  svg.appendChild(gMotivos);

  svg.appendChild(traco(caminho(segs), 'var(--ink)', 2));

  /* --- pontos: um por compromisso, grudado na curva ------------------ */

  const { grupos, cruzados } = agrupar(eventos);
  const posX = posicoesEmX(eventos, grupos);

  const marcas = [];
  eventos.forEach((ev, i) => {
    const x = posX[i];
    const y = yNaCurva(segs, x);
    const r = raioDe(ev);
    const cor = ev.leve ? 'var(--ink-grey)' : 'var(--ink)';

    // Os unicos circulos vazados do desenho: os que se cruzam de verdade.
    const attrs = { cx: arred(x), cy: arred(y), r: arred(r) };
    if (cruzados.has(i)) {
      attrs.fill = 'var(--wash)';
      attrs.stroke = cor;
      attrs['stroke-width'] = 2;
    } else {
      attrs.fill = cor;
      attrs.stroke = 'none';
    }

    svg.appendChild(no('circle', attrs));
    marcas.push({ x, r });
  });

  /* --- motivos ------------------------------------------------------- */

  const escolha = candidatos(eventos);
  const escolhidos = escolher(escolha.lista, nAtos);

  function desenhar(c) {
    // Nenhum motivo encosta na borda: eles tem largura propria.
    const x = clamp(xDe(clamp(c.minuto, MIN_INICIO, MIN_FIM)), 30, LARGURA - 30);
    const yCurva = yNaCurva(segs, x);

    let y;
    if (c.abaixo) {
      y = clamp(yCurva + 20, PICO_Y + 12, ALTURA - 14);
    } else {
      // Nao encostar num ponto que esteja logo abaixo.
      const perto = marcas
        .filter((m) => Math.abs(m.x - x) < 38)
        .reduce((mx, m) => Math.max(mx, m.r), 0);
      y = clamp(yCurva - 26 - perto, 21, VALE_Y - 14);
    }

    const g = DESENHOS[c.tipo](x, y);
    if (!c.clay) g.setAttribute('color', 'var(--ink-soft)');
    g.setAttribute('data-motivo', c.tipo);
    gMotivos.appendChild(g);
    return g;
  }

  escolhidos.forEach(desenhar);

  const temAcentoClay = escolhidos.some((c) => Boolean(c.clay));

  // So um acento em clay no desenho inteiro — e este e o unico jeito de pedir outro.
  function aplicarAcentoClay() {
    if (temAcentoClay) return;
    const existente = gMotivos.querySelector('g[data-motivo]:not([data-motivo="tensao"])');
    if (existente) {
      existente.setAttribute('color', 'var(--clay)');
      return;
    }
    // Nenhum motivo pegou: passaros no trecho mais calmo do dia.
    const calmo = escolha.vaos[0] ? escolha.vaos[0].meio : (MIN_INICIO + MIN_FIM) / 2;
    desenhar({ tipo: 'passaros', minuto: calmo, clay: true });
  }

  const descricao = eventos.length
    ? 'Relevo do dia, com ' + eventos.length +
      (eventos.length === 1 ? ' compromisso.' : ' compromissos.')
    : 'Relevo do dia: nenhum compromisso, uma linha calma.';

  return { temAcentoClay, aplicarAcentoClay, descricao };
}
