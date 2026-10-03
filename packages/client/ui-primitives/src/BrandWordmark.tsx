import type { IconProps } from './icons/props.ts'
import { BRAND_MARK_COLOR, FISH_LOGO_ACCENT_PATH, FISH_LOGO_PATH } from './FishLogo.tsx'

/** Display options for the official brand wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading BharatCode mark; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the full brand wordmark (mark + name artwork).
 * The name rides SVG text so the geometry stays font-locked via `textLength`
 * while the glyphs come from the brand font (Montserrat) where it is available.
 * @param props.size - height in px (default 24; width follows the selected artwork).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the leading BharatCode mark.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  const width = includeMark ? 182 : 156
  return (
    <svg
      width={(size * width) / 24}
      height={size}
      className={className}
      viewBox={includeMark ? '0 0 182 24' : '26 0 156 24'}
      fill="none"
      aria-hidden="true"
    >
      {includeMark && (
        <g transform="scale(0.046875)">
          <path
            d={FISH_LOGO_PATH}
            stroke={BRAND_MARK_COLOR}
            strokeWidth={54}
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
          <path d={FISH_LOGO_ACCENT_PATH} fill={BRAND_MARK_COLOR} />
        </g>
      )}
      <text
        x={30}
        y={17.2}
        textLength={150}
        lengthAdjust="spacingAndGlyphs"
        fontFamily="Montserrat, 'DejaVu Sans', 'Liberation Sans', Arial, sans-serif"
        fontSize={15}
        fontWeight={600}
        fill="currentColor"
      >
        BharatCode Harness
      </text>
    </svg>
  )
}
