/**
 * Filtro de Ofensas e Palavrões (PT-BR / EN) para o Chat do Tribunal da Igreja.
 * Normaliza acentos e caracteres leet-speak (ex: @->a, 3->e, 1->i, 0->o, $->s)
 * e substitui termos ofensivos por asteriscos (***), retornando o texto limpo
 * e um indicador se houve censura.
 */

const OFFENSIVE_PATTERNS: RegExp[] = [
  /\b(porra|p0rra|caralh[oa]s?|krl|cacete|merda|m3rda|bosta|b0sta)\b/gi,
  /\b(puta|put0|puto|putaria|fdp|filh[oa]\s*da\s*puta)\b/gi,
  /\b(arrombad[oa]s?|otari[oa]s?|babaca[s]?|imbecil|imbecis|idiota[s]?|retardad[oa]s?)\b/gi,
  /\b(vagabund[oa]s?|vadia[s]?|piranha[s]?|corno[s]?|desgracad[oa]s?)\b/gi,
  /\b(viad[oa]s?|viadinh[oa]s?|bicha[s]?|boiola[s]?)\b/gi,
  /\b(cuzao|cuz[aã]o|cuzaum|buceta|boceta|pau\s*no\s*cu|vai\s*se\s*foder|vsf|vtnc|foda[\s-]*se|foder|fodid[oa])\b/gi,
  /\b(lixo\s*humano|se\s*mata|kys|fuck|shit|bitch|asshole)\b/gi
];

function stripAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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

  // Testamos cada palavra/frase também na versão sem acento e com leet básico convertido
  const words = trimmed.split(/(\s+)/);
  const processedWords = words.map((token) => {
    if (/^\s+$/.test(token)) return token;
    const normalizedToken = stripAccents(token)
      .replace(/@/g, 'a')
      .replace(/3/g, 'e')
      .replace(/1/g, 'i')
      .replace(/0/g, 'o')
      .replace(/\$/g, 's');

    for (const pattern of OFFENSIVE_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(normalizedToken)) {
        wasFiltered = true;
        return '***';
      }
    }
    return token;
  });

  let cleanText = processedWords.join('');

  // Verifica também expressões compostas (ex: "filho da puta", "vai se foder", "pau no cu")
  const normalizedFull = stripAccents(cleanText);
  for (const pattern of OFFENSIVE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(normalizedFull)) {
      wasFiltered = true;
      cleanText = normalizedFull.replace(pattern, '***');
    }
  }

  return {
    cleanText,
    wasFiltered
  };
}
