# Vulcanus — Geliştirme TODO Listesi

Projeyi bir sonraki seviyeye taşımak için iş listesi. Öncelikler:
**P0** = temel/acil, **P1** = büyük değer katar, **P2** = vizyon/uzun vade.
Efor: S (saatler), M (1–2 gün), L (hafta+).

---

## 1. Altyapı & Kalite (P0)

- [x] **CI pipeline kur** — `.github/workflows/ci.yml`: typecheck + test + `format:check`,
  Node 18 / 20 / 22 matrisi, Ubuntu + macOS + Windows. Şu an hiç CI yok. *(S)*
- [x] **ESLint ekle** — `typescript-eslint` + `eslint-config-prettier`; `no-floating-promises`
  gibi async hatalarını yakalayan kurallar CLI için kritik. *(S)*
- [ ] **Test coverage raporu** — `node --test`'in `--experimental-test-coverage`'ı veya `c8`;
  CI'da eşik koy (%80 hedef). Şu an sadece 3 test dosyası var (`vault`, `ai`, `importers`);
  `doctor`, `update`, `sync`, `migrate`, `i18n` test edilmiyor. *(M)*
- [ ] **Release otomasyonu** — `release-please` veya `changesets`: CHANGELOG üretimi,
  sürüm tag'i, `npm publish --provenance` ile otomatik yayın. *(M)*
- [ ] **Dependabot / Renovate** — bağımlılık güncellemeleri otomatik PR olsun. *(S)*
- [ ] **`exports` alanı ekle** — `package.json`'da sadece `bin` var; programatik kullanım
  (ör. testlerden veya başka araçlardan import) için `exports` map tanımla. *(S)*
- [ ] **Windows yol güvenliği** — `path.join`/`sep` kullanımını gözden geçir, CI'daki
  Windows koşusu ile doğrula (vault içi linkler her zaman `/` olmalı). *(M)*

## 2. Test Genişletme (P0–P1)

- [x] **`doctor` testleri** — bozuk manifest, kırık wikilink, eksik nota karşı `--repair`'in
  gerçekten onardığını doğrulayan senaryolar. *(M)*
- [x] **E2E init testi** — geçici dizinde `init -y` koş, üretilen vault'u `doctor` ile
  doğrula; Obsidian vault'u algılama senaryoları (tek vault / çoklu vault / `--target`). *(M)*
- [ ] **Importer edge-case'leri** — boş export, bozuk JSON, dev dosya (streaming),
  çok parçalı ChatGPT export'u, exotic unicode başlıklar. *(M)*
- [x] **i18n bütünlük testi** — `tr` ve `en` anahtar kümelerinin birebir eşleştiğini
  otomatik doğrula (446 satırlık `i18n.ts` elle senkron tutuluyor). *(S)*
- [x] **Manifest migrate testleri** — her eski şema sürümünden güncele migration zinciri. *(M)*

## 3. CLI UX (P1)

- [x] **`--dry-run`** — `init`, `add project`, `update`, `import` için: ne yazılacağını
  diff/ağaç olarak göster, dokunma. *(M)*
- [x] **Tam non-interactive mod** — tüm sorular flag'le cevaplanabilsin
  (`--name`, `--operator`, `--projects a,b,c` …); CI/script kullanımı için şart. *(M)*
- [ ] **`--json` çıktısını yaygınlaştır** — sadece `doctor`'da var; `update`, `sync`,
  `import` de makine-okunur çıktı versin. *(S)*
- [ ] **`--verbose` / `--quiet`** — global log seviyesi. *(S)*
- [ ] **Shell completion** — `vulcanus completion bash|zsh|fish|pwsh`. *(S)*
- [ ] **Hata mesajlarını zenginleştir** — her hataya "ne oldu / neden / ne yapmalı"
  formatı; çıkış kodlarını dokümante et. *(M)*
- [x] **`update-check` önbelleği** — her koşuda registry'e gitmesin, günde bir kontrol
  + offline'da sessiz geç. *(S)*

## 4. Yeni Komutlar (P1)

- [x] **`vulcanus status`** — vault özeti: proje sayısı, not sayısı, son güncellenme,
  capsule tazeliği, doctor skoru. Tek bakışta sağlık ekranı. *(M)*
- [x] **`vulcanus remove project <name>`** — projeyi grafikten sök, linkleri temizle,
  notları `_archive/`'a taşı. *(M)*
- [x] **`vulcanus rename project <old> <new>`** — dosya adları + tüm wikilink'ler +
  manifest tek hamlede. *(M)*
