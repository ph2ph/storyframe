export interface IReport {
  violations: string[]
  warnings: string[]
  violation(message: string): void
  warning(message: string): void
}

/**
 * Report of the component set builder: a violation fails the build with exit code 1, a warning is an item on
 * the catalog's to-do list and does not stop the build.
 */
export function createReport(): IReport {
  const violations: string[] = []
  const warnings: string[] = []
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

/** Prints the report to stderr and returns the exit code. */
export function printReport(report: IReport, stream: NodeJS.WritableStream = process.stderr): number {
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
