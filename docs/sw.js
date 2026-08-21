// sw.js — casca do app em cache-first, brief em stale-while-revalidate.

const VERSAO = 'v1';
const CACHE_CASCA = 'resumo-casca-' + VERSAO;
const CACHE_DADOS = 'resumo-dados-' + VERSAO;
const NOSSOS = [CACHE_CASCA, CACHE_DADOS];

const CHAVE_DADOS = new URL('./data/latest.json', self.location).href;

// So a raiz do escopo, nunca './index.html': alguns servidores estaticos
// redirecionam um para o outro, e cache.addAll recusa resposta redirecionada.
const CASCA = [
  './',
  './app.js',
  './terrain.js',
  './styles.css',
  './manifest.webmanifest',
  './icons/icone-192.png',
  './icons/icone-512.png',
  './icons/icone-512-maskable.png',
  './icons/apple-touch-180.png',
];

/* ---------------------------------------------------------------- ciclo */

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    const casca = await caches.open(CACHE_CASCA);
    await casca.addAll(CASCA);

    // O brief entra junto para que a primeira abertura offline ja tenha algo.
    const dados = await caches.open(CACHE_DADOS);
    await dados.add(CHAVE_DADOS).catch(() => {});

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter((n) => !NOSSOS.includes(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

/* ---------------------------------------------------------------- dados */

function geradoEm(bruto) {
  try {
    return JSON.parse(bruto).generatedAt || null;
  } catch (e) {
    return null;
  }
}

async function avisarClientes() {
  const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of clientes) c.postMessage({ tipo: 'brief-atualizado' });
}

// Busca na rede, grava no cache e avisa a tela se o brief tiver mudado.
async function revalidarDados(cache, emCache) {
  try {
    const resp = await fetch(CHAVE_DADOS, { cache: 'no-store', credentials: 'same-origin' });
    if (!resp.ok) return null;

    const novoTexto = await resp.clone().text();
    if (geradoEm(novoTexto) === null) return null;   // resposta que nao e um brief

    const antigoTexto = emCache ? await emCache.clone().text() : null;
    await cache.put(CHAVE_DADOS, resp.clone());

    if (antigoTexto === null || geradoEm(antigoTexto) !== geradoEm(novoTexto)) {
      await avisarClientes();
    }
    return resp;
  } catch (e) {
    return null;   // offline: quem esta na tela continua valendo
  }
}

async function briefStaleWhileRevalidate(ev) {
  const cache = await caches.open(CACHE_DADOS);
  const emCache = await cache.match(CHAVE_DADOS);

  if (emCache) {
    // Entrega o que ja temos agora; a rede corre atras.
    ev.waitUntil(revalidarDados(cache, emCache));
    return emCache;
  }

  const fresca = await revalidarDados(cache, null);
  return fresca || new Response('', { status: 504, statusText: 'sem brief em cache' });
}

/* ---------------------------------------------------------------- casca */

async function cascaPrimeiroCache(req) {
  const emCache = await caches.match(req, { ignoreSearch: true });
  if (emCache) return emCache;
  try {
    const resp = await fetch(req);
    if (resp && resp.ok && resp.type === 'basic') {
      const cache = await caches.open(CACHE_CASCA);
      cache.put(req, resp.clone());
    }
    return resp;
  } catch (e) {
    if (req.mode === 'navigate') {
      const raiz = await caches.match('./');
      if (raiz) return raiz;
    }
    throw e;
  }
}

/* ---------------------------------------------------------------- fetch */

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.href.split('?')[0] === CHAVE_DADOS) {
    ev.respondWith(briefStaleWhileRevalidate(ev));
    return;
  }

  if (req.mode === 'navigate') {
    ev.respondWith((async () => {
      const raiz = await caches.match('./');
      if (!raiz) return cascaPrimeiroCache(req);

      // Entrega a casca em cache e busca uma versao nova por tras.
      ev.waitUntil((async () => {
        try {
          const resp = await fetch('./', { cache: 'no-store' });
          if (resp.ok && !resp.redirected) {
            (await caches.open(CACHE_CASCA)).put('./', resp);
          }
        } catch (e) { /* offline: a casca em cache continua valendo */ }
      })());
      return raiz;
    })());
    return;
  }

  ev.respondWith(cascaPrimeiroCache(req));
});

/* -------------------------------------------------------------- mensagens */

self.addEventListener('message', (ev) => {
  const dados = ev.data || {};

  if (dados.tipo === 'revalidar') {
    ev.waitUntil((async () => {
      const cache = await caches.open(CACHE_DADOS);
      await revalidarDados(cache, await cache.match(CHAVE_DADOS));
    })());
  }

  if (dados.tipo === 'pular-espera') self.skipWaiting();
});
