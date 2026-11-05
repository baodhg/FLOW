const MARKED_LETTER = /[À-ÃÈ-ÊÌÍÒ-ÕÙÚÝà-ãè-êìíò-õùúýĂăĐđĨĩŨũƠơƯưẠ-ỹ]/;

const ONSETS = ['ngh', 'ch', 'gh', 'gi', 'kh', 'ng', 'nh', 'ph', 'qu', 'th', 'tr', 'b', 'c', 'd', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'x', ''];
const RHYMES = new Set(
  'a ac ach ai am an ang anh ao ap at au ay e ec em en eng eo ep et eu i ia ich iem ien iep iet ieu im in inh ip it iu o oa oac oach oai oam oan oang oanh oao oap oat oay oc oe oen oeo oet oi om on ong oong op ot u ua uan uang uanh uat uay uc ue uen uet ui um un ung uoc uoi uom uon uong uop uot up ut uu uy uya uyen uyet uynh uyt y yen yet yeu'.split(' '),
);
const TELLING_ONSETS = new Set(['kh', 'ng', 'ngh', 'nh']);
const TELLING_RHYMES = new Set('anh ach inh ien iem iep iet ieu oa ua oai oach oanh uan uanh uat uoc uoi uom uon uong uop uot uyen uyet uynh yen yet yeu'.split(' '));
const WEAK_ONSETS = new Set(['tr', 'ph', 'gi', 'qu']);
const LOOKALIKE = new Set('trim trip trap trot trek quit quip quiz phi gin gist giga bien lien mien yen yet alien khan nhan bach mach rich lua boa goa'.split(' '));
const COMMON_COMPOUNDS = ['don hang', 'hoa don', 'san pham', 'gio hang', 'ho ten', 'dia chi', 'mat khau', 'so du', 'gia ban', 'ma so', 'sinh vien', 'giao vien', 'bai tap', 'cong ty', 'trang thai', 'ngay thang'];

export function splitWords(name) {
  return (String(name).match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) || []).map((w) => w.toLowerCase());
}

function syllable(word) {
  if (!/^[a-z]+$/.test(word)) return null;
  for (const onset of ONSETS) {
    if (word.startsWith(onset) && RHYMES.has(word.slice(onset.length))) return { onset, rhyme: word.slice(onset.length) };
  }
  return null;
}

function telling(word) {
  if (word.length < 3 || LOOKALIKE.has(word)) return false;
  const s = syllable(word);
  return !!s && (TELLING_ONSETS.has(s.onset) || TELLING_RHYMES.has(s.rhyme));
}

export function vietnameseHit(name, { terms = [] } = {}) {
  const raw = String(name);
  if (MARKED_LETTER.test(raw)) return 'có dấu tiếng Việt';
  const words = splitWords(raw);
  const joined = ` ${words.join(' ')} `;
  for (const t of terms) {
    const needle = splitWords(t).join(' ');
    if (needle && joined.includes(` ${needle} `)) return t;
  }
  const strong = words.find(telling);
  if (strong) return strong;
  const compound = COMMON_COMPOUNDS.find((c) => joined.includes(` ${c} `));
  if (compound) return compound;
  const letters = words.filter((w) => /^[a-z]+$/.test(w));
  if (letters.length >= 2 && letters.every((w) => syllable(w) && !LOOKALIKE.has(w))) {
    const weak = letters.find((w) => WEAK_ONSETS.has(syllable(w).onset));
    if (weak) return weak;
  }
  return null;
}

