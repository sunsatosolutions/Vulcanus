export type Locale = "tr" | "en";

export interface Messages {
  introTitle: string;
  introBody: string;

  localeQuestion: string;
  localeTr: string;
  localeEn: string;

  importQuestion: string;
  importHint: string;
  importNone: string;
  importNoneHint: string;
  importCustom: string;
  importCustomHint: string;
  importPathQuestion: string;
  importSourceQuestion: string;
  detecting: string;
  detected: (count: number) => string;
  noSourcesFound: string;
  reading: string;
  readDone: (conversations: number, candidates: number) => string;
  readFailed: (message: string) => string;

  candidatesTitle: string;
  candidatesHint: string;
  candidateLabel: (name: string, conversations: number, confidence: string) => string;
  manualProjectsQuestion: string;
  manualProjectsHint: string;
  projectListQuestion: string;
  projectListHint: string;
  noProjects: string;

  vaultSection: string;
  vaultNameQuestion: string;
  vaultNameHint: string;
  vaultFullNameQuestion: string;
  vaultTaglineQuestion: string;
  namingQuestion: string;
  namingBranded: (vault: string) => string;
  namingGeneric: string;
  profileQuestion: string;
  profileCore: string;
  profileCoreHint: string;
  profileFull: string;
  profileFullHint: string;

  adminSection: string;
  adminNameQuestion: string;
  adminRoleQuestion: string;
  adminRoleHint: string;
  adminAliasesQuestion: string;
  adminAliasesHint: string;

  detailModeQuestion: string;
  detailModeSkip: string;
  detailModeSkipHint: string;
  detailModeManual: string;
  detailModeManualHint: string;
  detailModeAi: string;
  detailModeAiHint: string;

  aiDetecting: string;
  aiDetected: (count: number) => string;
  aiNoneDetected: string;
  aiNoneHint: string;
  aiCliQuestion: string;
  aiCliUnknown: (name: string) => string;
  aiScanning: string;
  aiScanned: (count: number) => string;
  aiSourceQuestion: (name: string) => string;
  aiSourceHint: string;
  aiSourceOther: string;
  aiSourceSkip: string;
  aiSourceMissing: (path: string) => string;
  aiSkipped: (name: string) => string;
  aiHandoffTitle: (name: string) => string;
  aiHandoffSummary: (cli: string, dir: string, files: string[]) => string;
  aiHandoffConfirm: (cli: string) => string;
  aiSessionExited: (cli: string, code: number) => string;
  aiRevalidating: (name: string) => string;

  projectSection: (name: string) => string;
  summaryQuestion: (name: string) => string;
  parentQuestion: (name: string) => string;
  parentNone: string;
  groupQuestion: (name: string) => string;
  groupNone: string;
  groupNew: string;
  groupNameQuestion: string;
  specializedQuestion: (name: string) => string;
  triggersQuestion: (name: string) => string;
  triggersHint: string;

  targetQuestion: string;
  targetHint: string;
  gitQuestion: string;
  overwriteWarning: (path: string) => string;
  confirmQuestion: (files: number, path: string) => string;

  generating: string;
  validating: string;
  doctorPassed: (files: number, links: number) => string;
  doctorFailed: (errors: number) => string;

  skillsExplain: string;
  skillsInVault: (count: number) => string;
  skillsInstallHint: string;
  skillsInstalled: (count: number, path: string) => string;
  skillsKept: (count: number) => string;
  skillsForceHint: string;
  skillsOutro: string;

  cancelled: string;
  summaryTitle: string;
  nextSteps: (path: string) => string;
  required: string;
}

