const PYTHON_DEPENDENCY_IDS = Object.freeze(['python', 'jupyter', 'duckdb']);

/** Whether a dependency runs through the managed Python interpreter. */
export function isPythonDependency(id) {
  return PYTHON_DEPENDENCY_IDS.includes(id);
}
