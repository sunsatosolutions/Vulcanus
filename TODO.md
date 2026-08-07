# Vulcanus — Kalan Geliştirme TODO'ları

Öncelikler: **P0** = temel/acil, **P1** = büyük değer katar, **P2** = vizyon/uzun vade.
Efor: S (saatler), M (1–2 gün), L (hafta+).

> **Not:** İlk 5 sprint tamamlandı ve `claude/proje-gelistirme-todoları-q5xgmp`
> branch'inde merge bekliyor: CI + ESLint, test genişletme (59 → 93 test),
> `vulcanus status`, flag tabanlı non-interactive `init` + `--dry-run`,
> `project remove/rename/archive`, capsule tazelik takibi ve MCP server
> (`vulcanus serve`). Aşağıdaki liste yalnızca **kalan** işlerdir.

---

## 1. Altyapı & Kalite (P0)

- [ ] **Feature branch'i merge et** — `claude/proje-gelistirme-todoları-q5xgmp` →
  `main`. Aşağıdaki her şey bu tabana oturuyor. *(S)*
- [ ] **Test coverage eşiği** — `npm run coverage` script'i branch'te hazır;
  CI'a coverage adımı ve eşik (%80 hedef) ekle. *(S)*
- [ ] **Release otomasyonu** — `release-please` veya `changesets`: CHANGELOG üretimi,
  sürüm tag'i, `npm publish --provenance` ile otomatik yayın. *(M)*
- [ ] **Dependabot / Renovate** — bağımlılık güncellemeleri otomatik PR olsun. *(S)*
- [ ] **`exports` alanı ekle** — `package.json`'da sadece `bin` var; programatik
  kullanım için `exports` map tanımla. *(S)*
- [ ] **Windows yol güvenliği** — `path.join`/`sep` kullanımını gözden geçir; branch'teki
  CI zaten Windows'ta koşuyor, kırmızı kalan yer varsa düzelt (vault içi linkler
  her zaman `/` olmalı). *(M)*

## 2. Test Genişletme (P1)

- [ ] **Importer edge-case'leri** — boş export, bozuk JSON, dev dosya (streaming),
  çok parçalı ChatGPT export'u, exotic unicode başlıklar. *(M)*
- [ ] **MCP server transport testi** — tool mantığı test edildi; SDK'nın
  `InMemoryTransport`'u ile server kaydının kendisini de test et. *(S)*

## 3. CLI UX (P1)

- [ ] **`--json` çıktısını yaygınlaştır** — `status/doctor/update`'te var;
  `sync` ve `import` da makine-okunur çıktı versin. *(S)*
- [ ] **`--verbose` / `--quiet`** — global log seviyesi. *(S)*
- [ ] **Shell completion** — `vulcanus completion bash|zsh|fish|pwsh`. *(S)*
- [ ] **Hata mesajlarını zenginleştir** — her hataya "ne oldu / neden / ne yapmalı"
  formatı; çıkış kodlarını dokümante et. *(M)*
- [ ] **`vulcanus stats`** — token bütçesi raporu: her capsule/hub kaç token, bir
  ajanın "cold start" maliyeti ne. Ürünün ana vaadi token ekonomisi — ölçülebilir yap. *(M)*

## 4. Ajan Entegrasyonu (P1–P2)

- [ ] **MCP server'ı derinleştir** — `serve`'e `update_capsule` / `append_rule`
  tool'ları; capsule bayatsa `recall` cevabında uyarı döndür. *(M)*
- [ ] **`vulcanus sync --watch`** — dosya değişikliklerini izleyip Recall Map /
  Index'i canlı güncelle. *(M)*
- [ ] **Git hook entegrasyonu** — opsiyonel pre-commit hook: `doctor` koş, kırık
  graf commit'lenmesin (`vulcanus hooks install`). *(S)*
- [ ] **Skill senkron denetimi** — `.claude/skills/` ↔ `.agents/skills/` kopyaları
  birbirinden saparsa `doctor` yakalasın. *(S)*
- [ ] **`serve` için skill/doküman** — üretilen vault'lardaki USING-WITH-AI.md ve
  skill'ler MCP server'ı da anlatsın (`claude mcp add vulcanus -- vulcanus serve`). *(S)*
- [ ] **AGENTS.md protokol versiyonlama** — protokol değişince eski vault'lardaki
  ajan talimatlarının `update` ile güvenli yükseltilmesi. *(M)*

## 5. Importer Genişletme (P1)

- [ ] **Gemini CLI oturumları** — `~/.gemini/` geçmişinden import. *(M)*
- [ ] **Cursor oturumları** — Cursor'un lokal sohbet veritabanından import. *(M)*
- [ ] **Genel Markdown/klasör importu** — mevcut düz notlar klasörünü analiz edip
  proje kümeleri öner. *(M)*
- [ ] **Artımlı import** — aynı export'u ikinci kez verince yalnızca yeni konuşmaları
  işle (işlenen konuşma ID'lerini manifest'te tut). *(M)*
- [ ] **`--ai` ile akıllı kümeleme** — kelime-frekans analizini, kurulu AI CLI'a
  konuşma özetletip kümeletme ile güçlendir (opt-in). *(L)*

## 6. i18n & Dokümantasyon (P2)

- [ ] **String'leri dışa al** — `i18n.ts`'i locale-başına JSON dosyalarına böl;
  yeni dil eklemek PR ile kolay olsun. *(M)*
- [ ] **Yeni diller** — en azından `de`, `es`; topluluk katkısına aç. *(S/dil)*
- [ ] **CONTRIBUTING.md + issue/PR şablonları** — katkı rehberi, iyi ilk işler etiketi. *(S)*
- [ ] **Docs sitesi genişletme** — `site/` tek sayfa; komut referansı, MCP rehberi,
  "ajanla nasıl kullanılır" bölümleri, SSS. *(L)*
- [ ] **Asciinema/VHS demo** — README'ye `init` akışının kaydı. *(S)*
- [ ] **Örnek vault repo'su** — `vulcanus-example-vault`: üretilen çıktıyı kurulum
  yapmadan incelemek isteyenler için. *(S)*

## 7. Dağıtım & Görünürlük (P2)

- [ ] **npm provenance + 2FA publish** — tedarik zinciri güveni. *(S)*
- [ ] **Homebrew tap** — `brew install sunsato/tap/vulcanus`. *(M)*
- [ ] **Sürüm duyuru otomasyonu** — release notlarının siteye/sosyale akışı. *(S)*
- [ ] **Benchmark yazısı** — "cold start ajan vs. Vulcanus'lu ajan" token/kalite
  karşılaştırması; ürünün iddiasını veriyle kanıtla. *(M)*

---

## Önerilen sıra

1. Feature branch'i merge et + coverage eşiği + Dependabot (yarım gün, taban hazır olur)
2. Release otomasyonu → yeni sürümü (0.4.0: MCP server) yayınla
3. `stats` + MCP derinleştirme (token ekonomisi vaadini ölçülebilir kıl)
4. Importer'lar (Gemini, Cursor, artımlı import)
5. i18n dışa alma + docs sitesi + benchmark yazısı
