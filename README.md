# Resumo Matinal

PWA instalável que mostra o briefing diário no celular. Abre de manhã, olhada de
trinta segundos, segue o dia.

O app **não gera** conteúdo. Ele lê `docs/data/latest.json` — publicado por uma tarefa
agendada externa — e renderiza. É um renderizador fiel, não uma fonte de dados.

HTML, CSS e JavaScript puro (ES modules). Sem framework, sem bundler, sem passo de
build, sem nenhuma dependência em runtime. O site publicado é 100% estático.

---

## Rodar local

```bash
npx serve docs
```

Abre em `http://localhost:3000`. É só isso — não há nada para compilar.

Para desenvolver sem depender da tarefa agendada, `docs/data/exemplo.json` é um brief
fictício que exercita todos os casos (evento leve, sobreposição, seção vazia, link sem
`href`). Publique ele por cima do `latest.json`:

```bash
node scripts/publicar.mjs docs/data/exemplo.json
```

## Publicar um brief novo

`scripts/publicar.mjs` valida contra o schema e só então grava. JSON inválido falha
dizendo qual campo está errado e **não encosta** no `latest.json` que já está no ar.

```bash
node scripts/publicar.mjs brief.json
```

Também aceita stdin:

```bash
cat brief.json | node scripts/publicar.mjs
```

Cada publicação grava dois arquivos:

- `docs/data/latest.json` — o que o app lê
- `docs/data/arquivo/AAAA-MM-DD.json` — cópia, com a data tirada de `generatedAt`

### O comando exato da tarefa agendada

Depois de montar o JSON, a tarefa **"Resumo matinal"** precisa rodar isto na raiz do
repositório para o app se atualizar sozinho:

```bash
node scripts/publicar.mjs brief.json && git add docs/data && git commit -m "resumo de $(date +%F)" && git push
```

O `&&` importa: se a validação falhar, nada é commitado e o brief de ontem continua
no ar, inteiro.

## GitHub Pages

1. Suba o repositório para o GitHub.
2. **Settings → Pages → Source: Deploy from a branch → branch `main`, pasta `/docs`.**
3. Em um ou dois minutos o app está em `https://<usuario>.github.io/<repo>/`.

Todos os caminhos do app são relativos (`./`), então ele funciona em subpasta sem
nenhum ajuste.

## Instalar no celular

**iPhone (Safari).** Abra a URL → botão de compartilhar → **Adicionar à Tela de Início**.
Abre em tela cheia, sem barra de endereço. As metatags de iOS e o `apple-touch-icon`
de 180px já estão no `index.html` — o manifest sozinho não cobre isso.

**Android (Chrome).** Abra a URL → menu ⋮ → **Instalar app** (ou aceite o convite que
o Chrome oferece sozinho).

Depois da primeira abertura o app funciona offline: a casca fica em cache e o último
brief continua aparecendo inteiro, inclusive em modo avião.

---

## Contrato do JSON

