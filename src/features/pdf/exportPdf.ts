import html2canvas from "html2canvas";
import jsPDF from "jspdf";

export type PdfQualityPreset = "balanced" | "max" | "small";
export type ExportStage = "preparing" | "capturing" | "paginating" | "saving";

type SectionRender = {
  section: HTMLElement;
  canvases: HTMLCanvasElement[];
  widthMm: number;
  heightsMm: number[];
};

type PdfExportErrorCode = "EMPTY_SECTIONS" | "PREFLIGHT" | "CAPTURE" | "CANVAS" | "TIMEOUT";

function classifyExportError(err: unknown): { code: PdfExportErrorCode; message: string } {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("no report sections")) return { code: "EMPTY_SECTIONS", message: "No report sections are available for capture." };
    if (msg.includes("preflight")) return { code: "PREFLIGHT", message: "Preflight check failed. Resolve validation issues and retry." };
    if (msg.includes("timeout")) return { code: "TIMEOUT", message: "Capture timeout. Check blocked images/fonts and retry." };
    if (msg.includes("canvas")) return { code: "CANVAS", message: "Canvas context is unavailable. Try reducing report complexity." };
  }
  return { code: "CAPTURE", message: "Section capture failed. Retry export and check external assets (CORS/fonts)." };
}

export async function exportPdfFromElement(opts: {
  title: string;
  element: HTMLElement;
  scale?: number;
  marginMm?: number;
}) {
  const { title, element, scale = 2.2, marginMm = 10 } = opts;

  const canvas = await html2canvas(element, {
    scale: Math.min(Math.max(scale, 1.5), 3),
    backgroundColor: "#070a10",
    useCORS: true,
    logging: false,
    scrollX: 0,
    scrollY: -window.scrollY,
    windowWidth: element.scrollWidth,
  });

  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const headerMm = 10;
  const footerMm = 8;

  const contentWidthMm = pageWidth - marginMm * 2;
  const contentHeightMm = pageHeight - marginMm * 2 - headerMm - footerMm;
  const pxPerMm = canvas.width / contentWidthMm;
  const sliceHeightPx = Math.max(32, Math.floor(contentHeightMm * pxPerMm));
  const totalPages = Math.max(1, Math.ceil(canvas.height / sliceHeightPx));

  for (let page = 0; page < totalPages; page++) {
    if (page > 0) pdf.addPage();

    const sourceY = page * sliceHeightPx;
    const sourceHeight = Math.min(sliceHeightPx, canvas.height - sourceY);
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = sourceHeight;
    const ctx = pageCanvas.getContext("2d");
    if (!ctx) throw new Error("Unable to render PDF page canvas.");

    ctx.drawImage(canvas, 0, sourceY, canvas.width, sourceHeight, 0, 0, canvas.width, sourceHeight);
    const imgData = pageCanvas.toDataURL("image/png");
    const imgHeightMm = sourceHeight / pxPerMm;

    pdf.setFontSize(11);
    pdf.text(title, marginMm, marginMm + 4);
    pdf.setFontSize(9);
    pdf.text(`Page ${page + 1} / ${totalPages}`, pageWidth - marginMm, marginMm + 4, { align: "right" });
    pdf.addImage(imgData, "PNG", marginMm, marginMm + headerMm, contentWidthMm, imgHeightMm, undefined, "FAST");
  }

  pdf.save(`${title.replace(/\s+/g, "_")}.pdf`);
}

function getPresetScale(preset: PdfQualityPreset) {
  if (preset === "max") return 3;
  if (preset === "small") return 2.1;
  return 2.6;
}

function renderScale(preset: PdfQualityPreset) {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  return Math.min(3.2, Math.max(1.8, getPresetScale(preset), dpr));
}

export function paginateHeights(heightsMm: number[], availableMm: number): number[][] {
  const pages: number[][] = [];
  let current: number[] = [];
  let used = 0;
  for (let i = 0; i < heightsMm.length; i++) {
    const h = heightsMm[i];
    if (current.length > 0 && used + h > availableMm) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(i);
    used += h;
  }
  if (current.length > 0) pages.push(current);
  return pages;
}

function sliceCanvasByHeight(canvas: HTMLCanvasElement, maxSlicePx: number) {
  const out: HTMLCanvasElement[] = [];
  let y = 0;
  while (y < canvas.height) {
    const h = Math.min(maxSlicePx, canvas.height - y);
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = h;
    const ctx = pageCanvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable while slicing.");
    ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    out.push(pageCanvas);
    y += h;
  }
  return out;
}

