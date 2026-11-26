/**
 * Motor Anti-Evasão e Filtro de Ofensas (PT-BR / EN) para o Chat do Lobby, Chat do Tribunal e Nomes de Salas/Jogadores.
 *
 * Como inibe todas as técnicas de burla (bypass):
 * 1. Substituição de símbolos ambíguos por classes fonéticas:
 *    - '@', '4', 'ª', 'ä', 'á', 'à', 'ã', 'â', '/-\' -> 'a'
 *    - '$' -> testado simultaneamente como 'a' e como 's' (pega tanto "p$rr$" / "c$r$lho" / "put$" quanto "b0$t$" / "de$graça"!)
 *    - '*', '#', '%', '_' -> curingas de vogal/consoante (pega "p*ta", "c#ralho", "f*da", "m_rda")
 *    - '3', '€', '&' -> 'e' | '1', '!', '|', 'l' -> 'i' | '0', '()', '°' -> 'o' | '5' -> 's' | '7', '+' -> 't' | 'v', 'u' -> intercambiáveis em ditongos
 * 2. Remoção de separadores internos (p.u.t.a, c-a-r-a-l-h-o, f_d_p, p*o*r*r*a).
 * 3. Fusão de letras espaçadas ("p u t a", "c a r a l h o", "v s f", "f d p").
 * 4. Colapso de letras repetidas ("puuuutaaaa" -> "puta", "lixo0000" -> "lixo", "caaaaralhooo" -> "caralho").
 */

// Mapeamento de cada letra do alfabeto para uma expressão regular que aceita TODAS as variações visuais, leet-speak e símbolos que os jogadores usam para trocar aquela letra!
const CHAR_EVASION_MAP: Record<string, string> = {
  a: '[aáàãâäª@4$*#%_∆^]+',
  b: '[b8ß]+',
  c: '[cçk(<{]+',
  d: '[d]+',
  e: '[eéèêë3€&*#%_]+',
  f: '[fph]+',
  g: '[g69]+',
  h: '[h#]*',
  i: '[iíìîïy1!|l*#%_]+',
  j: '[j]+',
  k: '[kcq]+',
  l: '[l1!|i]+',
  m: '(?:m|rn|nn)+',
  n: '[nñ]+',
  o: '[oóòõôöº0()*#%_°]+',
  p: '[p9]+',
  q: '[q9k]+',
  r: '[r2]+',
  s: '[s$5z§*#%_]+',
  t: '[t7+]+',
  u: '[uúùûüv*#%_w]+',
  v: '[vuw\\/+]+',
  w: '[wvv]+',
  x: '[x×*#]+',
  y: '[yi1!|]+',
  z: '[z2s$]+'
};

// Separador opcional que jogadores colocam ENTRE as letras para tentar burlar (ex: p.u.t.a, p-u-t-a, p_u_t_a, p u t a)
const INNER_NOISE = '[\\s.\\-_,;:*#~`\'"+|/\\\\]*';

/**
 * Compila uma palavra-raiz proibida em um RegExp capaz de capturar:
 * - Troca de 'a' por '$', '@', '4', '*'
 * - Troca de 'e' por '3', '€', '*'
 * - Troca de 'i' por '1', '!', '|'
 * - Troca de 'o' por '0', '*'
 * - Troca de 's' por '$', '5', 'z'
 * - Pontos, traços, underlines ou espaços entre cada letra (ex: "c . a . r . a . l . h . o" ou "p u t a")
 * - Repetição exagerada de letras (ex: "puuuuut@@@@")
 */
function buildAntiEvasionRegex(rootWord: string, requireWordBoundary = false): RegExp {
  const chars = rootWord.toLowerCase().split('');
  const patternParts = chars.map((ch) => CHAR_EVASION_MAP[ch] || ch);
  const body = patternParts.join(INNER_NOISE);
  const prefix = requireWordBoundary ? '(?:^|[^a-zA-Z0-9])(' : '(';
  const suffix = requireWordBoundary ? ')(?=$|[^a-zA-Z0-9])' : ')';
  return new RegExp(`${prefix}${body}${suffix}`, 'gi');
}

// Palavras-raiz que podem ser detectadas mesmo grudadas ou com símbolos/espaços entre as letras
const STRICT_OFFENSIVE_ROOTS: string[] = [
  'porra',
  'caralh',
  'cacete',
  'merda',
  'bosta',
  'puta',
  'puto',
  'putaria',
  'filhodaputa',
  'filhadaputa',
  'arrombad',
  'otari',
  'babaca',
  'imbecil',
  'imbecis',
  'idiota',
  'retardad',
  'vagabund',
  'vadia',
  'piranha',
  'desgracad',
  'viadinh',
  'viadao',
  'boiola',
  'cuzao',
  'cuzaum',
  'bucet',
  'bocet',
  'paunocu',
  'vaisefoder',
  'fodase',
  'foder',
  'fodid',
  'lixohumano',
  'semata',
  'estupr',
  'pedofil',
  'macac',
  'fuck',
  'bitch',
  'asshole',
  'nigger',
  'nigga',
  'faggot'
];

