/**
 * Отчёт сборщика набора: нарушение роняет сборку с кодом 1, предупреждение — пункт списка работ
 * по каталогу, сборку оно не останавливает.
 */
export function createReport() {
  const violations = []
  const warnings = []
  return {
    violations,
    warnings,
    violation(message) {
      violations.push(message)
    },
    warning(message) {
      warnings.push(message)
    },
  }
}

/** Печатает отчёт в stderr и возвращает код выхода. */
export function printReport(report, stream = process.stderr) {
  if (report.warnings.length > 0) {
    stream.write(`Предупреждения (${report.warnings.length}):\n`)
    for (const message of report.warnings) stream.write(`  - ${message}\n`)
  }
  if (report.violations.length > 0) {
    stream.write(`НАРУШЕНИЯ (${report.violations.length}):\n`)
    for (const message of report.violations) stream.write(`  - ${message}\n`)
    return 1
  }
  return 0
}
