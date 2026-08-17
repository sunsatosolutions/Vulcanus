# Vulcanus — Kalan Geliştirme TODO'ları

Öncelikler: **P0** = temel/acil, **P1** = büyük değer katar, **P2** = vizyon/uzun vade.
Efor: S (saatler), M (1–2 gün), L (hafta+).

> **Durum:** İlk 5 sprint `main`'e merge edildi (PR #3). Ardından bu listedeki
> P0/P1 işlerinin tamamı ve P2'nin doküman kısmı bitti: release otomasyonu,
> Windows CI düzeltmesi, `stats`, `--verbose/--quiet`, shell completion, hata
> formatı + çıkış kodları, `sync --json/--watch`, `hooks install`, MCP
> derinleştirme, protokol versiyonlama, skill senkron denetimi, üç yeni importer
> + artımlı import, 140 test, CONTRIBUTING + şablonlar, docs sitesi ve benchmark
> yazısı.
>
> **Yayınlandı:** 0.4.0 → 0.4.1 (2026-08-07), 0.4.2 → 0.4.4 (2026-08-14),
> 0.4.5 → 0.4.7 (2026-08-17). npm'de `latest: 0.4.7`. 0.4.2 konumlandırma ve
> demo, 0.4.3 MCP Registry kaydı, 0.4.4 `serve`'ün vault dışında hiç başlamaması
> hatasının düzeltilmesi, 0.4.5 tool annotation'ları, 0.4.6 manifest alan
> kaybının düzeltilmesi, 0.4.7 `kind`/`visibility` eksenleri ve protokol 2.
>
> **Dağıtım:** npm, resmî MCP Registry (`io.github.sunsatosolutions/vulcanus`,
> her tag'de OIDC ile otomatik) ve Glama (claim + konteyner release'i).
>
> **0.4.0 bozuktu ve geri çekilmeli:** `update` ile `doctor --repair`, Index'i,
> System Hub'ı, grup hub'larını ve Import Log'u yeniden üretip operatörün
> yazdığını siliyordu. MIRA'da gerçek hafıza kaybı yaşandı (git'ten geri alındı).
> 0.4.1 bunu düzeltti; o dört dosya artık `seed`, AGENTS.md `merge`.
>
> Aşağıdaki liste yalnızca **kalan** işlerdir. Bilerek yapılmayanlar en altta,
> gerekçeleriyle.

---

## 1. Altyapı & Kalite (P0)

- [x] **Feature branch'i merge et** — PR #3 `main`'e merge edildi. *(S)*
- [x] **Test coverage eşiği** — CI'da ayrı `coverage` job'ı; `npm run
  coverage:check` eşikleri zorluyor (lines 85 / branches 75 / functions 80). *(S)*
- [x] **Release otomasyonu** — `npm run release -- <sürüm|major|minor|patch>`
  `package.json`, `src/version.ts` ve CHANGELOG başlığını birlikte günceller;
  `v*` tag'i push'lanınca `.github/workflows/release.yml` bütün kontrolleri
  tekrar koşup `npm publish --provenance` yapıyor ve GitHub release notlarını
  elle yazılmış CHANGELOG bölümünden üretiyor. Sürüm sapmasını test yakalıyor.
  *(release-please/changesets değil: CHANGELOG burada elle yazılmış düzyazı,
  conventional-commit üretimi onu bozardı.)* *(M)*
- [x] **Dependabot** — `.github/dependabot.yml`: haftalık npm + github-actions,
  dev/prod grupları. *(S)*
- [x] **`exports` alanı ekle** — `src/index.ts` barrel'ı, `exports`/`main`/`types`
  map'i ve `.d.ts` üretimi. *(S)*
- [x] **Windows yol güvenliği** — Windows CI aslında **kırmızıydı**: `node --test
  test/*.test.ts` shell glob'una dayanıyor, PowerShell genişletmiyor, yani hiçbir
  test koşmuyordu. Dosya listesi artık `scripts/run-tests.mjs` içinde JavaScript
  tarafında genişliyor. Ayrıca dosya sisteminden gelen yollar `vaultRelative()`
  ile "/" formuna normalize ediliyor. *(M)*
- [x] **`update` manifest'teki tanımadığı alanları sessizce siliyordu** (0.4.6) —
  0.4.0'ın not silme hatasının manifest'teki karşılığı. Manifest'i okuyan her
  komut dosyayı alan alan yeniden kuruyordu, yani CLI'ın tanımadığı her anahtar
  bir sonraki yazımda gidiyordu. Gerçek bir vault'ta 13 projenin elle eklenmiş
  `kind` ve `visibility` değerleri 0.4.1 → 0.4.5 güncellemesinde birden düştü;
  kritik olan, kaybolanlar arasında `visibility: private` işaretlerinin
  bulunmasıydı. Ne `update` çıktısı ne `doctor` bundan söz etti; `git diff`
  olmasa görülmezdi. Okuma artık budamadan varsayılan dolduruyor, her katman
  kendine verileni koruyor. `test/preserve.test.ts` bunu doğruluyor. *(M)*

