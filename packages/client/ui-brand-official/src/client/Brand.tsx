import { PRODUCT_NAME } from './locales.ts'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/** Render the canonical BharatCode mark at the host's requested size.
 * @param props - Host-supplied mark presentation.
 * @returns Orange brackets and diamond.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 512 512" role="img" aria-label={PRODUCT_NAME}>
    <title>{PRODUCT_NAME}</title>
    <g fill="none" stroke="#ff6b35" strokeWidth="54" strokeLinecap="square" strokeLinejoin="miter">
      <path d="M194 142 84 256l110 114" />
      <path d="m318 142 110 114-110 114" />
    </g>
    <path fill="#ff6b35" d="m256 221 35 35-35 35-35-35z" />
  </svg>
}

/** Render the product name separately from its slotted mark.
 * @returns The BharatCode wordmark.
 */
export function OfficialBrandName() {
  return <span style={{ fontFamily: 'var(--dsw-font-family)', fontWeight: 600, letterSpacing: '-0.025em' }}>{PRODUCT_NAME}</span>
}
