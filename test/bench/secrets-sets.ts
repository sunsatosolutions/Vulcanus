/**
 * Test sets for `npm run bench:secrets`.
 *
 * The repository is public, so no realistic token sits in this file whole:
 * prefixes are split and bodies come from a seeded generator while the
 * benchmark runs. Same seed, same sets.
 */

export interface SeededSecret {
  id: string;
  /** Pattern class as the report names it. */
  cls: string;
  /** Variant inside the class (e.g. `--password=` vs `-p`). */
  variant: string;
  /** Detector kind that should claim it. */
  expect: string;
  /** The note text holding the secret. */
  text: string;
  /** The secret itself: must be gone from masked text. */
  value: string;
}

export interface CleanNote {
  id: string;
  text: string;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = LOWER.toUpperCase();
const DIGITS = "0123456789";
const ALNUM = LOWER + UPPER + DIGITS;
const UPPER_DIGITS = UPPER + DIGITS;
const B64 = `${ALNUM}+/`;
const B64URL = `${ALNUM}-_`;
const HEX = "0123456789abcdef";
const PW_SYMBOLS = `${ALNUM}!#^&*_+=`;

class Gen {
  private next: () => number;
  constructor(seed: number) {
    this.next = rng(seed);
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }
  str(length: number, alphabet = ALNUM): string {
    let out = "";
    for (let i = 0; i < length; i++) out += alphabet[this.int(alphabet.length)];
    return out;
  }
  /** Random text that starts with a letter or digit and has both. */
  password(length: number): string {
    let out = this.str(1, ALNUM) + this.str(length - 3, PW_SYMBOLS);
    out += this.str(1, DIGITS) + this.str(1, LOWER);
    return out;
  }
}

/** Prefix pieces are joined at run time so the source holds no whole token. */
const j = (...parts: string[]): string => parts.join("");

const PEM_DASH = "-".repeat(5);

function pemBlock(g: Gen, label: string, bodyLines: number): string {
  const lines = Array.from({ length: bodyLines }, () => g.str(64, B64));
  return [
    `${PEM_DASH}${j("BEGIN ", label)}${PEM_DASH}`,
    ...lines,
    `${PEM_DASH}${j("END ", label)}${PEM_DASH}`,
  ].join("\n");
}

type Wrap = (value: string) => string;

const PROSE_WRAPS: Wrap[] = [
  (v) => `Deploy notu: anahtar şu, ${v} — işi bitince döndür.`,
  (v) => `- erişim: \`${v}\``,
  (v) => `Eski konfigürasyondan kalan değer ${v} olarak duruyordu.`,
  (v) => `CI ortam değişkeni olarak ${v} verildi, sonra silinecek.`,
  (v) => `> kopyaladım: ${v}`,
];

export function buildSeededSecrets(seed = 20260101): SeededSecret[] {
  const g = new Gen(seed);
  const out: SeededSecret[] = [];
  let n = 0;
  const add = (cls: string, variant: string, expect: string, value: string, text: string) => {
    n += 1;
    out.push({ id: `S${String(n).padStart(3, "0")}`, cls, variant, expect, text, value });
  };
  const prose = (cls: string, variant: string, expect: string, value: string) =>
    add(cls, variant, expect, value, g.pick(PROSE_WRAPS)(value));

  for (let i = 0; i < 6; i++) {
    const v = j(g.pick(["AK", "AK", "AS"]), g.pick(["IA", "IA", "IA"]), g.str(16, UPPER_DIGITS));
    prose("aws", v.startsWith("ASIA") ? "ASIA" : "AKIA", "aws-key", v);
  }
  const ghForms: [string, () => string][] = [
    ["ghp", () => j("gh", "p_", g.str(36))],
    ["gho", () => j("gh", "o_", g.str(36))],
    ["ghu", () => j("gh", "u_", g.str(36))],
    ["ghs", () => j("gh", "s_", g.str(36))],
    ["ghr", () => j("gh", "r_", g.str(36))],
    ["github_pat", () => j("github", "_pat_", g.str(22), "_", g.str(59))],
    ["ghp", () => j("gh", "p_", g.str(40))],
    ["ghs", () => j("gh", "s_", g.str(36))],
  ];
  for (const [variant, make] of ghForms) prose("github", variant, "github-token", make());
  for (let i = 0; i < 4; i++) prose("npm", "npm_", "npm-token", j("npm", "_", g.str(36)));
  const stripeForms = [
    ["sk_live", () => j("sk", "_live_", g.str(24))],
    ["sk_test", () => j("sk", "_test_", g.str(24))],
    ["rk_live", () => j("rk", "_live_", g.str(24))],
    ["rk_test", () => j("rk", "_test_", g.str(32))],
    ["whsec", () => j("whs", "ec_", g.str(32))],
    ["sk_live", () => j("sk", "_live_", g.str(99))],
  ] as const;
  for (const [variant, make] of stripeForms) prose("stripe", variant, "stripe-key", make());
  const slackForms = [
    () => j("xo", "xb-", g.str(12, DIGITS), "-", g.str(13, DIGITS), "-", g.str(24)),
    () =>
      j(
        "xo",
        "xp-",
        g.str(12, DIGITS),
        "-",
        g.str(12, DIGITS),
        "-",
        g.str(12, DIGITS),
        "-",
        g.str(32, HEX),
      ),
    () => j("xo", "xb-", g.str(12, DIGITS), "-", g.str(13, DIGITS), "-", g.str(24)),
    () => j("xo", "xa-2-", g.str(12, DIGITS), "-", g.str(12, DIGITS), "-", g.str(24)),
    () => j("xo", "xs-", g.str(11, DIGITS), "-", g.str(11, DIGITS), "-", g.str(24, HEX)),
  ];
  slackForms.forEach((make, i) =>
    prose("slack", ["xoxb", "xoxp", "xoxb", "xoxa", "xoxs"][i], "slack-token", make()),
  );
  for (let i = 0; i < 5; i++)
    prose("google", "AIza", "google-api-key", j("AI", "za", g.str(35, B64URL)));
  const llmForms = [
    ["sk-ant", () => j("sk", "-ant-api03-", g.str(93, B64URL), "AA")],
    ["sk-ant", () => j("sk", "-ant-api03-", g.str(93, B64URL), "AA")],
    ["sk-proj", () => j("sk", "-proj-", g.str(48, B64URL))],
    ["sk-proj", () => j("sk", "-proj-", g.str(64, B64URL))],
    ["sk", () => j("sk", "-", g.str(48))],
    ["sk", () => j("sk", "-", g.str(48))],
    ["sk-ant", () => j("sk", "-ant-", g.str(40, B64URL))],
    ["sk", () => j("sk", "-", g.str(32))],
  ] as const;
  for (const [variant, make] of llmForms) prose("llm", variant, "llm-key", make());

  const pemLabels = ["RSA PRIVATE KEY", "EC PRIVATE KEY", "PRIVATE KEY", "ENCRYPTED PRIVATE KEY"];
  for (const label of pemLabels) {
    const block = pemBlock(g, label, 6);
    add("pem", label, "private-key", block, `Sunucu anahtarı:\n\n${block}\n\nBitti.`);
  }
  for (let i = 0; i < 3; i++) {
    const block = pemBlock(g, "OPENSSH PRIVATE KEY", 5 + i);
    add("openssh", "OPENSSH PRIVATE KEY", "private-key", block, `~/.ssh/id_deploy:\n${block}`);
  }

  const dbSchemes = [
    "postgres",
    "postgresql",
    "mysql",
    "mongodb",
    "mongodb+srv",
    "redis",
    "amqp",
    "postgres",
  ];
  for (const scheme of dbSchemes) {
    const pw = g.str(18);
    const user = g.pick(["app", "admin", "svc_reader", "deploy"]);
    const url = `${scheme}://${user}:${pw}@db-${g.int(9)}.example.com/${g.pick(["main", "app", "analytics"])}`;
    add(
      "db-url",
      scheme,
      "db-url",
      pw,
      g.pick([`DATABASE_URL=${url}`, `Bağlantı: ${url}`, `- url: \`${url}\``]),
    );
  }

  const bearerForms = [
    () => g.str(40),
    () => g.str(43, B64URL),
    () =>
      `${j("ey", "J")}${g.str(30, B64URL)}.${j("ey", "J")}${g.str(60, B64URL)}.${g.str(43, B64URL)}`,
    () => g.str(32, HEX),
    () => g.str(24),
    () => `${g.str(20, B64URL)}==`,
    () => g.str(64, B64URL),
  ];
  const bearerWraps: Wrap[] = [
    (v) => `curl -H "Authorization: Bearer ${v}" https://api.example.com/v1/items`,
    (v) => `curl -s -H 'Authorization: Bearer ${v}' https://api.example.com/v1/me`,
    (v) => `headers = { "Authorization": "Bearer ${v}" }`,
    (v) => `Authorization: Bearer ${v}`,
    (v) => `fetch(url, { headers: { Authorization: \`Bearer ${v}\` } })`,
  ];
  bearerForms.forEach((make, i) => {
    const v = make();
    add(
      "bearer",
      ["plain", "b64url", "jwt", "hex", "plain", "b64pad", "b64url"][i],
      "bearer-token",
      v,
      bearerWraps[i % bearerWraps.length](v),
    );
  });

  // Command-line passwords: at least 20 samples.
  const pw = (len: number) => g.password(len);
  for (let i = 0; i < 6; i++) {
    const v = pw(12 + i);
    const form = i % 3;
    const text =
      form === 0
        ? `vault login --user ops --password ${v}`
        : form === 1
          ? `backup-tool dump --host db.example.com --password=${v} --out ./dump`
          : `restic init --repo s3:example/bucket --password '${v}'`;
    add(
      "cli-password",
      [
        "--password SP",
        "--password=",
        "--password quoted",
        "--password SP",
        "--password=",
        "--password quoted",
      ][i],
      "cli-password",
      v,
      text,
    );
  }
  for (let i = 0; i < 6; i++) {
    const v = pw(10 + i);
    const cmd = ["mysql", "mysqldump", "mysqladmin", "mariadb", "mysql", "mysqldump"][i];
    add(
      "cli-password",
      `${cmd} -p`,
      "cli-password",
      v,
      `${cmd} -u root -p${v} ${i % 2 ? "--all-databases" : "appdb"}`,
    );
  }
  for (let i = 0; i < 5; i++) {
    const v = pw(14 + i);
    const text =
      i % 2
        ? `PGPASSWORD=${v} pg_dump -h db.example.com -U app appdb > dump.sql`
        : `PGPASSWORD="${v}" psql -h db.example.com -U app`;
    add("cli-password", "PGPASSWORD=", "cli-password", v, text);
  }
  for (let i = 0; i < 5; i++) {
    const v = pw(12 + i);
    add(
      "cli-password",
      "MYSQL_PWD=",
      "cli-password",
      v,
      `MYSQL_PWD=${v} mysqldump -u backup appdb > appdb.sql`,
    );
  }

  const genericKeys = [
    "api_key",
    "client_secret",
    "SESSION_TOKEN",
    "auth_token",
    "webhook_secret",
    "SECRET_KEY",
    "access_token",
    "private_key",
    "password",
    "db_password",
  ];
  const genericForms: [string, () => string][] = [
    ["alnum", () => g.str(24)],
    ["alnum", () => g.str(32)],
    ["alnum", () => g.str(20)],
    ["alnum", () => g.str(28)],
    ["alnum", () => g.str(40)],
    ["base64", () => `${g.str(30, B64)}==`],
    ["base64", () => g.str(36, B64)],
    ["base64", () => g.str(44, B64)],
    ["base64url", () => g.str(43, B64URL)],
    ["base64url", () => g.str(32, B64URL)],
    ["aws-secret-40", () => g.str(40, B64)],
    ["aws-secret-40", () => g.str(40, B64)],
    ["hex64", () => g.str(64, HEX)],
    ["hex64", () => g.str(64, HEX)],
  ];
  genericForms.forEach(([variant, make], i) => {
    const v = make();
    const key = variant === "aws-secret-40" ? "aws_secret_access_key" : g.pick(genericKeys);
    const text = [
      `${key}: ${v}`,
      `${key} = "${v}"`,
      `export ${key.toUpperCase()}=${v}`,
      `${key}="${v}"`,
    ][i % 4];
    add("generic", variant, "generic-secret", v, text);
  });

  return out;
}

const SERVICES = [
  "ödeme servisi",
  "bildirim kuyruğu",
  "arama indeksi",
  "web arayüzü",
  "rapor işi",
  "oturum katmanı",
  "dosya yükleme",
  "zamanlayıcı",
];
const DECISIONS = [
  "Kararımız: yeni uçlar önce bir bayrak arkasında yayınlanır, bir hafta izlenir, sonra açılır.",
  "Karar: migration'lar geri alınabilir yazılır; geri alma betiği aynı PR'da gelir.",
  "Karar: hata mesajları kullanıcıya genel, günlüğe ayrıntılı yazılır.",
  "Karar: sürüm numaraları semver izler; kırıcı değişiklik yalnız major'da.",
  "Karar: günlükler 30 gün tutulur, sonra özetlenip silinir.",
  "Karar: zamanlayıcı işleri tekrar çalıştırılabilir (idempotent) olmak zorunda.",
];
const RULES = [
  "- Her PR bir test içerir; test yoksa nedeni PR metninde yazılır.",
  "- Sır değerleri not'a yazılmaz, yalnız nerede durduğu yazılır.",
  "- Bir kuyruk işi 5 dakikadan uzun sürerse parçalara bölünür.",
  "- Yapılandırma ortam değişkeninden okunur, koda gömülmez.",
  "- Dış çağrılarda zaman aşımı 10 sn, en çok 3 deneme.",
  "- Yeni bağımlılık eklemeden önce standart kütüphane denenir.",
  "- Veritabanı şeması değişince CHANGELOG'a satır eklenir.",
];
const COMMANDS = [
  "npm run build && npm test",
  "git log --oneline -n 20",
  "docker compose up -d --build",
  "kubectl rollout status deploy/web --timeout=120s",
  "curl -s https://api.example.com/health | jq .status",
  "rsync -av --delete ./dist/ deploy@host.example.com:/srv/app/",
  "openssl rand -hex 16",
  "mysql -u app -p appdb < schema.sql",
  "psql -h localhost -p 5432 -U app -d appdb",
  "pg_dump -h localhost -U app appdb | gzip > backup.sql.gz",
  "export PGPASSWORD=$DB_PASSWORD",
  'vault login --user ops --password "$OPS_PASSWORD"',
  "docker login --username ops --password-stdin < ~/.docker/pass.txt",
  'curl -H "Authorization: Bearer $API_TOKEN" https://api.example.com/v1/me',
  'MYSQL_PWD="$BACKUP_PASS" mysqldump -u backup appdb > appdb.sql',
  "ssh-keygen -t ed25519 -f ~/.ssh/id_deploy -C deploy",
  "npm config set //registry.example.com/:_authToken=${NPM_TOKEN}",
  "DATABASE_URL=postgres://app:${DB_PASS}@db.example.com:5432/appdb",
];
const CONFIG_LINES = [
  "api_key: ${API_KEY}",
  "password: <your-password>",
  "client_secret: changeme",
  "token: your_token_here",
  "secret_ref: process.env.SESSION_SECRET",
  "max_tokens: 4096",
  "session_token_ttl: 3600",
  "token_budget: 200000",
  "private_key_path: ~/.ssh/id_deploy",
  "secret_name: prod/db-credentials/main",
  "password_policy: min-12-chars-with-digits",
  "secret_rotation: rotate-every-90-days",
  "access_key_id: <aws-access-key-id>",
  "AWS_SECRET_ACCESS_KEY=<yazılacak>",
  "db: postgres://localhost:5432/appdb",
  "dsn: postgres://app@db.example.com/appdb",
];
const URLS = [
  "https://example.com/docs/auth#token-refresh",
  "https://api.example.com/v2/items?page=3&per_page=50",
  "https://example.com/blog/2025/migration-notes",
  "https://github.com/example/project/pull/412",
  "https://cdn.example.com/assets/app.3f9a2c1b.js",
];

function identifierLine(g: Gen, kind: number): string {
  switch (kind % 6) {
    case 0:
      return `İstek kimliği: ${[8, 4, 4, 4, 12].map((n) => g.str(n, HEX)).join("-")}`;
    case 1:
      return `Düzeltme commit'i ${g.str(40, HEX)} (kısa: ${g.str(7, HEX)}).`;
    case 2:
      return `Görüntü özeti: sha256:${g.str(64, HEX)}`;
    case 3:
      return `Önizleme: ![logo](data:image/png;base64,${g.str(180, B64)}==)`;
    case 4:
      return `Kaynak: ${g.pick(URLS)}`;
    default:
      return `Yayın etiketi v${g.int(3)}.${g.int(20)}.${g.int(9)}, build ${g.str(12, HEX)}.`;
  }
}

/** 100 synthetic vault notes with no secret in them. */
export function buildCleanNotes(seed = 20260102): CleanNote[] {
  const g = new Gen(seed);
  return Array.from({ length: 100 }, (_, i) => {
    const service = g.pick(SERVICES);
    const lines = [
      `# ${service}: not ${i + 1}`,
      "",
      g.pick(DECISIONS),
      "",
      "Kurallar:",
      g.pick(RULES),
      g.pick(RULES),
      "",
      "```sh",
    ];
    const cmdCount = 1 + g.int(3);
    for (let c = 0; c < cmdCount; c++) lines.push(g.pick(COMMANDS));
    lines.push("```", "");
    // Every second note carries a config-like line, every note an identifier or URL.
    if (i % 2 === 0) lines.push("```yaml", g.pick(CONFIG_LINES), "```", "");
    lines.push(identifierLine(g, i), identifierLine(g, i + 1 + g.int(5)));
    return { id: `C${String(i + 1).padStart(3, "0")}`, text: lines.join("\n") };
  });
}