`docs/data/latest.json`, versão 1 do schema.

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-21T09:00:00-03:00",
  "timezone": "America/Sao_Paulo",
  "dayDate": "Sexta-feira · 21 de agosto de 2026",
  "dayShape": "HEAVY",
  "headline": "Bloco de aula até quase uma — a tarde fica toda por sua conta.",
  "events": [
    { "title": "...", "start": "2026-08-21T09:00:00-03:00", "end": "2026-08-21T10:50:00-03:00", "weight": "full" }
  ],
  "acts": [
    { "time": "9 – 10:50 AM", "text": "Uma frase sobre esse trecho do dia." }
  ],
  "needsAttention": [
    { "title": "Título curto", "text": "Uma frase.", "linkText": "no e-mail de hoje", "href": "https://..." }
  ],
  "resolved": [],
  "sections": [
    {
      "heading": "Notícias do Mercado Financeiro",
      "kind": "rows",
      "rows": [
        { "label": "Ibovespa", "delta": "+0,90%", "dir": "up", "value": "167.830 pontos" }
      ],
      "sourceNote": "Dados de 20/08/2026",
      "sources": [{ "label": "InfoMoney", "href": "https://..." }]
    },
    { "heading": "Outra seção", "kind": "prose", "text": "Alguns parágrafos." }
  ]
}
```

### Campos

| Campo | Obrigatório | Regra |
|---|---|---|
| `schemaVersion` | sim | exatamente `1` |
| `generatedAt` | sim | ISO 8601 **com fuso explícito** |
| `timezone` | sim | texto, ex.: `America/Sao_Paulo` |
| `dayDate` | sim | texto já formatado para leitura |
| `dayShape` | sim | `HEAVY` \| `NORMAL` \| `OPEN` — escala vertical do terreno |
| `headline` | sim | texto |
| `events[]` | não | `title`, `start`, `end`, `weight` |
| `events[].weight` | sim | `full` (confirmado) \| `light` (opcional, sem resposta) |
| `acts[]` | não | `text` obrigatório, `time` opcional |
| `needsAttention[]`, `resolved[]` | não | `title` obrigatório; `text`, `linkText`, `href` opcionais |
| `sections[]` | não | `heading` e `kind` obrigatórios |
| `sections[].kind` | sim | `rows` (usa `rows[]`) \| `prose` (usa `text`) |
| `rows[].dir` | não | `up` \| `down` \| `flat` |
| `sourceNote`, `sources[]` | não | `sources[].label` obrigatório, `href` opcional |

As listas ausentes valem como listas vazias. **Campo desconhecido é erro**: para
acrescentar algo, mude `CHAVES` em `scripts/publicar.mjs` e documente aqui.

`href` é opcional em toda parte e só aceita `http`/`https`. Sem `href`, o `linkText`
vira texto simples — nunca um link morto.

### O que o app faz com isso

- `needsAttention` e `resolved` vazios ao mesmo tempo → uma linha calma no lugar das
  duas listas: *"Nada precisa de você nesta manhã."*
- Seção sem conteúdo é omitida por inteiro, título e tudo.
- Se o brief em cache for de um dia anterior, aparece uma linha discreta em `--ink-grey`:
  *"Mostrando o resumo de &lt;data&gt;."*
- Todo texto vindo do JSON entra como `textContent`. O conteúdo é tratado como dado
  não-confiável, sempre.

---

## O terreno

`docs/terrain.js` desenha uma linha só, contínua, de borda a borda. Altitude é carga
do dia, e o desenho não inventa nada que os eventos não digam.

1. O eixo x mapeia **06:00 → 22:00** na largura do `viewBox` (840 × 170).
2. Vale (dia vazio) em `y = 148`; pico máximo em `y = 31`.
3. Carga por intervalo de 15 min: minutos ocupados, peso `1.0` para `full` e `0.4`
   para `light`.
4. Média móvel de ±45 min — vira relevo, não gráfico de barras.
5. Carga → `y` com easing, escalado por `dayShape`.
6. Um único `<path>`, Catmull-Rom suavizado em Bézier cúbica.
7. **Dia sem eventos vira água parada**: uma linha quase reta no vale.

**Pontos.** Um por evento, no x do meio, grudado na curva (o `y` sai da avaliação da
própria Bézier, não de uma aproximação). Raio `6 + duração/90 × 7`, entre 6 e 13.
`full` preenchido, `light` em cinza.

Sobreposição real entre dois eventos → dois círculos vazados que se cruzam,
preenchidos com a cor de fundo. São os únicos círculos vazados do desenho. Para que
eles se cruzem de verdade, e não só fiquem por perto, os eventos em colisão saem do x
do próprio meio e se plantam **sobre o centro da colisão**, espaçados por 70% da soma
dos raios. Três ou mais eventos encadeados viram uma fileira em que cada vizinho
cruza o seguinte.

**Motivos.** No máximo um por ato, e no máximo um acento em clay no desenho inteiro:

| Motivo | Quando |
|---|---|
| Sol | bloco livre de 2h+ |
| Sol nascendo no horizonte | primeiro evento antes das 7:30 |
| Lua crescente | último evento terminando depois das 19:00 |
| Pássaros | espaço para respirar (vão de 45 a 120 min) |
| Rabisco de tensão (clay) | sob a pior colisão de horários |

Se o dia não tem nenhum link nem acento no desenho, o app força um elemento em clay
para a página não ficar monocromática.

---

## Scripts de desenvolvimento

Nenhum deles roda em produção — o site publicado é estático.

```bash
npm install          # sharp e playwright, só para os scripts abaixo
npm run icones       # gera docs/icons/ a partir de scripts/icone-fonte.svg
npm run verificar    # roda os critérios de aceite num Chromium e salva capturas/
npm run publicar     # atalho para node scripts/publicar.mjs
```

`npm run verificar` sobe um servidor estático próprio e roda tudo num Chromium de
verdade, em viewport de iPhone: relevo de um dia vazio, platô de eventos colados,
círculos que se cruzam, listas vazias, seção sem conteúdo, `href` ausente, texto do
JSON escapado, brief de ontem, primeira abertura sem rede, modo avião depois de uma
abertura, chegada de um brief novo, e os critérios de instalabilidade um por um. As
capturas em modo claro e escuro vão para `capturas/`.

**`scripts/embutir-fonte.mjs`** embute a Fraunces 600 no `docs/styles.css` como data
URI base64, dentro do bloco `/* fraunces:inicio */ … /* fraunces:fim */`. Já está
embutida; só é preciso rodar de novo para trocar a fonte:

```bash
npm pack @fontsource/fraunces && tar -xzf fontsource-fraunces-*.tgz
node scripts/embutir-fonte.mjs package/files/fraunces-latin-600-normal.woff2
```

Sem Google Fonts, sem CDN: a headline renderiza na fonte certa já na primeira
abertura, e offline.

## Estrutura

```
docs/                     # é isto que o GitHub Pages serve
  index.html
  app.js                  # busca o JSON, monta a tela
  terrain.js              # desenha o SVG do terreno
  styles.css              # tokens, modo escuro e a Fraunces embutida
  manifest.webmanifest
  sw.js                   # casca em cache-first, brief em stale-while-revalidate
  icons/                  # 192, 512, 512-maskable, apple-touch-180
  data/
    latest.json           # o brief mais recente — é isto que o app lê
    exemplo.json          # brief fictício, para desenvolver
    arquivo/              # cópias por data
scripts/
  publicar.mjs            # valida um brief e grava em docs/data/latest.json
  gerar-icones.mjs
  embutir-fonte.mjs
  verificar.mjs           # critérios de aceite no Chromium
  icone-fonte.svg
```

## O que este app não faz

Sem login, sem conta, sem analytics, sem telemetria. Não chama API do Google, de
cotações nem de LLM — só lê o JSON. Não tem backend. Não usa `localStorage`: o brief
mora no cache do service worker.

## Licença

MIT. A Fraunces é distribuída sob a SIL Open Font License 1.1.
