import { Injectable, signal, computed } from '@angular/core';
import { uk, en, SupportedLang, SUPPORTED_LANGUAGES } from '../i18n';

const STORAGE_KEY = 'cent-lang';
const DEFAULT_LANG: SupportedLang = 'uk';

/** Registry of all translation dictionaries */
const DICTIONARIES: Record<SupportedLang, Record<string, string>> = { uk, en };

@Injectable({ providedIn: 'root' })
export class I18nService {
  /** Current active language */
  readonly lang = signal<SupportedLang>(this.resolveInitialLang());

  /** All supported languages (for rendering language selectors) */
  readonly supportedLanguages = SUPPORTED_LANGUAGES;

  /** Reactive reference to the active dictionary */
  private readonly dictionary = computed(() => DICTIONARIES[this.lang()]);

  /**
   * Translate a key to the current language.
   * Supports interpolation: t('key', { name: 'Bob' }) → replaces {name} in the string.
   */
  t(key: string, params?: Record<string, string | number>): string {
    let value = this.dictionary()[key];

    if (value === undefined) {
      // Fallback: try default language, then return the key itself
      value = DICTIONARIES[DEFAULT_LANG][key] ?? key;
    }

    if (params) {
      for (const [param, replacement] of Object.entries(params)) {
        value = value.replace(new RegExp(`\\{${param}\\}`, 'g'), String(replacement));
      }
    }

    return value;
  }

  /** Switch to a different language */
  setLang(lang: SupportedLang): void {
    this.lang.set(lang);
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
  }

  /** Cycle to the next language (useful for a simple toggle button) */
  toggleLang(): void {
    const codes = SUPPORTED_LANGUAGES.map(l => l.code);
    const currentIndex = codes.indexOf(this.lang());
    const nextIndex = (currentIndex + 1) % codes.length;
    this.setLang(codes[nextIndex]);
  }

  /** Resolve initial language from localStorage or browser preference */
  private resolveInitialLang(): SupportedLang {
    const stored = localStorage.getItem(STORAGE_KEY) as SupportedLang | null;
    if (stored && stored in DICTIONARIES) {
      return stored;
    }

    // Check browser language
    const browserLang = navigator.language?.substring(0, 2) as SupportedLang;
    if (browserLang in DICTIONARIES) {
      return browserLang;
    }

    return DEFAULT_LANG;
  }
}
