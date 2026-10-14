let strings = {};
let lang = 'en';

export async function initI18n(defaultLang = 'en') {
  lang = defaultLang || 'en';
  await loadLocale(lang);
}

async function loadLocale(l) {
  try {
    const res = await fetch(`../../locales/${l}.json`);
    strings = await res.json();
    lang = l;
    document.documentElement.lang = l;
  } catch (err) {
    console.warn(`Could not load locale ${l}:`, err);
    try {
      const fallback = await fetch(`../../locales/en.json`);
      strings = await fallback.json();
      lang = 'en';
    } catch {}
  }
}

export function t(key, fallback = '') {
  return strings[key] ?? fallback ?? key;
}

export async function setLanguage(l) {
  await loadLocale(l);
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key && strings[key]) el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key && strings[key]) el.placeholder = t(key);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key && strings[key]) el.title = t(key);
  });
}

export function getLang() {
  return lang;
}

export function itemDisplayName(item) {
  if (lang === 'ta' && item.name_ta) return `${item.name_ta} / ${item.name_en}`;
  if (lang === 'en') return item.name_en || item.name_ta;
  return item.name_en || item.name_ta;
}
