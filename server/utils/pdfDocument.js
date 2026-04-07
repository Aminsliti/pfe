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

function normalizeHeroImage(heroImage) {
  const decoded = decodeDataUrl(heroImage?.dataUrl || heroImage?.imageDataUrl || '');
  if (!decoded || !['image/jpeg', 'image/jpg'].includes(decoded.mimeType)) {
    return null;
  }

  const dimensions = readJpegDimensions(decoded.buffer);
  if (!dimensions?.width || !dimensions?.height) {
    return null;
  }

  const maxWidth = 500;
  const maxHeight = 220;
  const scale = Math.min(maxWidth / dimensions.width, maxHeight / dimensions.height, 1);

  return {
    ...dimensions,
    buffer: decoded.buffer,
    displayWidth: Math.round(dimensions.width * scale),
    displayHeight: Math.round(dimensions.height * scale),
  };
}

function buildLayoutItems({ title = '', subtitle = '', sections = [] }) {
  const items = [];

  if (title) {
    items.push({ text: title, font: 'F2', size: 18, gapAfter: 10 });
  }
  if (subtitle) {
    items.push({ text: subtitle, font: 'F1', size: 11, gapAfter: 16 });
  }

  sections.forEach((section) => {
    if (section.title) {
      items.push({ text: section.title, font: 'F2', size: 13, gapBefore: 8, gapAfter: 6 });
    }

    (section.paragraphs || []).forEach((paragraph) => {
      wrapLine(paragraph, 92).forEach((line) => {
        items.push({ text: line, font: 'F1', size: 10.5 });
      });
      items.push({ text: '', font: 'F1', size: 10.5, gapAfter: 4 });
    });

    (section.bullets || []).forEach((bullet) => {
      const wrapped = wrapLine(`- ${bullet}`, 88);
      wrapped.forEach((line, index) => {
        items.push({
          text: index === 0 ? line : `  ${line}`,
          font: 'F1',
          size: 10.5,
        });
      });
    });

    items.push({ text: '', font: 'F1', size: 10.5, gapAfter: 6 });
  });

  return items;
}

export function buildPdfDocument({ title = '', subtitle = '', sections = [], heroImage = null }) {
  const pageWidth = 595;
  const pageHeight = 842;
  const top = 800;
  const left = 42;
  const bottom = 50;
  const normalizedHeroImage = normalizeHeroImage(heroImage);
  const firstPageTop = normalizedHeroImage ? top - normalizedHeroImage.displayHeight - 24 : top;

  const items = buildLayoutItems({ title, subtitle, sections });
  const pages = [];
  let currentPage = [];
  let y = firstPageTop;
  let pageIndex = 0;

  items.forEach((item) => {
    const gapBefore = item.gapBefore || 0;
    const gapAfter = item.gapAfter || 0;
    const lineHeight = Math.max(14, Math.round((item.size || 11) * 1.45));
    y -= gapBefore;

    if (y - lineHeight < bottom) {
      pages.push(currentPage);
      currentPage = [];
      pageIndex += 1;
      y = top;
    }

    currentPage.push({
      ...item,
      y,
    });
    y -= lineHeight + gapAfter;
  });

  if (currentPage.length) {
    pages.push(currentPage);
  }

  if (!pages.length) {
    pages.push([]);
  }

  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  const contentObjectIds = pages.map((_, index) => 4 + index * 2);
  const fontRegularId = 3 + pages.length * 2;
  const fontBoldId = fontRegularId + 1;
  const imageObjectId = normalizedHeroImage ? fontBoldId + 1 : null;

  const objects = [
    Buffer.from('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n', 'binary'),
    Buffer.from(
      `2 0 obj << /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >> endobj\n`,
      'binary'
    ),
  ];

  pages.forEach((pageLines, currentPageIndex) => {
    const pageId = pageObjectIds[currentPageIndex];
    const contentId = contentObjectIds[currentPageIndex];
    const xObjectPart =
      normalizedHeroImage && currentPageIndex === 0
        ? ` /XObject << /Im1 ${imageObjectId} 0 R >>`
        : '';

    objects.push(
      Buffer.from(
        `${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >>${xObjectPart} >> /Contents ${contentId} 0 R >> endobj\n`,
        'binary'
      )
    );

    const commands = [];
    if (normalizedHeroImage && currentPageIndex === 0) {
      const imageY = top - normalizedHeroImage.displayHeight;
      commands.push(
        `q ${normalizedHeroImage.displayWidth} 0 0 ${normalizedHeroImage.displayHeight} ${left} ${imageY} cm /Im1 Do Q`
      );
    }

    pageLines.forEach((line) => {
      commands.push(
        `BT /${line.font || 'F1'} ${line.size || 11} Tf ${left} ${line.y} Td (${pdfEscape(line.text || '')}) Tj ET`
      );
    });

    const streamBuffer = Buffer.from(commands.join('\n'), 'binary');
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
