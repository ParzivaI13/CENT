export { uk } from './uk';
export { en } from './en';

/** Supported language codes */
export type SupportedLang = 'uk' | 'en';

/** All available languages with their display labels */
export const SUPPORTED_LANGUAGES: { code: SupportedLang; label: string }[] = [
  { code: 'uk', label: 'Українська' },
  { code: 'en', label: 'English' },
];
