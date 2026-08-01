export function required(value) {
  return String(value || '').trim().length > 0;
}

export function email(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

export function minLength(value, size) {
  return String(value || '').trim().length >= size;
}

export function phoneBr(value) {
  return /^\(?\d{2}\)?\s?\d{4,5}-?\d{4}$/.test(String(value || '').trim());
}

export function validate(schema, values) {
  return Object.entries(schema).reduce((errors, [field, checks]) => {
    const failed = checks.find((check) => !check.rule(values[field], values));
    if (failed) errors[field] = failed.message;
    return errors;
  }, {});
}
