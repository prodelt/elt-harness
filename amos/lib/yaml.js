// Minimal dependency-free YAML serializer for flat handoff objects:
// string/number/boolean scalars and arrays of scalars only.

function yamlScalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const str = String(value);
  const needsQuoting =
    str === '' ||
    /^\s|\s$/.test(str) ||
    /[:#\[\]{}",\n&*!|>'%@`]/.test(str) ||
    /^[-?](\s|$)/.test(str);
  return needsQuoting ? JSON.stringify(str) : str;
}

function toYaml(obj) {
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${yamlScalar(item)}`);
        }
      }
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  return lines.join('\n') + '\n';
}

module.exports = { toYaml, yamlScalar };
