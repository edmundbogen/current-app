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

    // Detect if this is a SELECT or RETURNING query
    const trimmed = resolvedSql.trim().toUpperCase();
    const isSelect = trimmed.startsWith('SELECT');
    const hasReturning = trimmed.includes('RETURNING');

    if (isSelect || hasReturning) {
      // Use exec_sql function for queries that return data
      const { data, error } = await supabase.rpc('exec_sql', { sql_text: resolvedSql });
      if (error) throw new Error(error.message);
      const rows = data || [];
      return { rows, rowCount: rows.length };
    } else {
      // For INSERT/UPDATE/DELETE without RETURNING, use exec_sql wrapped
      // Wrap in a CTE that returns affected count
      const wrappedSql = `WITH result AS (${resolvedSql}) SELECT count(*) as affected FROM result`;
      try {
        const { data, error } = await supabase.rpc('exec_sql', { sql_text: wrappedSql });
        if (error) {
          // If CTE wrapping fails, just execute directly and return empty
          const { error: error2 } = await supabase.rpc('exec_sql', { sql_text: `SELECT 1 FROM (${resolvedSql}) x LIMIT 0` });
          if (error2) {
            // Last resort: execute via a DO block approach
            await supabase.rpc('exec_sql', { sql_text: resolvedSql });
          }
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: data?.[0]?.affected || 0 };
      } catch {
        return { rows: [], rowCount: 0 };
      }
    }
  } catch (error) {
    console.error('Query error:', error.message);
    throw error;
  }
};

module.exports = { query, supabase };
