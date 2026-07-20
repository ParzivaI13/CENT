/**
 * English — Secondary language
 * Key convention: component.section.element
 */
export const en: Record<string, string> = {
  // ─── Common ───────────────────────────────────────────
  'common.appName': 'CENT',
  'common.tagline': 'Cargo Efficient Navigator Tool',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.delete': 'Delete',
  'common.loading': 'Loading...',
  'common.yes': 'Yes',
  'common.no': 'No',

  // ─── Login ────────────────────────────────────────────
  'login.welcomeBack': 'Welcome Back',
  'login.createAccount': 'Create Account',
  'login.emailLabel': 'Email Address',
  'login.emailPlaceholder': 'driver@centcargo.com',
  'login.passwordLabel': 'Password',
  'login.passwordPlaceholder': '••••••••',
  'login.signIn': 'Sign In',
  'login.signUp': 'Sign Up',
  'login.alreadyHaveAccount': 'Already have an account?',
  'login.newToCent': 'New to CENT?',
  'login.createAnAccount': 'Create an account',
  'login.enterEmailAndPassword': 'Please enter email and password.',

  // ─── Login Errors ─────────────────────────────────────
  'login.error.invalidEmail': 'The email address is invalid.',
  'login.error.userDisabled': 'This user account has been disabled.',
  'login.error.invalidCredential': 'Invalid email or password.',
  'login.error.emailInUse': 'This email is already registered.',
  'login.error.weakPassword': 'Password should be at least 6 characters.',
  'login.error.tooManyRequests': 'Too many failed attempts. Please try again later.',
  'login.error.generic': 'An unexpected error occurred. Please try again.',

  // ─── Dashboard Header ────────────────────────────────
  'dashboard.mode2d': '2D Top',
  'dashboard.mode3d': '3D Orbit',
  'dashboard.trailers': 'Trailers',
  'dashboard.pallets': 'Pallets',
  'dashboard.clearAll': 'Clear all',
  'dashboard.signOut': 'Sign Out',
  'dashboard.logisticsDriver': 'Logistics Driver',
  'dashboard.autoOptimize': 'Auto-Optimize on Add',
  'dashboard.reoptimize': 'Re-optimize',
  'dashboard.restoreLayout': 'Layout History',
  'dashboard.undo': 'Undo',
  'dashboard.redo': 'Redo',

  // ─── Dashboard Dropdowns ──────────────────────────────
  'dashboard.defaultTrailer': 'Default Trailer',
  'dashboard.newTrailer': 'New Trailer',
  'dashboard.newPallet': 'New Pallet',
  'dashboard.stack': 'STACK',

  // ─── Dashboard Action Bar ─────────────────────────────
  'dashboard.rotate': 'Rotate',

  // ─── Live Editor ──────────────────────────────────────
  'editor.trailerTitle': 'Trailer Editor',
  'editor.customPalletTitle': 'Spawn Custom Pallet',
  'editor.spawnCustom': 'Spawn in Scene',
  'editor.customColor': 'Color',
  'editor.stackable': 'Stackable',
  'editor.length': 'Length',
  'editor.width': 'Width',
  'editor.height': 'Height',

  // ─── Right Sidebar ────────────────────────────────────
  'sidebar.palletList': 'Scene Pallets',

  // ─── Dashboard Modals — Trailer ───────────────────────
  'dashboard.modal.createTrailer': 'Create Trailer Profile',
  'dashboard.modal.profileLabel': 'Profile Label',
  'dashboard.modal.profilePlaceholder': 'e.g. Heavy Duty Flatbed',
  'dashboard.modal.length': 'Length (m)',
  'dashboard.modal.width': 'Width (m)',
  'dashboard.modal.height': 'Height (m)',
  'dashboard.modal.saveTrailer': 'Save Trailer Profile',

  // ─── Dashboard Modals — Pallet ────────────────────────
  'dashboard.modal.createPallet': 'Create Pallet Type',
  'dashboard.modal.palletLabel': 'Pallet / Cargo Label',
  'dashboard.modal.palletPlaceholder': 'e.g. Standard Euro-Box',
  'dashboard.modal.meshColor': 'Mesh Color',
  'dashboard.modal.stackable': 'Stackable (Allows cargo on top)',
  'dashboard.modal.savePallet': 'Save Pallet Preset',

  // ─── Dashboard Modals — Auto Load ─────────────────────
  'dashboard.modal.autoLoadout': 'Auto Loadout',
  'dashboard.modal.autoLoadSubtitle': 'Select pallet types and set their quantities. The solver will automatically pack them into the trailer.',
  'dashboard.modal.noPresets': 'No pallet presets saved yet. Create some first!',
  'dashboard.modal.solveAndLoad': 'Solve & Load',
  'dashboard.modal.allPlaced': '✓ All {placed} pallets placed successfully!',
  'dashboard.modal.partialPlaced': '⚠ {placed} of {total} pallets placed. {remaining} did not fit.',

  // ─── Dashboard Modals — History ───────────────────────
  'dashboard.modal.historyTitle': 'Restore Saved Layouts',
  'dashboard.modal.historySubtitle': 'Select a saved state to restore pallets to the scene.',
  'dashboard.modal.noHistory': 'History is empty.',
  'dashboard.modal.restoreBtn': 'Restore',
  'dashboard.modal.palletsCount': 'pallet(s)',

  // ─── Dashboard Toasts ─────────────────────────────────
  'toast.trailerNameRequired': 'Please provide a name for this trailer.',
  'toast.cargoNameRequired': 'Please provide a name for this cargo type.',
  'toast.invalidTrailerDimensions': 'Trailer dimensions must be positive numbers greater than zero.',
  'toast.trailerDimensionsTooLarge': 'Trailer dimensions are too large. Max: 25m × 5m × 5m.',
  'toast.invalidCargoDimensions': 'Cargo dimensions must be positive numbers greater than zero.',
  'toast.cargoDimensionsTooLarge': 'Cargo dimensions are too large. Max: 10m × 10m × 10m.',
  'toast.spawnBlocked': 'Cannot spawn "{name}". The spawn area is blocked or the pallet is too large.',

  // ─── Three.js Canvas ──────────────────────────────────
  'canvas.instructions': 'Click a pallet preset to spawn. Grab and drag boxes to move. Scroll to zoom.',

  // ─── Theme ────────────────────────────────────────────
  'theme.dark': 'Dark',
  'theme.light': 'Light',

  // ─── Language ─────────────────────────────────────────
  'lang.uk': 'Українська',
  'lang.en': 'English',
};
