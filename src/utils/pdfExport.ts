import { Notebook } from '../types';
import { StrokeRenderer } from '../engine/StrokeRenderer';

/**
 * Export a notebook as a PDF file using canvas rendering + jsPDF.
 * Renders each page to a canvas (including all background types and images),
 * then compiles into a PDF.
 */
export async function exportToPDF(notebook: Notebook): Promise<void> {
  const jsPDFModule = await import('jspdf');
  const jsPDF = jsPDFModule.default;

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'px',
    format: [notebook.pages[0]?.width || 1024, notebook.pages[0]?.height || 1366],
  });

  for (let i = 0; i < notebook.pages.length; i++) {
    if (i > 0) {
      pdf.addPage([notebook.pages[i].width, notebook.pages[i].height]);
    }

    const page = notebook.pages[i];
    const canvas = document.createElement('canvas');
    canvas.width = page.width * 2;
    canvas.height = page.height * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    ctx.scale(2, 2);

    // Draw background
    ctx.fillStyle = '#FAFAF8';
    ctx.fillRect(0, 0, page.width, page.height);

    if (page.background === 'lined') {
      ctx.strokeStyle = '#D5D5D3';
      ctx.lineWidth = 0.5;
      for (let y = 32; y < page.height; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(page.width, y);
        ctx.stroke();
      }
    } else if (page.background === 'grid') {
      ctx.strokeStyle = '#E0E0DE';
      ctx.lineWidth = 0.5;
      for (let x = 32; x < page.width; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, page.height);
        ctx.stroke();
      }
      for (let y = 32; y < page.height; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(page.width, y);
        ctx.stroke();
      }
    } else if (page.background === 'dotted') {
      ctx.fillStyle = '#C8C8C6';
      for (let x = 32; x < page.width; x += 32) {
        for (let y = 32; y < page.height; y += 32) {
          ctx.beginPath();
          ctx.arc(x, y, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (page.background === 'graph') {
      // Minor grid
      ctx.strokeStyle = '#E8E8E5';
      ctx.lineWidth = 0.3;
      for (let x = 20; x < page.width; x += 20) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, page.height);
        ctx.stroke();
      }
      for (let y = 20; y < page.height; y += 20) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(page.width, y);
        ctx.stroke();
      }
      // Major grid
      ctx.strokeStyle = '#C8C8C4';
      ctx.lineWidth = 0.8;
      for (let x = 100; x < page.width; x += 100) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, page.height);
        ctx.stroke();
      }
      for (let y = 100; y < page.height; y += 100) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(page.width, y);
        ctx.stroke();
      }
    } else if (page.background === 'cornell') {
      // Ruled lines
      ctx.strokeStyle = '#D5D5D3';
      ctx.lineWidth = 0.5;
      for (let y = 32; y < page.height; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(page.width, y);
        ctx.stroke();
      }
      // Left margin
      const marginX = page.width * 0.30;
      ctx.strokeStyle = '#E85D5D';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(marginX, 0);
      ctx.lineTo(marginX, page.height);
      ctx.stroke();
      // Bottom summary
      const summaryY = page.height * 0.75;
      ctx.beginPath();
      ctx.moveTo(0, summaryY);
      ctx.lineTo(page.width, summaryY);
      ctx.stroke();
    } else if (page.background === 'isometric') {
      const spacing = 28;
      const h = spacing * Math.sqrt(3) / 2;
      ctx.strokeStyle = '#DDDDD8';
      ctx.lineWidth = 0.4;
      for (let y = 0; y < page.height + h; y += h) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(page.width, y);
        ctx.stroke();
      }
      for (let x = -page.height; x < page.width + page.height; x += spacing) {
        ctx.beginPath();
        ctx.moveTo(x, page.height + h);
        ctx.lineTo(x + page.height / Math.tan(Math.PI / 3), -h);
        ctx.stroke();
      }
      for (let x = -page.height; x < page.width + page.height; x += spacing) {
        ctx.beginPath();
        ctx.moveTo(x, -h);
        ctx.lineTo(x + page.height / Math.tan(Math.PI / 3), page.height + h);
        ctx.stroke();
      }
    } else if (page.background === 'music') {
      ctx.strokeStyle = '#B8B8B5';
      ctx.lineWidth = 0.6;
      const lineH = 8;
      const gapH = 64;
      const staffHeight = lineH * 4;
      const totalBlock = staffHeight + gapH;
      for (let blockY = 40; blockY < page.height; blockY += totalBlock) {
        for (let line = 0; line < 5; line++) {
          const y = blockY + line * lineH;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(page.width, y);
          ctx.stroke();
        }
      }
    }

    // Draw images (below strokes)
    if (page.images && page.images.length > 0) {
      for (const img of page.images) {
        try {
          const htmlImg = await loadImage(img.src);
          ctx.save();
          ctx.globalAlpha = img.opacity;
          if (img.rotation !== 0) {
            const cx = img.x + img.width / 2;
            const cy = img.y + img.height / 2;
            ctx.translate(cx, cy);
            ctx.rotate((img.rotation * Math.PI) / 180);
            ctx.drawImage(htmlImg, -img.width / 2, -img.height / 2, img.width, img.height);
          } else {
            ctx.drawImage(htmlImg, img.x, img.y, img.width, img.height);
          }
          ctx.restore();
        } catch {
          // Skip images that fail to load
        }
      }
    }

    // Draw strokes
    for (const stroke of page.strokes) {
      StrokeRenderer.renderStroke(ctx, stroke);
    }

    // Add to PDF
    const imgData = canvas.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', 0, 0, page.width, page.height);
  }

  pdf.save(`${notebook.title.replace(/[^a-z0-9]/gi, '_')}.pdf`);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
