const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const query = async (text, params) => {
  try {
    // Build resolved SQL using single-pass regex replacement
    // This avoids issues with values containing $N patterns (e.g. bcrypt hashes)
    let resolvedSql = text;
    if (params && params.length > 0) {
      resolvedSql = text.replace(/\$(\d+)/g, (match, idx) => {
        const i = parseInt(idx, 10);
        if (i < 1 || i > params.length) return match;
        const param = params[i - 1];
        if (param === null || param === undefined) {
          return 'NULL';
        } else if (typeof param === 'boolean') {
          return String(param);
        } else if (typeof param === 'number') {
          return String(param);
        } else if (Array.isArray(param)) {
          return `ARRAY[${param.map(v => `'${String(v).replace(/'/g, "''")}'`).join(',')}]`;
        } else {
          return `'${String(param).replace(/'/g, "''")}'`;
        }
      });
    }

    // Detect if this is a SELECT/WITH or has RETURNING clause
    const trimmed = resolvedSql.trim().toUpperCase();
    const isSelect = trimmed.startsWith('SELECT') || trimmed.startsWith('WITH');
    const hasReturning = /\bRETURNING\b/.test(trimmed);

    if (isSelect || hasReturning) {
      // Use exec_sql function for queries that return data
      const { data, error } = await supabase.rpc('exec_sql', { sql_text: resolvedSql });
      if (error) throw new Error(error.message);
      const rows = data || [];
      return { rows, rowCount: rows.length };
    } else {
      // For INSERT/UPDATE/DELETE without RETURNING, execute directly
      const { error } = await supabase.rpc('exec_sql', { sql_text: resolvedSql });
      if (error) throw new Error(error.message);
      return { rows: [], rowCount: 0 };
    }
  } catch (error) {
    console.error('Query error:', error.message);
    throw error;
  }
};

module.exports = { query, supabase };
