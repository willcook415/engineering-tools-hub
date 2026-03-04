import jsPDF from "jspdf";
import html2canvas from "html2canvas";

export async function exportPdfFromElement(opts: {
  title: string;
  element: HTMLElement;
}) {
  const { title, element } = opts;

  const canvas = await html2canvas(element, { scale: 2 });
  const imgData = canvas.toDataURL("image/png");

  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  // Fit image into A4 while preserving aspect ratio
  const imgProps = pdf.getImageProperties(imgData);
  const imgWidth = pageWidth;
  const imgHeight = (imgProps.height * imgWidth) / imgProps.width;

  let y = 0;
  pdf.setFontSize(14);
  pdf.text(title, 10, 10);
  y = 15;

  // If the content is taller than one page, add pages
  let remainingHeight = imgHeight;
  let position = y;

  pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);

  remainingHeight -= pageHeight - position;

  while (remainingHeight > 0) {
    pdf.addPage();
    const offsetY = -(imgHeight - remainingHeight) + 10;
    pdf.addImage(imgData, "PNG", 0, offsetY, imgWidth, imgHeight);
    remainingHeight -= pageHeight - 10;
  }

  pdf.save(`${title.replace(/\s+/g, "_")}.pdf`);
}