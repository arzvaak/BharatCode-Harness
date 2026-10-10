# BharatCode Harness

English | [中文](README.zh.md)

![BharatCode Harness — a desktop for chat, coding, research and writing](integrations/extension-store/site/assets/readme-cover.svg)

BharatCode Harness brings conversations, project files and useful tools into one desktop. Start a quick chat, work in a coding workspace, gather research or shape a draft. Choose your provider when you are ready; setup is optional.

[Explore BharatCode](https://arzvaak.github.io/BharatCode-Harness/) · [Download for Linux](https://github.com/arzvaak/BharatCode-Harness/releases) · [Report an issue](https://github.com/arzvaak/BharatCode-Harness/issues)

## What you can do

- **Chat without a workspace.** Each independent chat has its own folder under the general chats directory. Open a chat inside a workspace to keep its files and conversations together.
- **Code, research and write.** Switch workflows, inspect project files, preview documents and keep the conversation beside your work.
- **Bring your provider.** Use BharatCode, supported subscription connections or an API provider. You can skip setup and return to it in Settings.
- **Extend your workspace.** Discover extensions and skills from the sidebar. Requirements and availability are shown before installation; optional integrations may need their own account or local software.
- **Keep control of updates.** Check GitHub releases inside the app, download an update and confirm when to restart.

## Install on Linux

The current preview supports Linux x64. Choose an installer from the [release page](https://github.com/arzvaak/BharatCode-Harness/releases).

| Download | Use it on | Installation |
| --- | --- | --- |
| `.rpm` | Fedora and compatible RPM desktops | Install the downloaded file with `sudo dnf install ./<filename>.rpm`. |
| `.deb` | Debian, Ubuntu and compatible desktops | Install the downloaded file with `sudo apt install ./<filename>.deb`. |
| `.AppImage` | Linux desktops with FUSE support | Run `chmod +x ./<filename>.AppImage`, then open the file. |

Replace `<filename>` with the downloaded package name. Releases include checksums and a local qualification receipt. Native package updates may request system authorization. Older builds that only offered manual downloads need a current installer once before future in-app updates.

This is a preview: Windows and ARM64 are not qualified by the current Linux release, and account-dependent provider authentication and inference are not part of its completed acceptance checks. Review [SAFETY.md](SAFETY.md) before running untrusted workloads.

## Build from source

Install Node.js 22.19+ (22.x) or 24 and newer and pnpm, then:

```sh
git clone https://github.com/arzvaak/BharatCode-Harness.git
cd BharatCode-Harness
pnpm install --frozen-lockfile
pnpm run build
pnpm dsh web
```

The last command opens the web interface at `http://127.0.0.1:3080`. For desktop development and Linux packaging, use the [desktop guide](apps/desktop/README.md). The internal `dsh` command and package identifiers are retained for compatibility.

## Documentation and contributions

Start with the [user guide](docs/user/guide/index.md), [development guide](docs/development.md) or [architecture](docs/architecture.md). See [CONTRIBUTING.md](CONTRIBUTING.md) for reporting issues and preparing changes. App build and test checks run locally; the public Pages workflow only deploys prebuilt website content.

## Licence

BharatCode Harness is distributed under the [MIT licence](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for dependency licences.

## Origins

Adapted and forked from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), originally developed by DeepSeek AI. Its plugin architecture uses [Cordis](https://github.com/cordiverse/cordis). Upstream copyright and licence notices are preserved.
