import type { IconProps } from './icons/props.ts'

/** Brand mark colour taken from the BharatCode logo artwork. */
export const BRAND_MARK_COLOR = '#ff6b35'

/** Native viewBox of {@link FISH_LOGO_PATH} (width and height in user units). */
export const FISH_LOGO_VIEWBOX = { width: 512, height: 512 }

/**
 * The BharatCode chevrons path data (stroked, not filled), exported for
 * consumers that compose their own svg (entrance effects, masks) around the
 * same geometry. Stroke it with {@link BRAND_MARK_COLOR} at width 54 with
 * square caps and miter joins to reproduce the mark.
 */
export const FISH_LOGO_PATH = 'M194 142L84 256L194 370M318 142L428 256L318 370'

/** The centre diamond path data (filled), the accent of the BharatCode mark. */
export const FISH_LOGO_ACCENT_PATH = 'M256 221L291 256L256 291L221 256Z'

/**
 * Render the BharatCode brand mark (chevrons + centre diamond).
 * The historical export name is kept so upstream merges stay conflict-free.
 * @param props.size - width in px (default 24; the mark is square).
 * @param props.className - extra class for layout placement.
 * @returns the logo svg (aria-hidden; pair with the wordmark for accessibility).
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={(size * FISH_LOGO_VIEWBOX.height) / FISH_LOGO_VIEWBOX.width}
      className={className}
      viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`}
      fill="none"
      aria-hidden="true"
    >
      <path
        d={FISH_LOGO_PATH}
        stroke={BRAND_MARK_COLOR}
        strokeWidth={54}
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path d={FISH_LOGO_ACCENT_PATH} fill={BRAND_MARK_COLOR} />
    </svg>
  )
}
