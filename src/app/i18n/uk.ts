/**
 * Ukrainian (Українська) — Default language
 * Key convention: component.section.element
 */
export const uk: Record<string, string> = {
  // ─── Common ───────────────────────────────────────────
  'common.appName': 'CENT',
  'common.tagline': 'Cargo Efficient Navigator Tool',
  'common.save': 'Зберегти',
  'common.cancel': 'Скасувати',
  'common.close': 'Закрити',
  'common.delete': 'Видалити',
  'common.loading': 'Завантаження...',
  'common.yes': 'Так',
  'common.no': 'Ні',

  // ─── Login ────────────────────────────────────────────
  'login.welcomeBack': 'З поверненням',
  'login.createAccount': 'Створити акаунт',
  'login.emailLabel': 'Електронна пошта',
  'login.emailPlaceholder': 'driver@centcargo.com',
  'login.passwordLabel': 'Пароль',
  'login.passwordPlaceholder': '••••••••',
  'login.signIn': 'Увійти',
  'login.signUp': 'Зареєструватися',
  'login.alreadyHaveAccount': 'Вже маєте акаунт?',
  'login.newToCent': 'Новий у CENT?',
  'login.createAnAccount': 'Створити акаунт',
  'login.enterEmailAndPassword': 'Будь ласка, введіть email та пароль.',

  // ─── Login Errors ─────────────────────────────────────
  'login.error.invalidEmail': 'Невірна адреса електронної пошти.',
  'login.error.userDisabled': 'Цей обліковий запис було деактивовано.',
  'login.error.invalidCredential': 'Невірний email або пароль.',
  'login.error.emailInUse': 'Ця адреса вже зареєстрована.',
  'login.error.weakPassword': 'Пароль повинен містити щонайменше 6 символів.',
  'login.error.tooManyRequests': 'Занадто багато невдалих спроб. Спробуйте пізніше.',
  'login.error.generic': 'Виникла непередбачена помилка. Спробуйте ще раз.',

  // ─── Dashboard Header ────────────────────────────────
  'dashboard.mode2d': '2D Зверху',
  'dashboard.mode3d': '3D Орбіта',
  'dashboard.trailers': 'Причепи',
  'dashboard.pallets': 'Палети',
  'dashboard.clearAll': 'Очистити все',
  'dashboard.signOut': 'Вийти',
  'dashboard.logisticsDriver': 'Логіст-водій',
  'dashboard.autoOptimize': 'Авто-оптимізація при додаванні',
  'dashboard.reoptimize': 'Переоптимізувати',
  'dashboard.restoreLayout': 'Історія розстановок',
  'dashboard.undo': 'Скасувати дію',
  'dashboard.redo': 'Повторити дію',

  // ─── Dashboard Dropdowns ──────────────────────────────
  'dashboard.defaultTrailer': 'Стандартний причіп',
  'dashboard.newTrailer': 'Новий причіп',
  'dashboard.newPallet': 'Нова палета',
  'dashboard.stack': 'СТЕК',

  // ─── Dashboard Action Bar ─────────────────────────────
  'dashboard.rotate': 'Обертати',

  // ─── Live Editor ──────────────────────────────────────
  'editor.trailerTitle': 'Редактор трейлера',
  'editor.customPalletSection': 'Власна палета',
  'editor.customPalletTitle': 'Створити власну палету',
  'editor.palletName': 'Назва палети',
  'editor.spawnCustom': 'Додати на сцену',
  'editor.customColor': 'Колір',
  'editor.stackable': 'Штабелювання',
  'editor.length': 'Довжина',
  'editor.width': 'Ширина',
  'editor.height': 'Висота',

  // ─── Right Sidebar ────────────────────────────────────
  'sidebar.palletList': 'Палети на сцені',

  // ─── Dashboard Modals — Trailer ───────────────────────
  'dashboard.modal.createTrailer': 'Створити профіль причепа',
  'dashboard.modal.profileLabel': 'Назва профілю',
  'dashboard.modal.profilePlaceholder': 'напр. Великий бортовий',
  'dashboard.modal.length': 'Довжина (м)',
  'dashboard.modal.width': 'Ширина (м)',
  'dashboard.modal.height': 'Висота (м)',
  'dashboard.modal.saveTrailer': 'Зберегти профіль причепа',

  // ─── Dashboard Modals — Pallet ────────────────────────
  'dashboard.modal.createPallet': 'Створити тип палети',
  'dashboard.modal.palletLabel': 'Палета / Вантаж',
  'dashboard.modal.palletPlaceholder': 'напр. Стандартна Євро-Коробка',
  'dashboard.modal.meshColor': 'Колір',
  'dashboard.modal.stackable': 'Штабелювання (дозволяє вантаж зверху)',
  'dashboard.modal.savePallet': 'Зберегти тип палети',

  // ─── Dashboard Modals — Auto Load ─────────────────────
  'dashboard.modal.autoLoadout': 'Авто-завантаження',
  'dashboard.modal.autoLoadSubtitle': 'Оберіть типи палет і встановіть їхню кількість. Алгоритм автоматично розмістить їх у причепі.',
  'dashboard.modal.noPresets': 'Ще немає збережених типів палет. Спершу створіть їх!',
  'dashboard.modal.solveAndLoad': 'Розрахувати та завантажити',
  'dashboard.modal.allPlaced': '✓ Усі {placed} палет(и) успішно розміщені!',
  'dashboard.modal.partialPlaced': '⚠ {placed} з {total} палет розміщено. {remaining} не вмістилися.',

  // ─── Dashboard Modals — History ───────────────────────
  'dashboard.modal.historyTitle': 'Відновлення збережених розстановок',
  'dashboard.modal.historySubtitle': 'Оберіть збережений стан, щоб повернути палети на сцену.',
  'dashboard.modal.noHistory': 'Історія порожня.',
  'dashboard.modal.restoreBtn': 'Відновити',
  'dashboard.modal.palletsCount': 'палет(и)',

  // ─── Dashboard Toasts ─────────────────────────────────
  'toast.trailerNameRequired': 'Будь ласка, вкажіть назву для цього причепа.',
  'toast.cargoNameRequired': 'Будь ласка, вкажіть назву для цього типу вантажу.',
  'toast.invalidTrailerDimensions': 'Розміри причепа повинні бути додатними числами більше нуля.',
  'toast.trailerDimensionsTooLarge': 'Розміри причепа завеликі. Макс: 25м × 5м × 5м.',
  'toast.invalidCargoDimensions': 'Розміри вантажу повинні бути додатними числами більше нуля.',
  'toast.cargoDimensionsTooLarge': 'Розміри вантажу завеликі. Макс: 10м × 10м × 10м.',
  'toast.spawnBlocked': 'Неможливо створити "{name}". Зона розміщення зайнята або палета завелика.',

  // ─── Three.js Canvas ──────────────────────────────────
  'canvas.instructions': 'Натисніть тип палети, щоб створити. Перетягуйте блоки для переміщення. Прокрутка для масштабу.',

  // ─── Theme ────────────────────────────────────────────
  'theme.dark': 'Темна',
  'theme.light': 'Світла',

  // ─── Language ─────────────────────────────────────────
  'lang.uk': 'Українська',
  'lang.en': 'English',
};