// Siglas e palavras curtas (exigem borda de palavra para não censurar sílabas de palavras inocentes como "faca", "computador", "escudo")
const SHORT_OFFENSIVE_ROOTS: string[] = [
  'fdp',
  'krl',
  'vsf',
  'vtnc',
  'pnc',
  'pqp',
  'tmnc',
  'kys',
  'viado',
  'bicha',
  'corno',
  'shit',
  'cunt',
  'cu'
];

const COMPILED_STRICT_REGEXES: RegExp[] = STRICT_OFFENSIVE_ROOTS.map((w) =>
  buildAntiEvasionRegex(w, false)
);

const COMPILED_SHORT_REGEXES: RegExp[] = SHORT_OFFENSIVE_ROOTS.map((w) =>
  buildAntiEvasionRegex(w, true)
);

// Palavras inocentes do vocabulário do jogo que contêm "puta" / "cu" / "fod" como sílaba interna legítima e NUNCA devem ser censuradas por falso positivo
const SAFE_WORDS_WHITELIST = new Set([
  'computador',
  'computadores',
  'computado',
  'computados',
  'computar',
  'disputa',
  'disputas',
  'disputar',
  'disputado',
  'reputacao',
  'deputado',
  'escudo',
  'escudos',
  'escuta',
  'escutar',
  'oculto',
  'oculta',
  'ocultar',
  'culpa',
  'culpado',
  'culpada',
  'cura',
  'curar',
  'curandeira',
  'cuidado',
  'cuidar'
]);

function stripAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isWhitelistedWord(token: string): boolean {
  const cleanAlpha = stripAccents(token.toLowerCase()).replace(/[^a-z]/g, '');
  return SAFE_WORDS_WHITELIST.has(cleanAlpha);
}

/**
 * Testa um token individual contra múltiplas decodificações simultâneas:
 * - Decodificação 1: '$' = 'a', '@' = 'a', '4' = 'a' (pega "p$t$", "c$r$lho", "v@gabundo")
 * - Decodificação 2: '$' = 's', '@' = 'a' (pega "b0$t@", "de$gr@ç@")
 * - Decodificação 3: Colapso de caracteres repetidos (pega "puuuut@@@@", "m3333rd$$$$")
 */
function tokenContainsOffense(rawToken: string): boolean {
  if (isWhitelistedWord(rawToken)) return false;

  const base = stripAccents(rawToken.toLowerCase());

  for (const rx of COMPILED_STRICT_REGEXES) {
    rx.lastIndex = 0;
    if (rx.test(base)) return true;
  }

  for (const rx of COMPILED_SHORT_REGEXES) {
    rx.lastIndex = 0;
    if (rx.test(base)) return true;
  }

  return false;
}

export function sanitizeTribunalChatMessage(rawText: string): {
  cleanText: string;
  wasFiltered: boolean;
} {
  const trimmed = rawText.trim().slice(0, 180);
  if (!trimmed) {
    return { cleanText: '', wasFiltered: false };
  }

  let wasFiltered = false;

  // Passo 1: Verifica palavra por palavra (incluindo símbolos colados como "p$t@", "c@r$lho", "f.d.p", "v_s_f")
  const tokens = trimmed.split(/(\s+)/);
  const sanitizedTokens = tokens.map((token) => {
    if (/^\s+$/.test(token)) return token;
    if (tokenContainsOffense(token)) {
      wasFiltered = true;
      return '***';
    }
    return token;
  });

  let cleanText = sanitizedTokens.join('');

  // Passo 2: Verifica a frase inteira para pegar palavrões escritos com ESPAÇO entre cada letra
  // (ex: "p u t a", "c a r a l h o", "f i l h o d a p u t a", "p $ r r @", "v s f", "f d p")
  // Protegemos temporariamente as palavras da whitelist para não serem afetadas
  const protectedMap = new Map<string, string>();
  let protectIdx = 0;
  let workingSentence = cleanText.replace(/[A-Za-zÀ-ÖØ-öø-ÿ]+/g, (word) => {
    if (isWhitelistedWord(word)) {
      const key = `__SAFE_${protectIdx++}__`;
      protectedMap.set(key, word);
      return key;
    }
    return word;
  });

  for (const rx of COMPILED_STRICT_REGEXES) {
    rx.lastIndex = 0;
    if (rx.test(workingSentence)) {
      wasFiltered = true;
      rx.lastIndex = 0;
      workingSentence = workingSentence.replace(rx, '***');
    }
  }

  for (const rx of COMPILED_SHORT_REGEXES) {
    rx.lastIndex = 0;
    if (rx.test(workingSentence)) {
      wasFiltered = true;
      rx.lastIndex = 0;
      workingSentence = workingSentence.replace(rx, (fullMatch, g1) => {
        return fullMatch.replace(g1, '***');
      });
    }
  }

  for (const [key, originalWord] of protectedMap.entries()) {
    workingSentence = workingSentence.replace(key, originalWord);
  }

  cleanText = workingSentence;

  return {
    cleanText,
    wasFiltered
  };
}
