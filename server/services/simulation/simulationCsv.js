function parseTimeOnlyToMinutes(value) {
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);

  if (hours > 23 || minutes > 59 || seconds > 59) {
    return null;
  }

  return hours * 60 + minutes + seconds / 60;
}

function normalizeColumnName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
}

function parseCsvRows(csvText) {
  return String(csvText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(',').map((cell) => cell.trim()));
}

function detectArrivalColumn(headerRow = []) {
  const normalized = headerRow.map(normalizeColumnName);
  const preferredColumns = [
    'arrival_time',
    'arrival_at',
    'arrival_datetime',
    'arrival_date',
    'offset_minutes',
    'minutes',
    'minute',
    'time',
    'timestamp',
  ];

  for (const preferred of preferredColumns) {
    const index = normalized.indexOf(preferred);
    if (index >= 0) {
      return index;
    }
  }

  return 0;
}

function parseArrivalValue(value, baseDate) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const raw = String(value).trim();
  const numericValue = Number(raw);
  if (Number.isFinite(numericValue)) {
    return {
      rawValue: raw,
      arrivalAt: null,
      arrivalOffsetMin: numericValue,
    };
  }

  const timeOnlyMinutes = parseTimeOnlyToMinutes(raw);
  if (timeOnlyMinutes !== null) {
    return {
      rawValue: raw,
      arrivalAt: null,
      arrivalOffsetMin: baseDate === null ? timeOnlyMinutes : timeOnlyMinutes - baseDate,
    };
  }

  const parsedDate = new Date(raw);
  if (!Number.isNaN(parsedDate.getTime())) {
    return {
      rawValue: raw,
      arrivalAt: parsedDate.toISOString(),
      arrivalOffsetMin:
        baseDate === null ? 0 : (parsedDate.getTime() - baseDate) / (1000 * 60),
    };
  }

  return null;
}

export function parseArrivalCsv(csvText) {
  const rows = parseCsvRows(csvText);
  if (!rows.length) {
    throw new Error('The CSV file is empty.');
  }

  const headerLooksNamed = rows[0].some((cell) => /[A-Za-z]/.test(cell));
  const dataRows = headerLooksNamed ? rows.slice(1) : rows;
  const arrivalColumn = headerLooksNamed ? detectArrivalColumn(rows[0]) : 0;

  if (!dataRows.length) {
    throw new Error('The CSV file does not contain any arrival rows.');
  }

  const firstCell = dataRows[0]?.[arrivalColumn];
  const firstNumeric = Number(firstCell);
  const firstTimeOnly = parseTimeOnlyToMinutes(firstCell);
  const firstDate =
    Number.isFinite(firstNumeric)
      ? null
      : firstTimeOnly !== null
        ? firstTimeOnly
        : new Date(firstCell);
  const baseDate =
    firstDate && firstDate instanceof Date && !Number.isNaN(firstDate.getTime())
      ? firstDate.getTime()
      : firstTimeOnly !== null
        ? firstTimeOnly
        : null;

  const arrivals = dataRows.map((row, index) => {
    const parsed = parseArrivalValue(row[arrivalColumn], baseDate);
    if (!parsed) {
      throw new Error(`Invalid arrival value on CSV row ${index + 2}.`);
    }

    return {
      arrivalOrder: index + 1,
      rawValue: parsed.rawValue,
      arrivalAt: parsed.arrivalAt,
      arrivalOffsetMin: Number(parsed.arrivalOffsetMin) || 0,
    };
  });

  return arrivals.sort((left, right) => left.arrivalOffsetMin - right.arrivalOffsetMin);
}

export default parseArrivalCsv;
