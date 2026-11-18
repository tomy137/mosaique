// Répartition chronologique des photos sur les pages d'un album.
// Les photos sont triées par date puis découpées en groupes consécutifs (un par page) : on coupe de préférence
// aux plus grands écarts de temps (changement de moment, de journée), en gardant des pages équilibrées et
// entre `min` et `max` photos chacune.

export interface DatedPhoto { name: string; date: number }

export interface DistributeOptions {
  /** Photos par page : au moins / au plus (ajustés si le nombre de photos l'impose). */
  min: number;
  max: number;
}

const byDate = (a: DatedPhoto, b: DatedPhoto) => a.date - b.date || a.name.localeCompare(b.name, 'fr', { numeric: true });

/** Bornes réalisables : n pages de min à max photos doivent pouvoir contenir toutes les photos. */
export function feasibleBounds(total: number, pages: number, min: number, max: number): [number, number] {
  let lo = Math.max(1, Math.round(min)), hi = Math.max(lo, Math.round(max));
  if (lo * pages > total) lo = Math.max(1, Math.floor(total / pages));
  if (hi * pages < total) hi = Math.ceil(total / pages);
  return [lo, Math.max(lo, hi)];
}

/**
 * Découpe les photos (triées par date) en `pages` groupes consécutifs. Renvoie les noms par page.
 * Moins de photos que de pages : les dernières pages restent vides.
 */
export function distribute(photos: DatedPhoto[], pages: number, o: DistributeOptions): string[][] {
  const sorted = [...photos].sort(byDate);
  const N = sorted.length;
  if (pages <= 0) return [];
  if (N <= pages) return Array.from({ length: pages }, (_, i) => (sorted[i] ? [sorted[i].name] : []));
  const [lo, hi] = feasibleBounds(N, pages, o.min, o.max);
  const avg = N / pages;

  // intérêt d'une coupure avant la photo i : grand écart de temps = changement de moment
  const gapScore = (i: number) => {
    const gap = Math.max(0, sorted[i].date - sorted[i - 1].date) / 60000; // minutes
    return Math.log1p(gap);
  };
  // pages équilibrées : pénalité quadratique de l'écart à la moyenne
  const balance = (size: number) => ((size - avg) / avg) ** 2 * 6;

  // dp[k][i] : meilleur score pour placer les i premières photos sur k pages
  const NEG = -Infinity;
  const dp = Array.from({ length: pages + 1 }, () => new Float64Array(N + 1).fill(NEG));
  const from = Array.from({ length: pages + 1 }, () => new Int32Array(N + 1).fill(-1));
  dp[0][0] = 0;
  for (let k = 1; k <= pages; k++) {
    for (let i = 1; i <= N; i++) {
      for (let size = lo; size <= hi && size <= i; size++) {
        const j = i - size;
        if (dp[k - 1][j] === NEG) continue;
        const v = dp[k - 1][j] - balance(size) + (j > 0 ? gapScore(j) : 0);
        if (v > dp[k][i]) { dp[k][i] = v; from[k][i] = j; }
      }
    }
  }
  if (dp[pages][N] === NEG) {
    // bornes impossibles à tenir : découpe régulière
    return Array.from({ length: pages }, (_, k) => sorted.slice(Math.round(k * avg), Math.round((k + 1) * avg)).map((p) => p.name));
  }
  const out: string[][] = [];
  for (let k = pages, i = N; k > 0; k--) {
    const j = from[k][i];
    out.unshift(sorted.slice(j, i).map((p) => p.name));
    i = j;
  }
  return out;
}
