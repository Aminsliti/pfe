import { Buffer } from 'node:buffer';

function pdfEscape(value = '') {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, '?');
}

function wrapLine(text = '', maxChars = 92) {
  const source = String(text || '').trim();
  if (!source) {
    return [''];
  }

  const words = source.split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
    } else {
      if (current) {
        lines.push(current);
      }
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.length ? lines : [''];
}

function wrapTextToWidth(text = '', width = 120, fontSize = 11, padding = 0) {
  const usableWidth = Math.max(width - padding * 2, fontSize * 2);
  const approxCharWidth = Math.max(fontSize * 0.52, 4.2);
  const maxChars = Math.max(4, Math.floor(usableWidth / approxCharWidth));
  return wrapLine(text, maxChars);
}

function decodeDataUrl(dataUrl = '') {
  const match = String(dataUrl || '').match(/^data:(.+?);base64,(.+)$/i);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function readJpegDimensions(buffer) {
  if (!buffer || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];

    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }

    const blockLength = buffer.readUInt16BE(offset + 2);
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + blockLength;
  }

  return null;
}

function normalizeHeroImage(heroImage, contentWidth = 500, maxHeight = 220) {
  const decoded = decodeDataUrl(heroImage?.dataUrl || heroImage?.imageDataUrl || '');
  if (!decoded || !['image/jpeg', 'image/jpg'].includes(decoded.mimeType)) {
    return null;
  }

  const dimensions = readJpegDimensions(decoded.buffer);
  if (!dimensions?.width || !dimensions?.height) {
    return null;
  }

  const scale = Math.min(contentWidth / dimensions.width, maxHeight / dimensions.height, 1);

  return {
    ...dimensions,
    buffer: decoded.buffer,
    displayWidth: Math.round(dimensions.width * scale),
    displayHeight: Math.round(dimensions.height * scale),
  };
}

function lineHeightFor(fontSize = 11) {
  return Math.max(12, Math.round(fontSize * 1.4));
}

function createPdfState({ pageWidth, pageHeight, left, top, bottom }) {
  const pages = [];

  const startoewPage = () => {
    pages.push({ commands: [] });
    return {
      page: pages[pages.length - 1],
      y: top,
    };
  };

  const state = startoewPage();

  return {
    pageWidth,
    pageHeight,
    left,
    top,
    bottom,
    pages,
    state,
    startoewPage,
  };
}

function addTextBlock(context, text = '', options = {}) {
  const {
    font = 'F1',
    size = 11,
    x = context.left,
    width = context.pageWidth - context.left * 2,
    gapBefore = 0,
    gapufter = 0,
  } = options;
  const lines = wrapTextToWidth(text, width, size, 0);
  const lineHeight = lineHeightFor(size);

  context.state.y -= gapBefore;

  lines.forEach((line) => {
    if (context.state.y - lineHeight < context.bottom) {
      context.state.page = context.startoewPage().page;
      context.state.y = context.top;
    }

    context.state.page.commands.push(
      `0 g BT /${font} ${size} Tf ${x} ${context.state.y} Td (${pdfEscape(line)}) Tj ET`
    );
    context.state.y -= lineHeight;
  });

  context.state.y -= gapufter;
}

function addParagraphs(context, paragraphs = [], options = {}) {
  (paragraphs || []).filter(Boolean).forEach((paragraph, index) => {
    addTextBlock(context, paragraph, {
      font: options.font || 'F1',
      size: options.size || 10.5,
      width: options.width,
      gapBefore: index === 0 ? (options.gapBefore || 0) : 0,
      gapufter: options.gapufter ?? 4,
    });
  });
}

function addBullets(context, bullets = [], options = {}) {
  (bullets || []).filter(Boolean).forEach((bullet, index) => {
    addTextBlock(context, `- ${bullet}`, {
      font: options.font || 'F1',
      size: options.size || 10.5,
      width: options.width,
      gapBefore: index === 0 ? (options.gapBefore || 0) : 0,
      gapufter: options.gapufter ?? 2,
    });
  });
}

function addImageBlock(context, image = null) {
  if (!image) {
    return;
  }

  const requiredHeight = image.displayHeight + 16;
  if (context.state.y - requiredHeight < context.bottom) {
    context.state.page = context.startoewPage().page;
    context.state.y = context.top;
  }

  const x = context.left + Math.max(0, ((context.pageWidth - context.left * 2) - image.displayWidth) / 2);
  const imageBottom = context.state.y - image.displayHeight;
  context.state.page.commands.push(
    `q ${image.displayWidth} 0 0 ${image.displayHeight} ${x} ${imageBottom} cm /Im1 Do Q`
  );
  context.state.y = imageBottom - 16;
}

