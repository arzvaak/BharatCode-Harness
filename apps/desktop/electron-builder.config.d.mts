import type { AfterPackContext, BeforePackContext } from 'app-builder-lib'

/** Electron-builder fields asserted by the Desktop release tests. */
export interface DesktopElectronBuilderConfig {
  readonly productName: 'BharatCode'
  readonly electronDist: string
  readonly linux: { readonly category: 'Development'; readonly executableName: 'bharatcode'; readonly icon: string; readonly target: readonly ['AppImage', 'deb', 'rpm'] }
  readonly deb: { readonly packageName: 'bharatcode-harness'; readonly depends: readonly string[] }
  readonly rpm: { readonly packageName: 'bharatcode-harness'; readonly depends: readonly string[] }
  readonly appId: string
  readonly artifactName: string
  readonly protocols: readonly [{ readonly name: 'BharatCode'; readonly schemes: readonly ['dsh'] }]
  readonly directories: {
    readonly output: string
  }
  readonly files: readonly (string | { readonly from: string; readonly to: string; readonly filter: readonly string[] })[]
  readonly extraMetadata: { readonly productName: 'BharatCode'; readonly description: string; readonly author: { readonly name: 'BharatCode'; readonly email: string }; readonly dshDesktopAppId: string; readonly dshMandatoryUpdatePolicy: unknown }
  readonly asar: boolean
  readonly asarUnpack: readonly string[]
  readonly extraResources: readonly { readonly from: string; readonly to: string }[]
  readonly mac: {
    readonly extendInfo: { readonly NSMicrophoneUsageDescription: string }
    readonly entitlements: string
    readonly entitlementsInherit: string
    readonly identity: string | undefined
    readonly forceCodeSigning: boolean
    readonly notarize: boolean
    readonly signIgnore: readonly string[]
  }
  readonly dmg: {
    readonly sign: boolean
    readonly writeUpdateInfo: boolean
  }
  readonly win: {
    readonly executableName: 'BharatCode'
    readonly forceCodeSigning: boolean
    readonly signtoolOptions: {
      readonly publisherName: string | undefined
      readonly sign: ((configuration: { path: string, hash: string, isNest: boolean }) => Promise<void>) | undefined
      readonly signingHashAlgorithms: readonly string[]
    }
  }
  readonly nsis: {
    readonly shortcutName: 'BharatCode'
    readonly uninstallDisplayName: string
    readonly include: string
    readonly oneClick: false
    readonly perMachine: false
    readonly allowElevation: false
    readonly allowToChangeInstallationDirectory: false
    readonly installerLanguages: readonly ['en_US', 'zh_CN']
  }
  readonly beforeBuild: () => Promise<boolean>
  readonly beforePack: (context: BeforePackContext) => Promise<void>
  readonly afterPack: (context: AfterPackContext) => Promise<void>
  readonly afterSign: (context: AfterPackContext) => Promise<void>
  readonly artifactBuildCompleted: (artifact: { readonly file: string }) => Promise<void> | undefined
  readonly publish: readonly [{ readonly provider: 'generic', readonly url: string } | { readonly provider: 'github', readonly owner: string, readonly repo: string, readonly channel: string, readonly releaseType: string }] | null
}

/**
 * Create electron-builder configuration from one release environment.
 * @param env - Packaging environment.
 * @param hostPlatform - Build-host platform used when no explicit target is present.
 * @param hostArch - Build-host architecture used when no explicit target is present.
 * @param preparedRuntime - Verified private qualification runtime; ordinary releases use target-owned resources.
 * @param preparedRuntimeVersion - Version that private runtime declares, which qualification rewrites away from the product version.
 * @returns electron-builder configuration.
 */
export function createElectronBuilderConfig(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: NodeJS.Platform,
  hostArch?: string,
  preparedRuntime?: string,
  preparedRuntimeVersion?: string,
): DesktopElectronBuilderConfig

declare const electronBuilderConfig: DesktopElectronBuilderConfig

export default electronBuilderConfig
