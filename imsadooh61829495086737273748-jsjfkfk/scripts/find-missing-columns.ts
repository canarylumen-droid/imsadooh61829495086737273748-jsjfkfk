
import 'dotenv/config';
import 'dotenv/config';
import { db } from '@shared/lib/db/db.js';
import { sql } from 'drizzle-orm';
import * as schema from '../shared/schema.js';
import { getTableConfig } from 'drizzle-orm/pg-core';

async function auditSchema() {
  console.log('--- Database Schema Audit ---');
  
  // Get all tables and columns from information_schema
  const res = await db.execute(sql`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public'
  `);
  
  const dbSchema: Record<string, Set<string>> = {};
  res.rows.forEach((row: any) => {
    if (!dbSchema[row.table_name]) dbSchema[row.table_name] = new Set();
    dbSchema[row.table_name].add(row.column_name);
  });

  const missingColumns: string[] = [];
  const missingTables: string[] = [];

  // Iterate over Drizzle schema definition
  for (const [key, value] of Object.entries(schema)) {
    if (value && typeof value === 'object' && 'columns' in (value as any)) {
      const table = value as any;
      let tableName = '';
      try {
        tableName = getTableConfig(table).name;
      } catch (e) {
        continue;
      }

      if (!dbSchema[tableName]) {
        missingTables.push(tableName);
        continue;
      }

      const definedColumns = Object.keys(table.columns);
      for (const colKey of definedColumns) {
        const colName = table.columns[colKey].name;
        if (!dbSchema[tableName].has(colName)) {
          missingColumns.push(`${tableName}.${colName}`);
        }
      }
    }
  }

  console.log('\n--- Results ---');
  if (missingTables.length > 0) {
    console.log('Missing Tables:', missingTables);
  } else {
    console.log('All defined tables exist.');
  }

  if (missingColumns.length > 0) {
    console.log('Missing Columns (Total: ' + missingColumns.length + '):');
    missingColumns.forEach(c => console.log(' - ' + c));
  } else {
    console.log('All columns match the schema definition.');
  }
}

auditSchema().catch(console.error);
