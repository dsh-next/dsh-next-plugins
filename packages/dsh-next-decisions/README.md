# Decision models for DeepSeek Harness

English | [中文](README.zh.md)

Configure models that choose between supplied options—such as routing a request to billing or technical support—separately from chat models.

## Install

**Private and unreleased.** Requires DeepSeek Harness `0.1.7-rc.1` or newer. Once published, install with:

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-decisions
```

Replace `<name>` with your DSH profile, for example `web`. Editing requires the local Web GUI and permission to save that profile's settings.

## Quick start

Have a TypeSafe API key and an exact model ID from your provider ready.

1. Open `Settings` → `Models` → `Decision models`.
2. Choose `Add decision model provider` → `TypeSafe`, then enter your API key.
3. Under `Models`, enter the model ID and choose `Save`. A provider card appears; saving does not contact the provider.
4. To check the connection, open `Models and test` and choose `Model to test`. **`Test decision` sends a sample to the provider and may incur charges.** Select it to view the response; success checks the connection and response format, not decision accuracy.

## What you can do

- **Keep decision models separate:** they do not appear in the chat model picker.
- **Manage providers:** edit model IDs and names, or remove a provider and its saved key.
- **Use a custom endpoint:** choose `Custom decision API` for a System One-compatible service, not an ordinary chat API.

![Decision provider cards in Models settings](<media/provider-cards.webp>)

## Good to know

- This plugin supplies a decision service for other plugins. It does not add a chat tool, run actions, or connect to Squads by itself.
- Model IDs are entered manually. There is no automatic discovery or local-model installer.
- Keys use Harness's credential store. A saved key does not prove that it works.
- Only text/JSON input and choice questions are supported. Cancelling a test cannot guarantee the provider stops processing or avoids charging you.

[Provider settings and developer interface](<https://github.com/dsh-next/dsh-next-plugins/blob/main/docs/decisions.md>) · [Get help](<https://github.com/dsh-next/dsh-next-plugins/issues>) · [Contributing](<https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md>)