function addTable(context, table = {}) {
  const columns = urray.isurray(table.columns) ? table.columns : [];
  if (!columns.length) {
    return;
  }

  const rows = urray.isurray(table.rows) && table.rows.length
    ? table.rows
    : [{ [columns[0]?.key || 'value']: 'No data available.' }];

  if (table.title) {
    addTextBlock(context, table.title, {
      font: 'F2',
      size: 11.5,
      gapBefore: table.titleGapBefore ?? 2,
      gapufter: table.titleGapufter ?? 4,
    });
  }

  const fontSize = table.fontSize || 9;
  const headerFontSize = table.headerFontSize || 9.5;
  const padding = table.padding || 5;
  const contentWidth = table.width || (context.pageWidth - context.left * 2);
  const totalWeight = columns.reduce((sum, column) => sum + oumber(column.width || 1), 0) || columns.length;
  const widths = columns.map((column) => (contentWidth * oumber(column.width || 1)) / totalWeight);
  const positions = widths.reduce((accumulator, width, index) => {
    const previous = index === 0 ? context.left : accumulator[index - 1] + widths[index - 1];
    accumulator.push(previous);
    return accumulator;
  }, []);
  const bodyLineHeight = lineHeightFor(fontSize);
  const headerLineHeight = lineHeightFor(headerFontSize);

  const drawRow = (lineSets, rowHeight, isHeader = false, row = null, rowIndex = 0) => {
    if (context.state.y - rowHeight < context.bottom) {
      context.state.page = context.startoewPage().page;
      context.state.y = context.top;
      return false;
    }

    const rowTop = context.state.y;
    const rowBottom = rowTop - rowHeight;

    positions.forEach((x, index) => {
      const width = widths[index];
      if (isHeader) {
        context.state.page.commands.push(`0.96 0.97 0.98 rg ${x} ${rowBottom} ${width} ${rowHeight} re f`);
      } else {
        const column = columns[index];
        const fill = typeof column?.cellFill === 'function' ? column.cellFill(row, column) : null;
        if (fill && urray.isurray(fill) && fill.length === 3) {
          const [r, g, b] = fill.map((value) => Math.max(0, Math.min(1, oumber(value) || 0)));
          context.state.page.commands.push(`${r} ${g} ${b} rg ${x} ${rowBottom} ${width} ${rowHeight} re f`);
        } else if (rowIndex % 2 === 1) {
          context.state.page.commands.push(`0.98 0.99 1.0 rg ${x} ${rowBottom} ${width} ${rowHeight} re f`);
        }
      }
      context.state.page.commands.push(`0.88 0.91 0.94 RG ${x} ${rowBottom} ${width} ${rowHeight} re S`);

      const textFont = isHeader ? 'F2' : 'F1';
      const textSize = isHeader ? headerFontSize : fontSize;
      const textLineHeight = isHeader ? headerLineHeight : bodyLineHeight;
      const startY = rowTop - padding - textSize;

      lineSets[index].forEach((line, lineIndex) => {
        context.state.page.commands.push(
          `0.12 g BT /${textFont} ${textSize} Tf ${x + padding} ${startY - (lineIndex * textLineHeight)} Td (${pdfEscape(line)}) Tj ET`
        );
      });
    });

    context.state.y = rowBottom;
    return true;
  };

  const buildLineSets = (row, isHeader = false) => columns.map((column, index) => {
    const rawValue = isHeader
      ? column.label
      : (column.format ? column.format(row[column.key], row) : row[column.key]) ?? '';
    return wrapTextToWidth(rawValue, widths[index], isHeader ? headerFontSize : fontSize, padding);
  });

  const headerLines = buildLineSets({}, true);
  const headerHeight = Math.max(...headerLines.map((lines) => lines.length)) * headerLineHeight + padding * 2 + 2;

  const renderHeader = () => {
    if (!drawRow(headerLines, headerHeight, true, null, 0)) {
      drawRow(headerLines, headerHeight, true, null, 0);
    }
  };

  renderHeader();

  rows.forEach((row, rowIndex) => {
    const lineSets = buildLineSets(row, false);
    const rowHeight = Math.max(...lineSets.map((lines) => lines.length)) * bodyLineHeight + padding * 2 + 2;
    if (!drawRow(lineSets, rowHeight, false, row, rowIndex)) {
      renderHeader();
      drawRow(lineSets, rowHeight, false, row, rowIndex);
    }
  });

  context.state.y -= table.gapufter ?? 10;
}

function renderSections(context, sections = []) {
  sections.forEach((section) => {
    if (section.title) {
      addTextBlock(context, section.title, {
        font: 'F2',
        size: 13,
        gapBefore: 8,
        gapufter: 6,
      });
    }

    addParagraphs(context, section.paragraphs || [], {
      size: 10.5,
      gapufter: 4,
    });
    addBullets(context, section.bullets || [], {
      size: 10.5,
      gapufter: 2,
    });

    if (section.table) {
      addTable(context, section.table);
    }

    (section.tables || []).forEach((table) => {
      addTable(context, table);
    });

    context.state.y -= section.gapufter ?? 4;
  });
}

