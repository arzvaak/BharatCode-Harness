/** Credit introduction retains the action ordering selected on first entry. */
import type { ReactNode, RefObject } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DesktopOnboardingProps } from './onboarding-contract.ts'
import css from './DesktopOnboarding.module.css'

/** @param props - credit facts, localized content and recharge/navigation actions. @returns the credit step. */
export function OnboardingCreditStep({ t, heading, busy, providerSetup, onLater }:
  Pick<DesktopOnboardingProps, 't' | 'locale'> & {
    providerSetup?: ReactNode
    heading: RefObject<HTMLHeadingElement>
    busy: boolean
    funded: boolean
    canRecharge: boolean
    onContinue: () => void
    onRecharge: () => void
    onLater: () => void
  }) {
  return <div className={`${css.content} ${css.providerSetup}`}>
    <div className={css.copy}>
      <h1 id="desktop-onboarding-title" ref={heading} tabIndex={-1}>{t('onboardingCredit')}</h1>
      <p className={css.heroDescription}>{t('onboardingCreditDescription')}</p>
      {providerSetup}
      <div className={css.creditActions}>
        <Button className={css.action} variant="primary" disabled={busy} onClick={onLater}>{t('onboardingContinue')}</Button>
        <Button variant="outline" className={css.action} disabled={busy} onClick={onLater}>{t('onboardingSetUpLater')}</Button>
      </div>
    </div>
  </div>
}