- [x] **`vulcanus archive project <name>`** — silmeden pasifleştir; Recall Map'ten düşür. *(S)*
- [x] **`vulcanus search <query>`** — capsule/hub öncelikli, token-ekonomik arama;
  `--json` ile ajanların kullanabileceği çıktı. *(M)*
- [ ] **`vulcanus stats`** — token bütçesi raporu: her capsule/hub kaç token, bir ajanın
  "cold start" maliyeti ne. Projenin ana vaadi token ekonomisi — ölçülebilir yap. *(M)*

## 5. Ajan Entegrasyonu — Ürünün Kalbi (P1–P2)

- [x] **MCP server: `vulcanus serve`** — vault'u MCP üzerinden sun: `recall(project)`,
  `search(query)`, `append_decision(...)` tool'ları. Claude Code / Cursor / diğer
  MCP istemcileri vault'a dosya okumadan yapılandırılmış erişsin. En büyük fark yaratacak iş. *(L)*
- [x] **Capsule tazelik takibi** — git log'a bakıp "Decisions değişti ama Capsule
  X gündür güncellenmedi" uyarısı (`doctor` + `status` içine). *(M)*
- [ ] **`vulcanus sync --watch`** — dosya değişikliklerini izleyip Recall Map / Index'i
  canlı güncelle. *(M)*
- [ ] **Git hook entegrasyonu** — opsiyonel pre-commit hook: `doctor` koş, kırık graf
  commit'lenmesin (`vulcanus hooks install`). *(S)*
- [ ] **Skill senkron denetimi** — `.claude/skills/` ↔ `.agents/skills/` kopyaları
  birbirinden saparsa `doctor` yakalasın. *(S)*
- [ ] **AGENTS.md protokol versiyonlama** — protokol değişince eski vault'lardaki
  ajan talimatlarının `update` ile güvenli yükseltilmesi. *(M)*

## 6. Importer Genişletme (P1)

- [ ] **Gemini CLI oturumları** — `~/.gemini/` geçmişinden import. *(M)*
- [ ] **Cursor oturumları** — Cursor'un lokal sohbet veritabanından import. *(M)*
- [ ] **Genel Markdown/klasör importu** — mevcut düz notlar klasörünü analiz edip
  proje kümeleri öner. *(M)*
- [ ] **Artımlı import** — aynı export'u ikinci kez verince yalnızca yeni konuşmaları
  işle (işlenen konuşma ID'lerini manifest'te tut). *(M)*
- [ ] **`--ai` ile akıllı kümeleme** — mevcut kelime-frekans analizini, kurulu AI CLI'a
  konuşma özetletip kümeletme ile güçlendir (opt-in). *(L)*

## 7. i18n & Dokümantasyon (P2)

- [ ] **String'leri dışa al** — `i18n.ts`'i locale-başına JSON dosyalarına böl;
  yeni dil eklemek PR ile kolay olsun. *(M)*
- [ ] **Yeni diller** — en azından `de`, `es`; topluluk katkısına aç. *(S/dil)*
- [ ] **CONTRIBUTING.md + issue/PR şablonları** — katkı rehberi, iyi ilk işler etiketi. *(S)*
- [ ] **Docs sitesi genişletme** — `site/` tek sayfa; komut referansı, "ajanla nasıl
  kullanılır" rehberleri, SSS ekle. *(L)*
- [ ] **Asciinema/VHS demo** — README'ye `init` akışının kaydı. *(S)*
- [ ] **Örnek vault repo'su** — `vulcanus-example-vault`: üretilen çıktıyı kurulum
  yapmadan incelemek isteyenler için. *(S)*

## 8. Dağıtım & Görünürlük (P2)

- [ ] **npm provenance + 2FA publish** — tedarik zinciri güveni. *(S)*
- [ ] **Homebrew tap** — `brew install sunsato/tap/vulcanus`. *(M)*
- [ ] **Sürüm duyuru otomasyonu** — release notlarının siteye/sosyale akışı. *(S)*
- [ ] **Benchmark yazısı** — "cold start ajan vs. Vulcanus'lu ajan" token/kalite
  karşılaştırması; ürünün iddiasını veriyle kanıtla. *(M)*

---

## Önerilen sıra (ilk 5 sprint)

1. **Sprint 1:** CI + ESLint + i18n bütünlük testi + update-check cache (hepsi küçük, temeli sağlamlaştırır)
2. **Sprint 2:** Test genişletme (doctor, e2e init, migrate) + coverage eşiği
3. **Sprint 3:** `--dry-run` + tam non-interactive mod + `status` komutu
4. **Sprint 4:** `remove/rename/archive project` + capsule tazelik takibi
5. **Sprint 5:** MCP server (`vulcanus serve`) — ürünü "scaffold aracı"ndan "ajan hafıza altyapısı"na taşıyan adım
