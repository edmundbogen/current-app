const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const query = async (text, params) => {
  try {
    // Replace $1, $2, etc. with actual parameter values
    let resolvedSql = text;
    if (params && params.length > 0) {
      // Replace from highest index first to avoid $1 replacing part of $10
      for (let i = params.length; i >= 1; i--) {
        const param = params[i - 1];
        const placeholder = `$${i}`;
        let value;
        if (param === null || param === undefined) {
          value = 'NULL';
        } else if (typeof param === 'boolean') {
          value = String(param);
        } else if (typeof param === 'number') {
          value = String(param);
        } else if (Array.isArray(param)) {
          value = `ARRAY[${param.map(v => `'${String(v).replace(/'/g, "''")}'`).join(',')}]`;
        } else {
          value = `'${String(param).replace(/'/g, "''")}'`;
        }
        resolvedSql = resolvedSql.split(placeholder).join(value);
      }
    }

    // Detect if this is a SELECT or has RETURNING clause
    const trimmed = resolvedSql.trim().toUpperCase();
    const isSelect = trimmed.startsWith('SELECT') || trimmed.startsWith('WITH');
    const hasReturning = trimmed.includes('RETURNING');

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
