import pool from './db.js';
import {
  DEFAULT_PROCESS_WORKBOOK_PATH,
  replaceProcessCatalogFromWorkbook,
} from './services/process/processWorkbookImport.js';

const workbookPath = process.argv[2] || DEFAULT_PROCESS_WORKBOOK_PATH;

try {
  const result = await replaceProcessCatalogFromWorkbook({ workbookPath });
  console.log(`Imported workbook: ${result.workbookPath}`);
  console.log(`Root categories: ${result.rootCategoryCount}`);
  console.log(`Subcategories: ${result.subcategoryCount}`);
  console.log(`Processes: ${result.processCount}`);
} catch (error) {
  console.error('Process workbook import failed:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}