## 1b. Manifest Şeması (P1)

- [x] **Projelere `kind` ve `visibility` ekseni** (0.4.7) — projede opsiyonel iki
  alan: `kind` (`umbrella`, `product`, `lab`, `service-brand`, `client`,
  `client-product`) projenin ne olduğunu, `visibility` (`public` / `private`)
  adının dışarıda anılıp anılamayacağını söyler. `init` ve `add project` ikisini
  de soruyor; `visibility` cevap public olsa bile yazılıyor, çünkü "kimse bir şey
  demedi" ile "operatör public dedi" farklı durumlar ve yalnız biri güvenli.
  `recall` ve `list_projects` alanları döndürüyor, private projede bayrak değil
  düpedüz talimat basıyor. `doctor` tanımadığı değeri uyarıyor — `privte` gibi
  bir yazım hatası her ajana public diye okunurdu. Erişim denetimi değil, ajan
  sinyali: hiçbir şey şifrelenmiyor. **Protokol 2:** `AGENTS.md` kuralı taşıyor
  ve vault'ta private işaretli proje varsa onları `Project visibility` başlığı
  altında sayıyor; sadece tool yolunu bilmek düzyazı yolunu okuyan ajanı
  bilgisiz bırakıyordu. *(M)*

- [ ] **`doctor` düzyazı çapraz referansını fazlalık sayıyor** — `hubExpectations`
  bir hub'ın beklenen çocuk kümesini üretiyor, `src/doctor/index.ts` ise dosyadaki
  **her** wiki link'ini o kümeyle karşılaştırıp fazlasını uyarı basıyor. Ama bir
  hub yalnız navigasyon listesi değil; düzyazısı da var ve o düzyazı doğal olarak
  başka hub ve capsule'lere referans veriyor — "şu ürün müşterinin, X Hub altında
  yaşıyor" cümlesi tam da operatörün yazmasını istediğimiz şey. Bugün bunun
  cezası, vault sahibinin ya doğru cümleyi silmesi ya da uyarıyla yaşaması.
  Navigasyon bölümündeki linkleri (liste öğesi, beklenen bölüm altında) düzyazı
  içindekilerden ayır; ya da manifest'te bir izin listesi olsun. Uyarı ancak
  navigasyon kümesi sapıyorsa çıkmalı. *(M)*
- [ ] **Operatörün kendi sistem notu manifest'e yazılamıyor** — `schema.ts`'de
  sistem notları profile göre sabit liste, `specialized` yalnız proje seviyesinde.
  Vault sahibi `00_System` altına kendi notunu koyup System Hub'dan bağladığında
  `doctor` hem notu UNMANAGED sayıyor hem de hub'ı "fazla link" diye uyarıyor —
  gerçek bir vault'ta 648 satırlık dört aktif not bu durumda. Not silinecek bir
  şey değil, manifest'in tanımadığı bir şey. `structure` yanına vault seviyesinde
  bir `systemNotes` (ya da proje `specialized`'ının eşleniği) gerekiyor: operatör
  yazsın, `update` üretmesin ama tanısın, hub link'i meşru sayılsın. Yukarıdaki
  madde ile birlikte çözülürse ikisi de tek uyarı sınıfını kapatıyor. *(M)*

## 2. Test Genişletme (P1)

- [x] **Importer edge-case'leri** — boş export, bozuk JSON batch, yarım yazılmış
  JSONL satırı, exotic unicode başlıklar, her adapter'ın kendine ait olmayan
  dizini reddetmesi. *(M)*
- [x] **MCP server transport testi** — `InMemoryTransport` ile gerçek client;
  tool listesi, açıklama kalitesi, `recall`, hata yolu ve `append_decision`. *(S)*

## 3. CLI UX (P1)

- [x] **`--json` çıktısını yaygınlaştır** — `sync --json` (doctor sonucu, bekleyen
  değişiklikler, commit hash, push gerçekten oldu mu) ve `import --json`
  (adaylar + kanıt, hiçbir şey yazmadan). *(S)*
- [x] **`--verbose` / `--quiet`** — global seviye, `src/ui.ts` üzerinden.
  `--json` otomatik quiet: makine çıktısı stdout'u tek başına sahiplenir. *(S)*
- [x] **Shell completion** — `vulcanus completion bash|zsh|fish|pwsh`, tek bir
  komut tanımından üretiliyor. *(S)*
- [x] **Hata mesajlarını zenginleştir** — `src/errors.ts`: her hata "ne oldu /
  neden / ne yapmalı"; çıkış kodları (`0/1/2/130`) sözleşme olarak `--help`'te ve
  README'de. *(M)*
- [x] **`vulcanus stats`** — cold start, tipik recall ve tüm vault maliyeti; proje
  başına capsule/cluster. `--json` var. *(M)*

## 4. Ajan Entegrasyonu (P1–P2)

- [x] **MCP server'ı derinleştir** — `update_capsule` (tek bölüm, kör dosya
  yazımı yok), `append_rule`, ve capsule bayatsa `recall` cevabında uyarı. *(M)*