export async function exportReportPdfFromSections(opts: {
  title: string;
  sections: HTMLElement[];
  pageFormat?: "a4";
  orientation?: "p" | "portrait";
  marginMm?: number;
  qualityPreset?: PdfQualityPreset;
  onStage?: (stage: ExportStage) => void;
}) {
  const {
    title,
    sections,
    pageFormat = "a4",
    orientation = "p",
    marginMm = 10,
    qualityPreset = "balanced",
    onStage,
  } = opts;
  if (sections.length === 0) throw new Error("No report sections were found for export.");
  const detached = sections.some((s) => !s.isConnected);
  if (detached) throw new Error("Preflight failed: one or more report sections are detached.");
  const hidden = sections.some((s) => s.clientWidth < 20 || s.clientHeight < 20);
  if (hidden) throw new Error("Preflight failed: one or more report sections are hidden or empty.");

  onStage?.("preparing");

  const pdf = new jsPDF(orientation, "mm", pageFormat);
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const headerMm = 12;
  const footerMm = 8;
  const contentWidthMm = pageWidth - marginMm * 2;
  const contentHeightMm = pageHeight - marginMm * 2 - headerMm - footerMm;
  const stamp = new Date().toLocaleString();

  onStage?.("capturing");
  const rendered: SectionRender[] = [];
  try {
    for (const section of sections) {
      const canvas = await html2canvas(section, {
        scale: renderScale(qualityPreset),
        backgroundColor: "#ffffff",
        useCORS: true,
        imageTimeout: 8000,
        logging: false,
        scrollX: 0,
        scrollY: -window.scrollY,
        windowWidth: section.scrollWidth,
        windowHeight: section.scrollHeight,
      });
      const pxPerMm = canvas.width / contentWidthMm;
      const maxSlicePx = Math.max(32, Math.floor((contentHeightMm - 2) * pxPerMm));
      const chunks = sliceCanvasByHeight(canvas, maxSlicePx);
      rendered.push({
        section,
        canvases: chunks,
        widthMm: contentWidthMm,
        heightsMm: chunks.map((c) => c.height / pxPerMm),
      });
    }
  } catch (err) {
    const classified = classifyExportError(err);
    throw new Error(`${classified.code}: ${classified.message}`);
  }

  onStage?.("paginating");
  const paddedHeights = rendered.flatMap((r) => r.heightsMm.map((h) => h + 2));
  const pages = paginateHeights(paddedHeights, contentHeightMm);
  const totalPages = pages.length;
  const flatChunks = rendered.flatMap((r) =>
    r.canvases.map((canvas, i) => ({
      canvas,
      widthMm: r.widthMm,
      heightMm: r.heightsMm[i],
      sectionId: r.section.id || r.section.dataset.section || "section",
      chunk: i,
    }))
  );

  const drawHeaderFooter = (pageIndex: number) => {
    pdf.setTextColor(34, 34, 34);
    pdf.setFontSize(12);
    pdf.text(title, marginMm, marginMm + 4.5);
    pdf.setFontSize(8.6);
    pdf.text(stamp, marginMm, marginMm + 9);
    pdf.text(`Page ${pageIndex + 1} / ${totalPages}`, pageWidth - marginMm, marginMm + 4.5, { align: "right" });
    pdf.setDrawColor(190, 190, 190);
    pdf.line(marginMm, marginMm + headerMm - 1, pageWidth - marginMm, marginMm + headerMm - 1);
    pdf.line(marginMm, pageHeight - marginMm - footerMm + 2, pageWidth - marginMm, pageHeight - marginMm - footerMm + 2);
  };

  pages.forEach((page, pageIndex) => {
    if (pageIndex > 0) pdf.addPage();
    drawHeaderFooter(pageIndex);
    let cursorMm = marginMm + headerMm;
    for (const idx of page) {
      const item = flatChunks[idx];
      const imgData = item.canvas.toDataURL("image/png");
      pdf.addImage(imgData, "PNG", marginMm, cursorMm, item.widthMm, item.heightMm, undefined, "NONE");
      cursorMm += item.heightMm + 2;
    }
  });

  onStage?.("saving");
  pdf.save(`${title.replace(/\s+/g, "_")}.pdf`);
}
