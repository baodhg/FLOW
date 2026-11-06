const SUPPORTED = new Set(['en', 'vi']);

function fromLocale(value) {
  return /^vi(?:[-_.]|$)/i.test(String(value)) ? 'vi' : 'en';
}

export function pickLanguage(env = {}, override, systemLocale = Intl.DateTimeFormat().resolvedOptions().locale) {
  if (typeof override === 'string' && SUPPORTED.has(override)) return override;
  for (const name of ['LC_ALL', 'LC_MESSAGES', 'LANG', 'LANGUAGE']) {
    const value = env[name];
    if (value && !/^(?:C|POSIX)(?:\.|$)/i.test(value)) return fromLocale(value);
  }
  return fromLocale(systemLocale);
}
