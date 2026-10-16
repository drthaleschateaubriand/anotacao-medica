/* Service worker do Anotação Médica. Escopo = subcaminho do app (/anotacao-medica/).
 * Estratégia: navegação = rede primeiro (cai para o shell em cache offline); assets estáticos = cache primeiro.
 * Chamadas à API (Supabase) são de outra origem e NUNCA passam pelo cache. */
const VERSION = "v1"; // aumente a cada mudança no SW: o activate apaga caches de versões antigas
const CACHE = "anotacao-medica-" + VERSION;
const SCOPE = self.registration.scope; // ex.: https://.../anotacao-medica/

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([SCOPE, SCOPE + "manifest.webmanifest", SCOPE + "icons/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("anotacao-medica-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return; // só o próprio app
  if (req.mode === "navigate") {
    e.respondWith(
      // cache:'no-cache' = sempre revalida com o servidor (o GitHub Pages manda max-age=600: sem isto um index.html velho apontaria para assets já removidos)
      fetch(new Request(req.url, { cache: "no-cache", credentials: "same-origin" })).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(SCOPE, copy)); } return res; }).catch(() => caches.match(SCOPE)),
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && (url.pathname.includes("/assets/") || url.pathname.includes("/icons/"))) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })),
  );
});
