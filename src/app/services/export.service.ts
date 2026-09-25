import { Injectable, inject } from '@angular/core';
import { CargoPreset, TrailerPreset, LayoutSnapshot, LayoutPalletInfo } from './storage.service';
import { PlacedPalletExportData } from '../components/three-canvas/three-canvas';
import { I18nService } from './i18n.service';

export interface PalletLayerGroup {
  layerIndex: number;
  layerName: string;
  pallets: PlacedPalletExportData[];
}

export interface PalletListExportFile {
  version: 1;
  generator: 'CENT Load Planner';
  exportedAt: string;
  trailer: {
    id?: string;
    name: string;
    length: number;
    width: number;
    height: number;
  };
  pallets: {
    id: string;
    number: number;
    name: string;
    length: number;
    width: number;
    height: number;
    lengthMm: number;
    widthMm: number;
    heightMm: number;
    color: string;
    stackable: boolean;
    x: number;
    y: number;
    z: number;
    rotationY: number;
  }[];
}

@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly i18n = inject(I18nService);

  // Scale: 100 pixels per 1 meter (1 mm = 0.1 px)
  private readonly SCALE = 100;

  // ─── MULTI-LAYER PARTITIONING ────────────────────────────

  /**
   * Partitions pallets into discrete vertical stacking layers.
   * Pallets with base at ground level (Y ≈ 0) belong to Layer 1.
   * Pallets stacked on top of Layer 1 belong to Layer 2, etc.
   */
  partitionIntoLayers(pallets: PlacedPalletExportData[]): PalletLayerGroup[] {
    if (pallets.length === 0) return [];

    // Sort by bottom Y elevation ascending
    const sorted = [...pallets].sort((a, b) => (a.y - a.height / 2) - (b.y - b.height / 2));
    const palletLayerMap = new Map<string, number>();

    for (const p of sorted) {
      const bottomY = p.y - p.height / 2;
      if (bottomY <= 0.05) {
        // Floor level (Layer 1)
        palletLayerMap.set(p.id, 1);
      } else {
        // Find pallets underneath that overlap in footprint
        let maxUnderneathLayer = 0;
        for (const other of sorted) {
          if (other.id === p.id) continue;
          const otherTopY = other.y + other.height / 2;
          if (Math.abs(otherTopY - bottomY) < 0.08 || otherTopY <= bottomY + 0.05) {
            const xOverlap = Math.abs(p.x - other.x) < (p.width / 2 + other.width / 2 - 0.02);
            const zOverlap = Math.abs(p.z - other.z) < (p.length / 2 + other.length / 2 - 0.02);
            if (xOverlap && zOverlap) {
              const otherLayer = palletLayerMap.get(other.id) ?? 1;
              if (otherLayer > maxUnderneathLayer) {
                maxUnderneathLayer = otherLayer;
              }
            }
          }
        }
        palletLayerMap.set(p.id, maxUnderneathLayer > 0 ? maxUnderneathLayer + 1 : 2);
      }
    }

    // Group by layer index
    const layerMap = new Map<number, PlacedPalletExportData[]>();
    for (const p of pallets) {
      const layer = palletLayerMap.get(p.id) ?? 1;
      if (!layerMap.has(layer)) {
        layerMap.set(layer, []);
      }
      layerMap.get(layer)!.push({ ...p, layer });
    }

    const result: PalletLayerGroup[] = [];
    const sortedLayerIndices = Array.from(layerMap.keys()).sort((a, b) => a - b);
    for (const idx of sortedLayerIndices) {
      result.push({
        layerIndex: idx,
        layerName: idx === 1 ? 'Layer 1 (Floor)' : `Layer ${idx}`,
        pallets: layerMap.get(idx)!,
      });
    }
    return result;
  }

  // ─── 2D SVG & JPG GENERATION ──────────────────────────────

  /**
   * Generates and downloads top-down visual 2D JPG image(s) for each layer.
   * Returns the number of layers exported.
   */
  async exportLoadoutToJpg(
    trailer: TrailerPreset,
    pallets: PlacedPalletExportData[]
  ): Promise<number> {
    if (pallets.length === 0) return 0;

    const layers = this.partitionIntoLayers(pallets);
    const totalLayers = layers.length;

    for (let i = 0; i < totalLayers; i++) {
      const layerGroup = layers[i];
      const svgString = this.generateLayerSvg(trailer, layerGroup, totalLayers, pallets.length);
      const dims = this.computeSvgDimensions(trailer, layerGroup.pallets.length);

      const jpgBlob = await this.convertSvgToJpgBlob(svgString, dims.width, dims.height);
      const cleanTrailerName = (trailer.name || 'trailer').toLowerCase().replace(/[^a-z0-9]/gi, '_');
      const filename = `${cleanTrailerName}_layer_${layerGroup.layerIndex}.jpg`;

      this.triggerDownload(jpgBlob, filename);

      // Slight delay between files so browser does not block multi-file downloads
      if (i < totalLayers - 1) {
        await new Promise((r) => setTimeout(r, 450));
      }
    }

    return totalLayers;
  }

  /** Calculate total SVG canvas width and height based on trailer dims and legend size */
  private computeSvgDimensions(
    trailer: TrailerPreset,
    palletCount: number
  ): { width: number; height: number } {
    const scale = this.SCALE;
    const headerHeight = 110;
    const cabLengthPx = 2.0 * scale; // 200px
    const gapPx = 10; // moved closer to trailer
    const trailerLengthPx = trailer.length * scale;

    const truckTotalLengthPx = headerHeight + cabLengthPx + gapPx + trailerLengthPx + 80;
    const legendHeightPx = headerHeight + 60 + palletCount * 30 + 60;
    const totalHeight = Math.max(truckTotalLengthPx, legendHeightPx, 800);

    const trailerWidthPx = trailer.width * scale;
    const leftMargin = 60;
    const progressWidthPx = 30;
    const progressGapPx = 25;
    const legendGapPx = 50;
    const legendWidthPx = 520;
    const rightMargin = 60;

    const totalWidth =
      leftMargin +
      Math.max(trailerWidthPx, 2.0 * scale) +
      progressGapPx +
      progressWidthPx +
      legendGapPx +
      legendWidthPx +
      rightMargin;

    return { width: Math.round(totalWidth), height: Math.round(totalHeight) };
  }

  /** Synthesizes the complete SVG markup for a given layer */
  private generateLayerSvg(
    trailer: TrailerPreset,
    layerGroup: PalletLayerGroup,
    totalLayers: number,
    totalPallets: number
  ): string {
    const scale = this.SCALE;
    const { width, height } = this.computeSvgDimensions(trailer, layerGroup.pallets.length);

    // Layout anchor coordinates
    const headerHeight = 110;
    const leftMargin = 60;
    const trailerW = trailer.width;
    const trailerL = trailer.length;
    const trailerWPx = trailerW * scale;
    const trailerLPx = trailerL * scale;

    const cabWPx = 2.0 * scale; // 200px
    const cabLPx = 2.0 * scale; // 200px
    const gapPx = 10; // moved closer to trailer

    const truckColWidth = Math.max(trailerWPx, cabWPx);
    const cabLeft = leftMargin + (truckColWidth - cabWPx) / 2;
    const trailerLeft = leftMargin + (truckColWidth - trailerWPx) / 2;

    const cabTop = headerHeight + 20;
    const trailerTop = cabTop + cabLPx + gapPx;
    const trailerBottom = trailerTop + trailerLPx;

    // Progress bar placement (right side of trailer)
    const progressBarLeft = trailerLeft + trailerWPx + 25;
    const progressBarWidth = 25;

    // Calculate filled cargo extent
    const halfL = trailerL / 2;
    let maxCargoZ = -halfL;
    layerGroup.pallets.forEach((p) => {
      const cargoEnd = p.z + p.length / 2;
      if (cargoEnd > maxCargoZ) maxCargoZ = cargoEnd;
    });

    const filledLength = layerGroup.pallets.length > 0 ? Math.min(trailerL, Math.max(0, maxCargoZ - (-halfL))) : 0;
    const remainingLength = Math.max(0, trailerL - filledLength);
    const filledHeightPx = filledLength * scale;
    const remainingHeightPx = remainingLength * scale;

    // Legend placement
    const legendLeft = progressBarLeft + progressBarWidth + 50;
    const legendWidth = 520;
    const legendTop = cabTop;

    // Header strings
    const trailerName = trailer.name || 'Standard Trailer';
    const layerTitle = `${this.i18n.t('export.layerTitle', { layer: layerGroup.layerIndex })} (${layerGroup.pallets.length} ${this.i18n.t('dashboard.modal.palletsCount')})`;
    const exportDate = new Date().toLocaleString();

    // ─── SVG Elements ───────────────────────────────────────
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      .title-text { font-family: system-ui, -apple-system, sans-serif; font-size: 22px; font-weight: 800; fill: #0f172a; }
      .sub-text { font-family: system-ui, -apple-system, sans-serif; font-size: 13px; font-weight: 500; fill: #64748b; }
      .badge-text { font-family: system-ui, -apple-system, sans-serif; font-size: 13px; font-weight: 700; fill: #ffffff; text-anchor: middle; }
      .pallet-num { font-family: system-ui, -apple-system, sans-serif; font-size: 16px; font-weight: 800; text-anchor: middle; dominant-baseline: middle; stroke: #0f172a; stroke-width: 0.8px; paint-order: stroke fill; fill: #ffffff; }
      .pallet-dim { font-family: system-ui, -apple-system, sans-serif; font-size: 10px; font-weight: 700; text-anchor: middle; dominant-baseline: middle; stroke: #0f172a; stroke-width: 0.6px; paint-order: stroke fill; fill: #ffffff; }
      .legend-header { font-family: system-ui, -apple-system, sans-serif; font-size: 15px; font-weight: 800; fill: #0f172a; }
      .legend-col { font-family: system-ui, -apple-system, sans-serif; font-size: 11px; font-weight: 700; fill: #64748b; text-transform: uppercase; }
      .legend-row-text { font-family: system-ui, -apple-system, sans-serif; font-size: 12px; font-weight: 600; fill: #1e293b; dominant-baseline: middle; }
      .bar-text { font-family: system-ui, -apple-system, sans-serif; font-size: 11px; font-weight: 700; fill: #ffffff; text-anchor: middle; }
    </style>
  </defs>

  <!-- Clean Background -->
  <rect width="${width}" height="${height}" fill="#ffffff"/>

  <!-- ═════════ HEADER SECTION ═════════ -->
  <rect x="0" y="0" width="${width}" height="${headerHeight}" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1"/>
  <text x="60" y="42" class="title-text">CENT</text>
  <text x="60" y="68" class="sub-text">${this.escapeXml(trailerName)} • ${trailerL.toFixed(2)}m × ${trailerW.toFixed(2)}m × ${trailer.height.toFixed(2)}m • ${totalPallets} ${this.i18n.t('dashboard.modal.palletsCount')}</text>
  <text x="60" y="88" class="sub-text">${this.escapeXml(exportDate)}</text>

  <!-- Layer Badge -->
  <rect x="${width - 240}" y="30" width="180" height="38" rx="8" fill="#3b82f6"/>
  <text x="${width - 150}" y="54" class="badge-text" text-anchor="middle">${this.escapeXml(layerTitle)}</text>

  <!-- ═════════ TRUCK CABIN ═════════ -->
  <!-- Cab Body (clean rectangle matching editor geometry) -->
  <rect x="${cabLeft}" y="${cabTop}" width="${cabWPx}" height="${cabLPx}" rx="4" fill="#475569" stroke="#334155" stroke-width="2"/>

  <!-- ═════════ TRAILER BODY ═════════ -->
  <!-- Trailer Floor -->
  <rect x="${trailerLeft}" y="${trailerTop}" width="${trailerWPx}" height="${trailerLPx}" rx="4" fill="#f8fafc" stroke="#3b82f6" stroke-width="3"/>
  <!-- Subtle trailer grid floor accents -->
  <line x1="${trailerLeft}" y1="${trailerTop}" x2="${trailerLeft + trailerWPx}" y2="${trailerTop}" stroke="#3b82f6" stroke-width="5"/>
  <line x1="${trailerLeft}" y1="${trailerBottom}" x2="${trailerLeft + trailerWPx}" y2="${trailerBottom}" stroke="#3b82f6" stroke-width="5"/>
`;

    // ═════════ PALLETS ON THIS LAYER ═════════
    for (const p of layerGroup.pallets) {
      // Map world coords (X: -trailerW/2 to +trailerW/2, Z: -trailerL/2 to +trailerL/2) to SVG
      const palletSvgX = trailerLeft + (p.x + trailerW / 2 - p.width / 2) * scale;
      const palletSvgY = trailerTop + (p.z + trailerL / 2 - p.length / 2) * scale;
      const palletSvgW = p.width * scale;
      const palletSvgH = p.length * scale;

      const centerX = palletSvgX + palletSvgW / 2;
      const centerY = palletSvgY + palletSvgH / 2;

      const widthMm = Math.round(p.width * 1000);
      const lengthMm = Math.round(p.length * 1000);

      svg += `
  <!-- Pallet #${p.number} -->
  <g>
    <rect x="${palletSvgX}" y="${palletSvgY}" width="${palletSvgW}" height="${palletSvgH}" rx="3" fill="${p.color}" fill-opacity="0.92" stroke="#0f172a" stroke-width="2"/>
    <text x="${centerX}" y="${centerY - 8}" class="pallet-num">#${p.number}</text>
    <text x="${centerX}" y="${centerY + 10}" class="pallet-dim">${widthMm}×${lengthMm} mm</text>
  </g>`;
    }

    // ═════════ PROGRESS BAR ═════════
    svg += `
  <!-- Progress Bar Container -->
  <g>
    <!-- Background track -->
    <rect x="${progressBarLeft}" y="${trailerTop}" width="${progressBarWidth}" height="${trailerLPx}" rx="4" fill="#e2e8f0" stroke="#cbd5e1" stroke-width="1.5"/>
`;

    if (filledHeightPx > 0.5) {
      svg += `
    <!-- Filled Cargo Segment -->
    <rect x="${progressBarLeft}" y="${trailerTop}" width="${progressBarWidth}" height="${filledHeightPx}" rx="3" fill="#3b82f6"/>
    <!-- Label -->
    <text x="${progressBarLeft + progressBarWidth / 2}" y="${trailerTop + filledHeightPx / 2 + 4}" class="bar-text">${filledLength.toFixed(1)}m</text>
`;
    }

    if (remainingHeightPx > 0.5) {
      svg += `
    <!-- Remaining Empty Segment -->
    <rect x="${progressBarLeft}" y="${trailerTop + filledHeightPx}" width="${progressBarWidth}" height="${remainingHeightPx}" rx="3" fill="#94a3b8"/>
    <!-- Label -->
    <text x="${progressBarLeft + progressBarWidth / 2}" y="${trailerTop + filledHeightPx + remainingHeightPx / 2 + 4}" class="bar-text">${remainingLength.toFixed(1)}m</text>
`;
    }
    svg += `  </g>`;

    // ═════════ RIGHT-SIDE LEGEND ═════════
    const legendCardHeight = Math.max(trailerLPx + cabLPx + gapPx, layerGroup.pallets.length * 30 + 80);
    svg += `
  <!-- Legend Panel -->
  <g>
    <rect x="${legendLeft}" y="${legendTop}" width="${legendWidth}" height="${legendCardHeight}" rx="10" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1.5"/>
    <text x="${legendLeft + 20}" y="${legendTop + 32}" class="legend-header">${this.i18n.t('export.legendTitle').toUpperCase()} — ${this.escapeXml(layerTitle.toUpperCase())}</text>
    <line x1="${legendLeft + 20}" y1="${legendTop + 44}" x2="${legendLeft + legendWidth - 20}" y2="${legendTop + 44}" stroke="#e2e8f0" stroke-width="1.5"/>

    <!-- Table Column Headers -->
    <text x="${legendLeft + 24}" y="${legendTop + 62}" class="legend-col">#</text>
    <text x="${legendLeft + 65}" y="${legendTop + 62}" class="legend-col">${this.i18n.t('editor.palletName')}</text>
    <text x="${legendLeft + 310}" y="${legendTop + 62}" class="legend-col">${this.i18n.t('export.dimensionsCol')}</text>
    <line x1="${legendLeft + 20}" y1="${legendTop + 72}" x2="${legendLeft + legendWidth - 20}" y2="${legendTop + 72}" stroke="#cbd5e1" stroke-width="1"/>
`;

    let rowY = legendTop + 94;
    for (const p of layerGroup.pallets) {
      const wMm = Math.round(p.width * 1000);
      const lMm = Math.round(p.length * 1000);
      const hMm = Math.round(p.height * 1000);

      // Truncate name if exceeding length
      const displayName = p.name.length > 22 ? p.name.substring(0, 20) + '…' : p.name;

      svg += `
    <!-- Legend Item #${p.number} -->
    <circle cx="${legendLeft + 30}" cy="${rowY - 4}" r="6" fill="${p.color}" stroke="#0f172a" stroke-width="1"/>
    <text x="${legendLeft + 44}" y="${rowY}" class="legend-row-text" font-weight="700">#${p.number}</text>
    <text x="${legendLeft + 70}" y="${rowY}" class="legend-row-text">${this.escapeXml(displayName)}</text>
    <text x="${legendLeft + 310}" y="${rowY}" class="legend-row-text">${wMm} × ${lMm} × ${hMm} mm</text>
`;
      rowY += 28;
    }

    svg += `
  </g>
</svg>`;

    return svg;
  }

  /** Converts SVG text into a high-DPI solid JPEG blob via offscreen canvas */
  async convertSvgToJpgBlob(svgString: string, width: number, height: number): Promise<Blob> {
    // 1. Pre-validate SVG XML in browser so any syntax anomaly is caught immediately
    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgString, 'image/svg+xml');
      const parserError = doc.querySelector('parsererror');
      if (parserError) {
        console.error('SVG XML parse error:', parserError.textContent);
        throw new Error(`SVG XML parse error: ${parserError.textContent}`);
      }
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      const renderCanvas = (imageSource: HTMLImageElement) => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas 2D context is not available'));
            return;
          }

          // Solid white background (JPEG has no alpha channel)
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);

          // Draw the SVG
          ctx.drawImage(imageSource, 0, 0);

          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('Failed to generate JPEG blob from canvas'));
              }
            },
            'image/jpeg',
            0.95
          );
        } catch (err) {
          reject(err);
        }
      };

      img.onload = () => {
        try {
          renderCanvas(img);
        } finally {
          URL.revokeObjectURL(url);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        // Fallback: try data URI if Blob URL hit browser sandbox / CORS restrictions
        const fallbackImg = new Image();
        fallbackImg.onload = () => {
          renderCanvas(fallbackImg);
        };
        fallbackImg.onerror = () => {
          reject(new Error('Failed to render SVG image to Canvas in browser'));
        };
        fallbackImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
      };

      img.src = url;
    });
  }

  // ─── JSON EXPORT & IMPORT ─────────────────────────────────

  /** Exports the pallet list and 3D layout into a formatted JSON file */
  exportPalletListToJson(
    trailer: TrailerPreset,
    pallets: PlacedPalletExportData[]
  ): void {
    const data: PalletListExportFile = {
      version: 1,
      generator: 'CENT Load Planner',
      exportedAt: new Date().toISOString(),
      trailer: {
        id: trailer.id,
        name: trailer.name || 'Default Trailer',
        length: trailer.length,
        width: trailer.width,
        height: trailer.height,
      },
      pallets: pallets.map((p) => {
        const origL = p.presetLength || p.length;
        const origW = p.presetWidth || p.width;
        return {
          id: p.id,
          number: p.number,
          name: p.name,
          length: origL,
          width: origW,
          height: p.height,
          lengthMm: Math.round(origL * 1000),
          widthMm: Math.round(origW * 1000),
          heightMm: Math.round(p.height * 1000),
          color: p.color,
          stackable: p.stackable,
          x: p.x,
          y: p.y,
          z: p.z,
          rotationY: p.rotationY,
        };
      }),
    };

    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const cleanName = (trailer.name || 'pallets').toLowerCase().replace(/[^a-z0-9]/gi, '_');
    this.triggerDownload(blob, `${cleanName}_pallets.json`);
  }

  /** Parses and validates a pallet list JSON file */
  async importPalletListFromJson(file: File): Promise<{
    trailer?: TrailerPreset;
    layout: LayoutSnapshot;
    count: number;
  }> {
    const text = await file.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('File is not valid JSON');
    }

    if (!data || !Array.isArray(data.pallets)) {
      throw new Error('Missing pallets array in file');
    }

    const pallets: LayoutPalletInfo[] = data.pallets.map((item: any, idx: number) => {
      const length = Number(item.length) || (Number(item.lengthMm) ? Number(item.lengthMm) / 1000 : 1.2);
      const width = Number(item.width) || (Number(item.widthMm) ? Number(item.widthMm) / 1000 : 1.0);
      const height = Number(item.height) || (Number(item.heightMm) ? Number(item.heightMm) / 1000 : 1.6);
      const color = item.color || `hsl(${Math.floor(Math.random() * 360)}, 70%, 55%)`;
      const name = item.name || `Pallet #${item.number ?? idx + 1}`;
      const id = item.id || `pallet-${crypto.randomUUID().substring(0, 8)}`;

      return {
        id,
        preset: {
          id: `preset-${id}`,
          name,
          length,
          width,
          height,
          color,
          stackable: Boolean(item.stackable),
        },
        x: typeof item.x === 'number' ? item.x : (Number(item.x) || 0),
        y: typeof item.y === 'number' ? item.y : (Number(item.y) || height / 2),
        z: typeof item.z === 'number' ? item.z : (Number(item.z) || 0),
        rotationY: typeof item.rotationY === 'number' ? item.rotationY : (Number(item.rotationY) || 0),
        number: Number(item.number) || idx + 1,
      };
    });

    let trailer: TrailerPreset | undefined;
    if (data.trailer && data.trailer.length && data.trailer.width && data.trailer.height) {
      trailer = {
        id: data.trailer.id || 'imported-trailer',
        name: data.trailer.name || 'Imported Trailer',
        length: Number(data.trailer.length),
        width: Number(data.trailer.width),
        height: Number(data.trailer.height),
      };
    }

    const layout: LayoutSnapshot = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      pallets,
    };

    return { trailer, layout, count: pallets.length };
  }

  // ─── HELPER METHODS ───────────────────────────────────────

  private triggerDownload(blob: Blob, filename: string): void {
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  }

  private escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  }
}
