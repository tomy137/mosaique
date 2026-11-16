// Volets de l'interface : réglages à gauche, photos à droite.
// Préférences mémorisées dans le navigateur : volets visibles, largeur du volet photos,
// taille des miniatures, sections de réglages ouvertes ou fermées.

const KEY = 'mosaique.ui';
const RIGHT_DEFAULT = 340;
const RIGHT_MIN = 240;
const THUMB_DEFAULT = 96;
const CAPTIONS_FROM = 150; // à partir de cette taille, le nom de la photo s'affiche sous la miniature

interface UiPrefs {
  left: boolean;
  right: boolean;
  rightW: number;
  thumb: number;
  open: Record<string, boolean>;
}

function load(): UiPrefs {
  const base: UiPrefs = { left: true, right: true, rightW: RIGHT_DEFAULT, thumb: THUMB_DEFAULT, open: {} };
  try { return { ...base, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return base; }
}

export interface Panels {
  toggleLeft(): void;
  toggleRight(): void;
  /** Tab : tout masquer pour ne voir que le montage, ou tout réafficher. */
  toggleAll(): void;
}

export function setupPanels(): Panels {
  const prefs = load();
  const body = document.body;
  const photos = document.getElementById('photos')!;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ } };
  const maxRight = () => Math.max(RIGHT_MIN, Math.min(900, window.innerWidth - 520));

  const apply = () => {
    body.classList.toggle('hide-left', !prefs.left);
    body.classList.toggle('hide-right', !prefs.right);
    body.style.setProperty('--right-w', prefs.right ? `${Math.min(prefs.rightW, maxRight())}px` : '0px');
    document.getElementById('toggle-left')!.classList.toggle('active', prefs.left);
    document.getElementById('toggle-right')!.classList.toggle('active', prefs.right);
    photos.style.setProperty('--thumb', `${prefs.thumb}px`);
    photos.classList.toggle('captions', prefs.thumb >= CAPTIONS_FROM);
  };

  // --- sections repliables
  document.querySelectorAll<HTMLDetailsElement>('details.panel').forEach((d) => {
    const k = d.dataset.key!;
    if (k in prefs.open) d.open = prefs.open[k];
    d.addEventListener('toggle', () => { prefs.open[k] = d.open; save(); });
  });

  // --- largeur du volet photos (tirer son bord gauche ; double-clic : taille par défaut)
  const handle = document.getElementById('photos-resize')!;
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    body.classList.add('resizing');
    const move = (ev: PointerEvent) => {
      prefs.rightW = Math.round(Math.min(maxRight(), Math.max(RIGHT_MIN, window.innerWidth - ev.clientX)));
      apply();
    };
    const up = () => {
      body.classList.remove('resizing');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      save();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
  handle.addEventListener('dblclick', () => { prefs.rightW = RIGHT_DEFAULT; apply(); save(); });
  window.addEventListener('resize', apply);

  // --- taille des miniatures
  const slider = document.getElementById('thumb-size') as HTMLInputElement;
  slider.value = String(prefs.thumb);
  slider.addEventListener('input', () => { prefs.thumb = Number(slider.value); apply(); });
  slider.addEventListener('change', save);

  const panels: Panels = {
    toggleLeft() { prefs.left = !prefs.left; apply(); save(); },
    toggleRight() { prefs.right = !prefs.right; apply(); save(); },
    toggleAll() {
      const show = !prefs.left && !prefs.right;
      prefs.left = show;
      prefs.right = show;
      apply();
      save();
    },
  };
  document.getElementById('toggle-left')!.addEventListener('click', panels.toggleLeft);
  document.getElementById('toggle-right')!.addEventListener('click', panels.toggleRight);
  apply();
  return panels;
}
