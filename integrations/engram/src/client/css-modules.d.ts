/** Class-name mapping type for CSS Modules (real hashed class names are generated at build time by lightningcss). */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