- [x] **`vulcanus sync --watch`** — her düzenlemede managed dosyaları yeniden
  üretip grafı doğruluyor; commit/push **yapmıyor** (bilerek). *(M)*
- [x] **Git hook entegrasyonu** — `vulcanus hooks install/uninstall`,
  `core.hooksPath` uyumlu, başkasının hook'unu `--force` olmadan ezmiyor. *(S)*
- [x] **Skill senkron denetimi** — `.claude/skills/` ↔ `.agents/skills/` kopyaları
  saparsa `doctor` uyarıyor. *(S)*
- [x] **`serve` için skill/doküman** — USING-WITH-AI.md'de MCP bölümü ve üretilen
  vault'larda `<vault>-serve` skill'i. *(S)*
- [x] **AGENTS.md protokol versiyonlama** — AGENTS.md'de protokol damgası;
  `doctor` eski protokolü uyarıyor, CLI'dan yeni protokolü reddediyor. *(M)*
- [x] **`serve` vault dışında da başlıyor** (0.4.4) — vault her tool çağrısında
  çözülüyor, kurulumda değil. Global kaydedilen sunucu artık vault dışındaki
  repolarda ölmüyor; introspection duruma bağlı olamaz. *(S)*
- [x] **Tool annotation'ları** (0.4.5) — `readOnlyHint`, `destructiveHint`,
  `idempotentHint`, `openWorldHint` sekiz aracın hepsinde. Client onay gerekip
  gerekmediğini bayraktan okuyor, düzyazıdan değil; test okuma/yazma ayrımını
  doğruluyor. *(S)*

## 5. Importer Genişletme (P1)

- [x] **Gemini CLI oturumları** — `~/.gemini/tmp/**/logs.json` + kaydedilmiş
  `checkpoint-<tag>.json` sohbetleri. *(M)*
- [x] **Cursor oturumları** — workspace başına `state.vscdb`; proje sinyali
  workspace klasörü. Node 22.5+ (`node:sqlite`) altında kendini "yok" diye
  bildiriyor, sessizce boş dönmüyor. *(M)*
- [x] **Genel Markdown/klasör importu** — klasör adları proje sinyali. Otomatik
  taranmıyor; yalnız yol verilince. *(M)*
- [x] **Artımlı import** — varsayılan davranış; okunan konuşma ID'leri vault'un
  state dizininde (manifest'te değil: binlerce ID diff'i okunamaz hale getirir),
  `--all` hepsini yeniden okur. *(M)*
- [ ] **`--ai` ile akıllı kümeleme** — kelime-frekans analizini, kurulu AI CLI'a
  konuşma özetletip kümeletme ile güçlendir (opt-in). *(L)*

## 6. i18n & Dokümantasyon (P2)

- [ ] **Üretilen notları da yerelleştir** — *(yeni, ve aşağıdaki iki i18n
  maddesinin ön koşulu)* Bugün yalnız sihirbaz çevrili; notlar locale ne olursa
  olsun İngilizce üretiliyor. *(L)*
- [ ] **String'leri dışa al** — `i18n.ts`'i locale-başına JSON'a böl. *(M)*
- [ ] **Yeni diller** — `de`, `es`. *(S/dil)*
- [x] **CONTRIBUTING.md + issue/PR şablonları** *(S)*
- [x] **Docs sitesi genişletme** — 13 komut, MCP bölümü. *(L → kısmi: SSS ve tam
  komut referansı hâlâ yok)*
- [x] **Asciinema/VHS demo** — `docs/demo.gif`: `init` → `status` → `stats`.
  Kaydı üreten `docs/demo.tape` repoda, repo kökünden `vhs docs/demo.tape` ile
  yeniden üretiliyor; vault `/tmp` altında kuruluyor ki görüntüde ev dizini
  geçmesin. README'ye eklendi. *(S)*