const en: Messages = {
  introTitle: "Vulcanus",
  introBody: "Build an AI-readable second brain for you and your AI agents.",

  localeQuestion: "Language / Dil",
  localeTr: "Türkçe",
  localeEn: "English",

  importQuestion: "Import an existing AI history to seed your project tree?",
  importHint: "Nothing is copied into the vault — only project names you confirm.",
  importNone: "No, I'll define projects myself",
  importNoneHint: "Skip straight to the questions",
  importCustom: "Other path…",
  importCustomHint: "Point at an export folder yourself",
  importPathQuestion: "Path to the export",
  importSourceQuestion: "Which format is it?",
  detecting: "Looking for AI exports and local sessions",
  detected: (count) => `${count} source(s) found`,
  noSourcesFound: "No exports found automatically. You can still pass a path yourself.",
  reading: "Reading conversations",
  readDone: (conversations, candidates) =>
    `${conversations} conversations read, ${candidates} project candidates found`,
  readFailed: (message) => `Could not read the export: ${message}`,

  candidatesTitle: "Project candidates",
  candidatesHint: "Space to toggle, enter to confirm. Unchecked names are discarded.",
  candidateLabel: (name, conversations, confidence) =>
    `${name} — ${conversations} conversations, ${confidence} confidence`,
  manualProjectsQuestion: "Any other projects to add? (comma separated)",
  manualProjectsHint: "Leave empty to skip",
  projectListQuestion: "Final project list — edit names, add, or remove",
  projectListHint: "Comma separated. Names become folder and note names.",
  noProjects: "No projects selected; the vault will start with its system layer only.",

  vaultSection: "Vault",
  vaultNameQuestion: "Vault name",
  vaultNameHint: "Short, memorable — it becomes the vault's identity",
  vaultFullNameQuestion: "What does the name stand for? (optional)",
  vaultTaglineQuestion: "One-line description (optional)",
  namingQuestion: "How should system notes be named?",
  namingBranded: (vault) => `Branded — "${vault} Index.md", "${vault} Recall Map.md"`,
  namingGeneric: 'Generic — "Index.md", "Recall Map.md"',
  profileQuestion: "How deep should the system layer be?",
  profileCore: "Core",
  profileCoreHint: "Index, Recall Map, Admin Profile, Context, Rules, Update Format, Changelog, Import Log",
  profileFull: "Full",
  profileFullHint: "Core plus Brain OS Architecture, Operating Intuition, Neural Link Map, Confidence Model",

  adminSection: "Operator",
  adminNameQuestion: "Your name",
  adminRoleQuestion: "Your working identity (optional)",
  adminRoleHint: "e.g. Founder / Builder / Product Architect",
  adminAliasesQuestion: "Other words that mean you (optional, comma separated)",
  adminAliasesHint: "e.g. me, user",

  detailModeQuestion: "How should each project's notes be filled in?",
  detailModeSkip: "Skip",
  detailModeSkipHint: "Leave them as empty seeds and write them yourself later",
  detailModeManual: "Answer here",
  detailModeManualHint: "Summary, hierarchy, grouping, specialized notes, recall triggers",
  detailModeAi: "Let a local AI read the code",
  detailModeAiHint: "An installed AI CLI studies each project's source and writes the notes",

  aiDetecting: "Looking for AI CLIs on PATH",
  aiDetected: (count) => `${count} AI CLI(s) found`,
  aiNoneDetected: "No AI CLI found on PATH",
  aiNoneHint: "Nothing to hand the notes to, so the questions are asked here instead.",
  aiCliQuestion: "Which CLI should write the notes?",
  aiCliUnknown: (name) => `${name} is not installed; pick from what was found.`,
  aiScanning: "Looking for the directories you have worked in",
  aiScanned: (count) => `${count} working directories known`,
  aiSourceQuestion: (name) => `Where does ${name}'s source code live?`,
  aiSourceHint: "Absolute path to the repository",
  aiSourceOther: "Another path…",
  aiSourceSkip: "Skip this project",
  aiSourceMissing: (path) => `${path} is not a directory.`,
  aiSkipped: (name) => `${name} skipped — its notes stay as they are.`,
  aiHandoffTitle: (name) => `Handing over ${name}`,
  aiHandoffSummary: (cli, dir, files) =>
    [
      `${cli} takes over your terminal, running in ${dir}.`,
      "It can read everything there. Vulcanus cannot restrict it once it starts.",
      "",
      "It is asked to write only these files:",
      ...files.map((file) => `  ${file}`),
    ].join("\n"),
  aiHandoffConfirm: (cli) => `Start ${cli} now?`,
  aiSessionExited: (cli, code) => `${cli} exited with code ${code}`,
  aiRevalidating: (name) => `Validating the vault after ${name}`,

  projectSection: (name) => `Project — ${name}`,
  summaryQuestion: (name) => `One-line definition of ${name}`,
  parentQuestion: (name) => `Does ${name} belong under another project?`,
  parentNone: "No — top level",
  groupQuestion: (name) => `Navigation group for ${name}?`,
  groupNone: "None",
  groupNew: "New group…",
  groupNameQuestion: "Group name",
  specializedQuestion: (name) => `Specialized notes for ${name}`,
  triggersQuestion: (name) => `Recall trigger words for ${name} (comma separated)`,
  triggersHint: "Words that should route an agent to this project",

  targetQuestion: "Where should the vault be created?",
  targetHint: "Relative or absolute path",
  gitQuestion: "Initialize a Git repository?",
  overwriteWarning: (path) => `${path} already exists and is not empty.`,
  confirmQuestion: (files, path) => `Create ${files} files in ${path}?`,

  generating: "Generating vault",
  validating: "Validating structure",
  doctorPassed: (files, links) => `${files} notes and ${links} links validated`,
  doctorFailed: (errors) => `${errors} problem(s) found`,

  skillsExplain:
    "Skills are invocable capabilities, not prose an agent may ignore. Each one runs\nthe real vulcanus command and reports its actual output.",
  skillsInVault: (count) =>
    `${count} skills ship inside the vault, for agents working in this repository.`,
  skillsInstallHint:
    "Agents in other repositories need them installed personally:\n  vulcanus skills --install",
  skillsInstalled: (count, path) => `${count} skill(s) written to ${path}`,
  skillsKept: (count) => `${count} existing skill(s) left untouched; --force overwrites them.`,
  skillsForceHint: "Nothing outside the vault is written without --install.",
  skillsOutro: "Ask your agent to validate or sync the vault and it will use these.",

  cancelled: "Cancelled. Nothing was written.",
  summaryTitle: "Vault ready",
  nextSteps: (path) =>
    [
      `cd ${path}`,
      "vulcanus agents        # make your AI tools use this vault everywhere",
      "vulcanus skills        # give them a skill that runs these commands",
      "vulcanus doctor        # validate the structure",
      'vulcanus sync "topic"  # commit and push',
      "",
      "Read USING-WITH-AI.md first — it is the part that makes the vault pay off.",
    ].join("\n"),
  required: "This field is required",
};

