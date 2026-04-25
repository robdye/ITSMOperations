/**
 * ServiceNow Encoded Query Builder
 * Type-safe query construction that prevents injection attacks.
 * Replaces the regex-based sanitizeSnowValue() approach.
 */

// Allowed operators in ServiceNow encoded queries
type SnowOperator = '=' | '!=' | '<' | '>' | '<=' | '>=' | 'LIKE' | 'STARTSWITH' | 'ENDSWITH' | 'IN' | 'NOT IN' | 'ISEMPTY' | 'ISNOTEMPTY' | 'BETWEEN';

interface SnowCondition {
  field: string;
  operator: SnowOperator;
  value: string | string[];
}

interface SnowOrderBy {
  field: string;
  direction: 'ASC' | 'DESC';
}

export class SnowQuery {
  private conditions: SnowCondition[] = [];
  private orderByFields: SnowOrderBy[] = [];
  private joinOperator: '^' | '^OR' = '^'; // AND by default

  // ── Factory methods ──

  static eq(field: string, value: string): SnowQuery {
    return new SnowQuery().and().eq(field, value);
  }

  static ne(field: string, value: string): SnowQuery {
    return new SnowQuery().and().ne(field, value);
  }

  // ── Instance methods ──

  eq(field: string, value: string): SnowQuery {
    this.conditions.push({ field: sanitizeField(field), operator: '=', value: sanitizeValue(value) });
    return this;
  }

  ne(field: string, value: string): SnowQuery {
    this.conditions.push({ field: sanitizeField(field), operator: '!=', value: sanitizeValue(value) });
    return this;
  }

  lt(field: string, value: string): SnowQuery {
    this.conditions.push({ field: sanitizeField(field), operator: '<', value: sanitizeValue(value) });
    return this;
  }

  gt(field: string, value: string): SnowQuery {
    this.conditions.push({ field: sanitizeField(field), operator: '>', value: sanitizeValue(value) });
    return this;
  }

  lte(field: string, value: string): SnowQuery {
    this.conditions.push({ field: sanitizeField(field), operator: '<=', value: sanitizeValue(value) });
    return this;
  }

  gte(field: string, value: string): SnowQuery {
    this.conditions.push({ field: sanitizeField(field), operator: '>=', value: sanitizeValue(value) });
    return this;
  }

  like(field: string, value: string): SnowQuery {
    this.conditions.push({ field: sanitizeField(field), operator: 'LIKE', value: sanitizeValue(value) });
    return this;
  }

  startsWith(field: string, value: string): SnowQuery {
    this.conditions.push({ field: sanitizeField(field), operator: 'STARTSWITH', value: sanitizeValue(value) });
    return this;
  }

  endsWith(field: string, value: string): SnowQuery {
    this.conditions.push({ field: sanitizeField(field), operator: 'ENDSWITH', value: sanitizeValue(value) });
    return this;
  }

  in(field: string, values: string[]): SnowQuery {
    this.conditions.push({
      field: sanitizeField(field),
      operator: 'IN',
      value: values.map(sanitizeValue),
    });
    return this;
  }

  notIn(field: string, values: string[]): SnowQuery {
    this.conditions.push({
      field: sanitizeField(field),
      operator: 'NOT IN',
      value: values.map(sanitizeValue),
    });
    return this;
  }

  isEmpty(field: string): SnowQuery {
    this.conditions.push({ field: sanitizeField(field), operator: 'ISEMPTY', value: '' });
    return this;
  }

  isNotEmpty(field: string): SnowQuery {
    this.conditions.push({ field: sanitizeField(field), operator: 'ISNOTEMPTY', value: '' });
    return this;
  }

  orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): SnowQuery {
    this.orderByFields.push({ field: sanitizeField(field), direction });
    return this;
  }

  orderByDesc(field: string): SnowQuery {
    return this.orderBy(field, 'DESC');
  }

  and(): SnowQuery {
    this.joinOperator = '^';
    return this;
  }

  or(): SnowQuery {
    this.joinOperator = '^OR';
    return this;
  }

  /** Build the encoded query string for ServiceNow sysparm_query */
  build(): string {
    const parts: string[] = [];

    for (let i = 0; i < this.conditions.length; i++) {
      const c = this.conditions[i];

      // Add join operator between conditions (not before the first one)
      if (i > 0) {
        parts.push(this.joinOperator);
      }

      if (c.operator === 'ISEMPTY' || c.operator === 'ISNOTEMPTY') {
        parts.push(`${c.field}${c.operator}`);
      } else if (c.operator === 'IN' || c.operator === 'NOT IN') {
        const values = Array.isArray(c.value) ? c.value.join(',') : c.value;
        parts.push(`${c.field}${c.operator}${values}`);
      } else {
        parts.push(`${c.field}${c.operator}${c.value}`);
      }
    }

    // Add ORDER BY
    for (const ob of this.orderByFields) {
      if (parts.length > 0) parts.push('^');
      if (ob.direction === 'DESC') {
        parts.push(`ORDERBYDESC${ob.field}`);
      } else {
        parts.push(`ORDERBY${ob.field}`);
      }
    }

    return parts.join('');
  }

  toString(): string {
    return this.build();
  }
}

// ── Sanitization ──

/**
 * Sanitize a field name. Only allow alphanumeric, underscores, and dots (for related fields).
 * This prevents field name injection.
 */
function sanitizeField(field: string): string {
  const clean = field.replace(/[^a-zA-Z0-9_.]/g, '');
  if (clean.length === 0) throw new Error(`Invalid ServiceNow field name: "${field}"`);
  if (clean.length > 80) throw new Error(`Field name too long: "${field}"`);
  return clean;
}

/**
 * Sanitize a value for use in ServiceNow encoded queries.
 * Escapes the ^ character (ServiceNow's AND separator) to prevent query injection.
 * Unlike the old regex approach, this preserves legitimate characters like = < > in values.
 */
function sanitizeValue(value: string): string {
  if (typeof value !== 'string') return String(value);
  // The ^ character is ServiceNow's query separator — must be escaped/removed from values
  // Also remove newlines which could break the query
  return value.replace(/[\^]/g, '').replace(/[\r\n]/g, ' ').trim();
}

// Re-export for backward compatibility during migration
export { sanitizeValue as sanitizeSnowValue };