- [ ] **Örnek vault repo'su** — `vulcanus-example-vault`. *(S)*

## 7. Dağıtım & Görünürlük (P2)

- [x] **npm provenance** — release workflow `--provenance` ile yayınlıyor
  (OIDC). *(S)*
- [x] **`NPM_TOKEN` secret'ı + `npm-publish` environment'ı** — tanımlandı.
  Environment'ta onay kuralı yok: tag push'lanır push'lanmaz yayın başlar. *(S)*
- [x] **Resmî MCP Registry** — `server.json` +`package.json`'da `mcpName`;
  `io.github.sunsatosolutions/vulcanus` yayında. `release.yml` her tag'de OIDC
  ile yeniden yayınlıyor, saklanan secret yok. *(M)*
  *(Not: `mcp-publisher login github` device flow'u `read:org` scope'u almıyor,
  bu yüzden org namespace'i 403 veriyor; elle yayın gerekirse `read:org`
  scope'lu PAT ile `login github -token` şart.)*
- [x] **Dizin/liste gönderimleri** — punkpeye/awesome-mcp-servers PR #12142
  (badge eklendi, bot şartı karşılandı, merge bekliyor), awesome-claude-code
  #2523 (bot doğrulaması geçti, bakımcı incelemesinde). wong2/awesome-mcp-servers
  dışarıdan gönderim almıyor: PR, issue ve discussion kapalı. *(S)*
- [x] **Glama listelemesi** — `glama.json` ile claim edildi, konteyner release'i
  yayında (0.4.4, ardından 0.4.5). Maintenance ve lisans A, sekiz aracın hepsi A.
  Dockerfile repodan okunmuyor: Glama kendi panelindeki build spec'ten üretiyor
  ve `CMD`'ye `serve` verilmesi şart — yoksa `init` sihirbazı açılıp
  mcp-proxy zaman aşımına düşüyor. *(M)*
- [x] **Konumlandırma** — README artık ürünü değil sorunu ile açılıyor; npm
  keyword'leri 5'ten 16'ya çıktı (`mcp`, `claude-code`, `cursor`, `codex`,
  `agent-memory` …); site meta/paylaşım kartları aranan terimleri içeriyor. *(S)*
- [ ] **Homebrew tap** — ayrı repo gerekiyor. *(M)*
- [ ] **Show HN / Reddit duyurusu** — asıl eksik kanal. 14 Ağustos 2026
  itibarıyla repo trafiği 14 günde 5 görüntülenme; ürün değil bilinirlik
  sorunu. Yasin'in kendi sesiyle gitmeli. *(S)*
- [ ] **Sürüm duyuru otomasyonu** *(S)*
- [x] **0.4.0'ı npm'de deprecate et** — 2026-08-07'de yapıldı; kuranlar artık
  uyarı görüyor. *(S)*
- [x] **Benchmark yazısı** — [`docs/token-budget.md`](docs/token-budget.md):
  6 projelik vault'ta ölçüm, yöntem ve **neyi kanıtlamadığı** açıkça yazılı. *(M)*

---

## Bilerek yapılmayanlar

- **i18n JSON'a çıkarma ve de/es** — üretilen notlar henüz yerelleştirilmediği
  için yeni bir sihirbaz dili yarım bir deneyim üretir (Almanca sihirbaz,
  İngilizce notlar). Doğru sıra: önce üretimi yerelleştir.
- **Örnek vault repo'su, Homebrew tap, duyuru otomasyonu** — ayrı repo veya
  hesap erişimi gerekiyor; kod tarafında yapılabilecek bir şey yok.
  *(Asciinema/VHS demo bu listeden çıktı: 14 Ağustos 2026'da kaydedildi.)*
- **npm 2FA** — hesap ayarı. Granular token CI için 2FA'yı baypas eder,
  hesaptaki 2FA açık kalır.

## Önerilen sıra

1. ~~Merge + coverage + Dependabot + `exports`~~ — **bitti**
2. ~~Release otomasyonu, Windows CI, stats, CLI UX, MCP derinleştirme,
   importer'lar, testler, docs~~ — **bitti**
3. ~~0.4.0 + 0.4.1 yayını~~ — **bitti**
4. ~~`update`'in bilinmeyen manifest alanlarını silmesi → `kind`/`visibility`
   ekseni~~ — **bitti** (0.4.6 + 0.4.7)
5. Üretilen notların yerelleştirilmesi → i18n dışa alma → yeni diller
6. `--ai` ile akıllı kümeleme; demo kaydı ve örnek vault repo'su
