# Contributing to BharatCode Harness

English | [中文](CONTRIBUTING.zh.md)

Report reproducible bugs and discuss changes in [BharatCode issues](https://github.com/arzvaak/BharatCode-Harness/issues). Include the app version, operating system, expected result and steps to reproduce. Remove credentials and personal information from logs before posting.

## Preparing a change

Use the [development guide](docs/development.md) to set up the checkout. Keep changes focused, preserve existing user data, and update the relevant English and Chinese documentation together. The [developer guide](DEVELOPER_GUIDE.md) describes repository conventions; [architecture](docs/architecture.md) explains the implementation.

## Checking your work

Run the checks that cover the change locally. Documentation uses `pnpm run doc-sync`; code changes may require build, typecheck, lint and targeted tests. Linux publication requires the complete local release checks and matching artifact hashes. Do not enable app build/test Actions; the public Pages workflow only deploys locally prepared content.

## Licence

Contributions are distributed under the project's [MIT licence](LICENSE). Keep upstream attribution and third-party licence notices with adapted code.