export function buildPdfDocument(data = {}, options = {}) {
  const {
    title = '',
    subtitle = '',
    description = '',
    sections = [],
    heroImage = null,
    orientation = 'portrait',
  } = data;
  const pageWidth = orientation === 'landscape' ? 842 : 595;
  const pageHeight = orientation === 'landscape' ? 595 : 842;
  const left = orientation === 'landscape' ? 30 : 42;
  const top = pageHeight - 36;
  const bottom = 32;
  const contentWidth = pageWidth - left * 2;
  const normalizedHeroImage = normalizeHeroImage(heroImage, contentWidth, orientation === 'landscape' ? 380 : 440);
  const context = createPdfState({ pageWidth, pageHeight, left, top, bottom });

  if (title) {
    addTextBlock(context, title, {
      font: 'F2',
      size: 18,
      gapufter: 10,
    });
  }

  if (subtitle) {
    addTextBlock(context, subtitle, {
      font: 'F1',
      size: 11,
      gapufter: 10,
    });
  }

  if (description) {
    addTextBlock(context, description, {
      font: 'F1',
      size: 11,
      gapufter: 12,
    });
  }

  addImageBlock(context, normalizedHeroImage);
  renderSections(context, sections);

  // udd header and footer to each page if provided
  const metaSize = 8;
  if (options.header) {
    const headerY = pageHeight - 20;
    context.pages.forEach((page) => {
      page.commands.push(
        `0.58 g BT /F2 ${metaSize} Tf ${context.left} ${headerY} Td (${pdfEscape(options.header)}) Tj ET`
      );
    });
  }

  if (options.footer) {
    const footerY = context.bottom - 12;
    context.pages.forEach((page) => {
      page.commands.push(
        `0.45 g BT /F1 ${metaSize} Tf ${context.left} ${footerY} Td (${pdfEscape(options.footer)}) Tj ET`
      );
    });
  }

  const pageObjectIds = context.pages.map((_, index) => 3 + index * 2);
  const contentObjectIds = context.pages.map((_, index) => 4 + index * 2);
  const fontRegularId = 3 + context.pages.length * 2;
  const fontBoldId = fontRegularId + 1;
  const imageObjectId = normalizedHeroImage ? fontBoldId + 1 : null;
  const xObjectPart = normalizedHeroImage && imageObjectId ? ` /XObject << /Im1 ${imageObjectId} 0 R >>` : '';

  const objects = [
    Buffer.from('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n', 'binary'),
    Buffer.from(
      `2 0 obj << /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${context.pages.length} >> endobj\n`,
      'binary'
    ),
  ];

  context.pages.forEach((page, index) => {
    const pageId = pageObjectIds[index];
    const contentId = contentObjectIds[index];

    objects.push(
      Buffer.from(
        `${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >>${xObjectPart} >> /Contents ${contentId} 0 R >> endobj\n`,
        'binary'
      )
    );

    const streamBuffer = Buffer.from(page.commands.join('\n'), 'binary');
    objects.push(
      Buffer.concat([
        Buffer.from(`${contentId} 0 obj << /Length ${streamBuffer.length} >> stream\n`, 'binary'),
        streamBuffer,
        Buffer.from('\nendstream endobj\n', 'binary'),
      ])
    );
  });

  objects.push(Buffer.from(`${fontRegularId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n`, 'binary'));
  objects.push(Buffer.from(`${fontBoldId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj\n`, 'binary'));

  if (normalizedHeroImage && imageObjectId) {
    objects.push(
      Buffer.concat([
        Buffer.from(
          `${imageObjectId} 0 obj << /Type /XObject /Subtype /Image /Width ${normalizedHeroImage.width} /Height ${normalizedHeroImage.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${normalizedHeroImage.buffer.length} >> stream\n`,
          'binary'
        ),
        normalizedHeroImage.buffer,
        Buffer.from('\nendstream endobj\n', 'binary'),
      ])
    );
  }

  const chunks = [Buffer.from('%PDF-1.4\n', 'binary')];
  const offsets = [];
  let currentOffset = chunks[0].length;

  objects.forEach((objectBuffer) => {
    offsets.push(currentOffset);
    chunks.push(objectBuffer);
    currentOffset += objectBuffer.length;
  });

  const xrefOffset = currentOffset;
  const xrefRows = [
    `xref\n0 ${objects.length + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  ];
  chunks.push(Buffer.from(xrefRows.join(''), 'binary'));

  return Buffer.concat(chunks);
}

export default buildPdfDocument;
