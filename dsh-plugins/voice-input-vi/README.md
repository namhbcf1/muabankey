# Vietnamese voice input

Adds a Vietnamese speech recognizer to the composer microphone that DSH already
ships. Speak Vietnamese, and the text lands in the message box.

## What it does

The microphone button next to the composer comes from `@deepseek-ai/dsh-experimental-voice-input-bundle`.
Its bundled recognizer (SenseVoice) understands Chinese, English, Cantonese,
Japanese and Korean — not Vietnamese. This bundle registers one additional
recognizer with the Host `speechToText` registry, so the microphone's provider
list gains "Tiếng Việt (Zipformer)" with the `vi` language.

Recognition runs locally through the `sherpa-onnx` runtime DSH already ships.
No audio leaves the machine.

## Model

`sherpa-onnx-zipformer-vi-30M-int8` (csukuangfj2), pinned by SHA-256:

| file | bytes | sha256 |
|---|---|---|
| encoder.int8.onnx | 27699063 | `8ef5286dd427eb108055c2ddc1982aa31e544706072d5ea228729292dacade68` |
| decoder.onnx | 5165084 | `cf2aa385b82c9d5d40cd29c3188af52d0249b3b78f0d4b7eb84ad502d50c7e7f` |
| joiner.int8.onnx | 1033417 | `7311d2e17b810ecea515d79c71cc4668af8759256a06fa01d27047772320c821` |
| tokens.txt | 23238 | `ca8171f8bbd516c050b627582f2125c8f5f1f6ed967ab41b0fa9aae2cf61b492` |

Total ~33 MB, downloaded on first use into the configured data root and verified
before the recognizer is used.

Measured on this machine (Ryzen 7 4800H): 0.13 s per 6.5 s of speech, 100%
character accuracy on five Vietnamese test sentences.

## Usage

1. Open a conversation so the composer is visible.
2. Click the microphone in the composer tool row.
3. Speak Vietnamese, then click the microphone again to stop.
4. The transcript is inserted at the cursor of your draft; edit it if needed and send.

The recognizer is selected by default, so the microphone dictates Vietnamese
right away. Switching back to another recognizer, or changing language, is done
in the plugin's page under Settings → Plugins.

## Configuration

| key | default | meaning |
|---|---|---|
| `dataRoot` | `<dshHome>/speech-to-text/zipformer-vi` | Where model files are stored |
| `modelOrigin` | `https://huggingface.co` | Download origin; the mirror is tried if it fails |
| `providerId` | `zipformer-vi-local` | Recognizer id in the provider list |
| `numThreads` | `4` | Native decode threads |
| `inferenceTimeoutMs` | `120000` | Deadline for one recording |
| `idleTimeoutMs` | `300000` | Unload the model after this idle period |

All settings are read from the plugin row in `cordis.patch.yml`, so your values
survive upgrades.