const DECLARATION_PATTERNS = {
  js: [
    /(?:^|[\s(])(?:const|let|var|class|interface|enum|type|function\*?)\s+([\p{L}_$][\p{L}\p{N}_$]*)/gmu,
    /^[ \t]*(?:(?:async|static|public|private|protected|readonly|override|get|set)[ \t]+)*([\p{L}_$][\p{L}\p{N}_$]*)[ \t]*\([^)\n]*\)[^\n{;]*\{/gmu,
  ],
  cs: [
    /(?:^|\s)(?:class|interface|struct|record|enum)\s+([\p{L}_][\p{L}\p{N}_]*)/gmu,
    /^[ \t]*(?:(?:public|private|protected|internal|static|async|override|virtual|sealed|readonly|abstract|partial|new)[ \t]+)+[^\n=(;{]*?[ \t]([\p{L}_][\p{L}\p{N}_]*)[ \t]*(?:\(|\{|=|;)/gmu,
    /(?:^|\s)var\s+([\p{L}_][\p{L}\p{N}_]*)\s*=/gmu,
  ],
  java: [
    /(?:^|\s)(?:class|interface|enum|record|val|var|fun)\s+([\p{L}_][\p{L}\p{N}_]*)/gmu,
    /^[ \t]*(?:(?:public|private|protected|static|final|abstract|synchronized|override|suspend)[ \t]+)+[^\n=(;{]*?[ \t]([\p{L}_][\p{L}\p{N}_]*)[ \t]*(?:\(|\{|=|;)/gmu,
  ],
  go: [/^func\s+(?:\([^)\n]*\)\s*)?([\p{L}_][\p{L}\p{N}_]*)/gmu, /(?:^|\s)(?:type|var|const)\s+([\p{L}_][\p{L}\p{N}_]*)/gmu, /(?:^|\s)([\p{L}_][\p{L}\p{N}_]*)\s*:=/gmu],
  py: [/^\s*(?:async\s+)?def\s+([\p{L}_][\p{L}\p{N}_]*)/gmu, /^\s*class\s+([\p{L}_][\p{L}\p{N}_]*)/gmu, /^([\p{L}_][\p{L}\p{N}_]*)\s*=/gmu],
};

const FAMILY_BY_EXTENSION = {
  ts: 'js', tsx: 'js', mts: 'js', cts: 'js', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', vue: 'js', svelte: 'js',
  cs: 'cs',
  java: 'java', kt: 'java', kts: 'java', scala: 'java', swift: 'java', dart: 'java',
  go: 'go',
  py: 'py',
};

export function namingFamily(file) {
  return FAMILY_BY_EXTENSION[String(file).split('.').pop().toLowerCase()] || null;
}

export function declaredNames(file, text) {
  const family = namingFamily(file);
  if (!family) return [];
  const found = [];
  for (const pattern of DECLARATION_PATTERNS[family]) {
    for (const match of String(text).matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

const EXEMPT_PATHS = /(^|\/)(node_modules|dist|build|bin|obj|vendor|locales?|i18n|translations|lang|tests?|__tests__|fixtures|testdata|migrations?)\/|\.(test|spec)\.[^/]+$|_test\.go$/i;

export function namingSkipped(file) {
  return EXEMPT_PATHS.test(String(file));
}

export function vietnameseFileName(file, opts) {
  return vietnameseHit(String(file).split('/').pop().replace(/\.[^.]+$/, ''), opts);
}

const MESSAGE_SITES = [
  /throw\s+new\s+\w*(?:Error|Exception)\s*\(\s*[$@]?["'`]([^"'`]*)["'`]/g,
  /\bmessage\s*[:=]\s*[$@]?["'`]([^"'`]*)["'`]/g,
  /\b(?:log|logger|console|_logger|Log)\.\w+\s*\(\s*[$@]?["'`]([^"'`]*)["'`]/g,
  /\b(?:errors\.New|fmt\.Errorf)\s*\(\s*["'`]([^"'`]*)["'`]/g,
];

function readsVietnamese(sentence, opts) {
  if (MARKED_LETTER.test(sentence)) return true;
  const hits = sentence.split(/[^A-Za-z]+/).filter((w) => w && (telling(w.toLowerCase()) || (opts?.terms || []).some((t) => splitWords(t).join(' ') === w.toLowerCase())));
  return hits.length >= 2;
}

export function vietnameseMessages(text, opts) {
  const out = [];
  for (const site of MESSAGE_SITES) {
    for (const match of String(text).matchAll(site)) if (readsVietnamese(match[1], opts)) out.push(match[1]);
  }
  return [...new Set(out)];
}

export function newVietnameseNames(file, before, after, opts) {
  if (namingSkipped(file)) return [];
  const existing = new Set(declaredNames(file, before));
  const seen = new Set();
  const hits = [];
  for (const name of declaredNames(file, after)) {
    if (existing.has(name) || seen.has(name)) continue;
    seen.add(name);
    const syllableHit = vietnameseHit(name, opts);
    if (syllableHit) hits.push({ name, syllable: syllableHit });
  }
  return hits;
}