const tr: Messages = {
  introTitle: "Vulcanus",
  introBody: "Kendin ve yapay zekâ ajanların için okunabilir bir ikinci beyin kur.",

  localeQuestion: "Dil / Language",
  localeTr: "Türkçe",
  localeEn: "English",

  importQuestion: "Proje ağacını çıkarmak için mevcut bir yapay zekâ geçmişini içe aktaralım mı?",
  importHint: "Vault'a hiçbir konuşma kopyalanmaz — yalnızca onayladığın proje isimleri kullanılır.",
  importNone: "Hayır, projeleri kendim tanımlayayım",
  importNoneHint: "Doğrudan sorulara geç",
  importCustom: "Başka bir yol…",
  importCustomHint: "Export klasörünü kendin göster",
  importPathQuestion: "Export yolu",
  importSourceQuestion: "Hangi formatta?",
  detecting: "Yapay zekâ export'ları ve yerel oturumlar aranıyor",
  detected: (count) => `${count} kaynak bulundu`,
  noSourcesFound: "Otomatik olarak export bulunamadı. Yine de bir yol verebilirsin.",
  reading: "Konuşmalar okunuyor",
  readDone: (conversations, candidates) =>
    `${conversations} konuşma okundu, ${candidates} proje adayı çıkarıldı`,
  readFailed: (message) => `Export okunamadı: ${message}`,

  candidatesTitle: "Proje adayları",
  candidatesHint: "Seçmek için boşluk, onaylamak için enter. İşaretlenmeyenler atılır.",
  candidateLabel: (name, conversations, confidence) =>
    `${name} — ${conversations} konuşma, ${confidence} güven`,
  manualProjectsQuestion: "Eklemek istediğin başka proje var mı? (virgülle ayır)",
  manualProjectsHint: "Boş bırakabilirsin",
  projectListQuestion: "Son proje listesi — isimleri düzelt, ekle ya da çıkar",
  projectListHint: "Virgülle ayır. İsimler klasör ve not adı olacak.",
  noProjects: "Proje seçilmedi; vault yalnızca sistem katmanıyla başlayacak.",

  vaultSection: "Vault",
  vaultNameQuestion: "Vault adı",
  vaultNameHint: "Kısa ve akılda kalıcı — vault'un kimliği olacak",
  vaultFullNameQuestion: "İsmin açılımı nedir? (opsiyonel)",
  vaultTaglineQuestion: "Tek cümlelik tanım (opsiyonel)",
  namingQuestion: "Sistem notları nasıl isimlendirilsin?",
  namingBranded: (vault) => `Markalı — "${vault} Index.md", "${vault} Recall Map.md"`,
  namingGeneric: 'Jenerik — "Index.md", "Recall Map.md"',
  profileQuestion: "Sistem katmanı ne kadar derin olsun?",
  profileCore: "Çekirdek",
  profileCoreHint: "Index, Recall Map, Admin Profile, Context, Rules, Update Format, Changelog, Import Log",
  profileFull: "Tam",
  profileFullHint: "Çekirdek + Brain OS Architecture, Operating Intuition, Neural Link Map, Confidence Model",

  adminSection: "Yönetici",
  adminNameQuestion: "Adın",
  adminRoleQuestion: "Çalışma kimliğin (opsiyonel)",
  adminRoleHint: "örn. Founder / Builder / Product Architect",
  adminAliasesQuestion: "Seni ifade eden diğer kelimeler (opsiyonel, virgülle ayır)",
  adminAliasesHint: "örn. ben, user",

  detailModeQuestion: "Projelerin notları nasıl doldurulsun?",
  detailModeSkip: "Atla",
  detailModeSkipHint: "Boş şablon kalsın, sonra kendin yazarsın",
  detailModeManual: "Buradan yanıtlayayım",
  detailModeManualHint: "Tanım, hiyerarşi, gruplama, özel notlar, recall trigger'ları",
  detailModeAi: "Yerel bir yapay zekâ kodu okusun",
  detailModeAiHint: "Kurulu bir yapay zekâ CLI'ı projenin kaynak kodunu inceleyip notları yazsın",

  aiDetecting: "PATH üzerinde yapay zekâ CLI'ları aranıyor",
  aiDetected: (count) => `${count} CLI bulundu`,
  aiNoneDetected: "PATH üzerinde yapay zekâ CLI'ı bulunamadı",
  aiNoneHint: "Notları devredecek bir araç yok; sorular burada soruluyor.",
  aiCliQuestion: "Notları hangi CLI yazsın?",
  aiCliUnknown: (name) => `${name} kurulu değil; bulunanlar arasından seç.`,
  aiScanning: "Daha önce çalıştığın dizinler taranıyor",
  aiScanned: (count) => `${count} çalışma dizini bulundu`,
  aiSourceQuestion: (name) => `${name} kaynak kodu nerede?`,
  aiSourceHint: "Depoya giden mutlak yol",
  aiSourceOther: "Başka bir yol…",
  aiSourceSkip: "Bu projeyi atla",
  aiSourceMissing: (path) => `${path} bir dizin değil.`,
  aiSkipped: (name) => `${name} atlandı — notları olduğu gibi kaldı.`,
  aiHandoffTitle: (name) => `${name} devrediliyor`,
  aiHandoffSummary: (cli, dir, files) =>
    [
      `${cli} terminalini devralacak ve ${dir} içinde çalışacak.`,
      "Orada her şeyi okuyabilir; başladıktan sonra Vulcanus onu sınırlayamaz.",
      "",
      "Yazması istenen dosyalar yalnızca bunlar:",
      ...files.map((file) => `  ${file}`),
    ].join("\n"),
  aiHandoffConfirm: (cli) => `${cli} şimdi başlatılsın mı?`,
  aiSessionExited: (cli, code) => `${cli} ${code} koduyla çıktı`,
  aiRevalidating: (name) => `${name} sonrası vault doğrulanıyor`,

  projectSection: (name) => `Proje — ${name}`,
  summaryQuestion: (name) => `${name} tek cümleyle nedir?`,
  parentQuestion: (name) => `${name} başka bir projenin altında mı?`,
  parentNone: "Hayır — üst seviye",
  groupQuestion: (name) => `${name} için navigasyon grubu?`,
  groupNone: "Yok",
  groupNew: "Yeni grup…",
  groupNameQuestion: "Grup adı",
  specializedQuestion: (name) => `${name} için özel notlar`,
  triggersQuestion: (name) => `${name} için recall trigger kelimeleri (virgülle ayır)`,
  triggersHint: "Bir ajanı bu projeye yönlendirmesi gereken kelimeler",

  targetQuestion: "Vault nereye kurulsun?",
  targetHint: "Göreli ya da mutlak yol",
  gitQuestion: "Git deposu başlatılsın mı?",
  overwriteWarning: (path) => `${path} zaten var ve boş değil.`,
  confirmQuestion: (files, path) => `${path} içine ${files} dosya oluşturulsun mu?`,

  generating: "Vault oluşturuluyor",
  validating: "Yapı doğrulanıyor",
  doctorPassed: (files, links) => `${files} not ve ${links} bağlantı doğrulandı`,
  doctorFailed: (errors) => `${errors} sorun bulundu`,

  skillsExplain:
    "Skill'ler ajanın dikkate almayabileceği bir metin değil, çağrılabilir bir yetenek.\nHer biri gerçek vulcanus komutunu çalıştırır ve çıktısını olduğu gibi aktarır.",
  skillsInVault: (count) =>
    `${count} skill vault'un içinde duruyor; bu repoda çalışan ajanlar için.`,
  skillsInstallHint:
    "Diğer repolardaki ajanların bunları kişisel dizine kurman gerekir:\n  vulcanus skills --install",
  skillsInstalled: (count, path) => `${count} skill ${path} altına yazıldı`,
  skillsKept: (count) => `${count} mevcut skill'e dokunulmadı; üzerine yazmak için --force.`,
  skillsForceHint: "--install verilmeden vault dışına hiçbir şey yazılmaz.",
  skillsOutro: "Ajanına vault'u doğrulat ya da senkronlat; bunları kendisi kullanacak.",

  cancelled: "İptal edildi. Hiçbir dosya yazılmadı.",
  summaryTitle: "Vault hazır",
  nextSteps: (path) =>
    [
      `cd ${path}`,
      "vulcanus agents        # yapay zekâ araçlarına bu vault'u zorunlu kıl",
      "vulcanus skills        # bu komutları çalıştıran skill'leri kur",
      "vulcanus doctor        # yapıyı doğrula",
      'vulcanus sync "konu"   # commit ve push',
      "",
      "Önce USING-WITH-AI.md dosyasını oku — vault'u değerli kılan kısım orada.",
    ].join("\n"),
  required: "Bu alan zorunlu",
};

export const MESSAGES: Record<Locale, Messages> = { tr, en };

export function messages(locale: Locale): Messages {
  return MESSAGES[locale];
}
