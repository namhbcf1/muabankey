import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { isAbsolute, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'

/**
 * Resolve a dependency as this bundle would, then as the DSH installation does.
 * A plugin installed as a linked workspace directory does not sit under any
 * node_modules, so the runtime packages it shares with the Host
 * (sherpa-onnx-node, schemastery) are only reachable from there.
 * @param specifier - bare package name.
 * @returns the loaded module.
 */
function loadShared(specifier) {
  const bases = [import.meta.url]
  const resources = process.resourcesPath
  if (typeof resources === 'string' && resources !== '') {
    bases.push(join(resources, 'app.asar', 'dsh', 'node_modules', 'noop.js'))
  }
  let lastError
  for (const base of bases) {
    try {
      return createRequire(base)(specifier)
    } catch (error) {
      lastError = error
    }
  }
  const error = new Error(`Cannot load ${specifier} from this bundle or the DSH installation`)
  error.cause = lastError
  throw error
}

const z = (() => {
  const loaded = loadShared('@deepseek-ai/schemastery')
  return typeof loaded === 'function' ? loaded : loaded.default
})()

/** Language hints this recognizer accepts; the model is Vietnamese-only. */
const LANGUAGES = ['vi', 'auto']

/**
 * Pinned model files. Sizes and digests were read from the Hugging Face tree
 * API and verified locally; a download is only accepted when both match.
 */
const MODEL_FILES = [
  {
    name: 'encoder.int8.onnx',
    size: 27699063,
    sha256: '8ef5286dd427eb108055c2ddc1982aa31e544706072d5ea228729292dacade68',
  },
  {
    name: 'decoder.onnx',
    size: 5165084,
    sha256: 'cf2aa385b82c9d5d40cd29c3188af52d0249b3b78f0d4b7eb84ad502d50c7e7f',
  },
  {
    name: 'joiner.int8.onnx',
    size: 1033417,
    sha256: '7311d2e17b810ecea515d79c71cc4668af8759256a06fa01d27047772320c821',
  },
  {
    name: 'tokens.txt',
    size: 23238,
    sha256: 'ca8171f8bbd516c050b627582f2125c8f5f1f6ed967ab41b0fa9aae2cf61b492',
  },
]

const DEFAULT_REPO = 'csukuangfj2/sherpa-onnx-zipformer-vi-30M-int8-2026-02-09'

/** A recording rejected before the recognizer runs; the loaded model stays reusable. */
class SpeechInputError extends Error {}

/**
 * Read the PCM payload of a RIFF/WAVE file without relying on the addon helper,
 * which allocates external buffers that Electron refuses.
 * @param bytes - complete WAV file.
 * @returns 16 kHz mono float samples and the declared sample rate.
 */
function decodeWave(bytes) {
  if (bytes.length < 44) throw new SpeechInputError('Audio is not a valid WAV file')
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new SpeechInputError('Audio is not a valid WAV file')
  }
  let offset = 12
  let sampleRate = 0
  let channels = 1
  let bits = 16
  let format = 1
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      format = bytes.readUInt16LE(body)
      channels = bytes.readUInt16LE(body + 2)
      sampleRate = bytes.readUInt32LE(body + 4)
      bits = bytes.readUInt16LE(body + 14)
    } else if (id === 'data') {
      if (format !== 1 || bits !== 16 || channels !== 1) {
        throw new SpeechInputError('Audio must be 16 kHz mono PCM16')
      }
      const end = Math.min(body + size, bytes.length)
      const count = (end - body) >> 1
      const samples = new Float32Array(count)
      for (let index = 0; index < count; index += 1) {
        samples[index] = bytes.readInt16LE(body + index * 2) / 32768
      }
      return { samples, sampleRate }
    }
    offset = body + size + (size % 2)
  }
  throw new SpeechInputError('Audio contains no data chunk')
}

/** One in-flight download of a single pinned file. */
async function downloadFile(url, destination, expected, signal, onProgress) {
  const response = await fetch(url, { signal, redirect: 'follow' })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${expected.name}`)
  if (response.body === null) throw new Error(`Empty response for ${expected.name}`)
  const staging = `${destination}.${randomUUID()}.part`
  const hash = createHash('sha256')
  let written = 0
  try {
    const sink = createWriteStream(staging)
    await pipeline(
      response.body,
      async function* (source) {
        for await (const chunk of source) {
          hash.update(chunk)
          written += chunk.length
          if (written > expected.size) throw new Error(`${expected.name} is larger than pinned`)
          onProgress(written, expected.size)
          yield chunk
        }
      },
      sink,
    )
    if (written !== expected.size) {
      throw new Error(`${expected.name} has ${written} bytes, expected ${expected.size}`)
    }
    const digest = hash.digest('hex')
    if (digest !== expected.sha256) {
      throw new Error(`${expected.name} failed its integrity check`)
    }
    await rename(staging, destination)
  } catch (error) {
    await unlink(staging).catch(() => {})
    throw error
  }
}

/**
 * Load the sherpa-onnx runtime that DSH already installs.
 * @returns the module namespace.
 */
function loadSherpa() {
  const sherpa = loadShared('sherpa-onnx-node')
  if (typeof sherpa.OfflineRecognizer !== 'function') {
    throw new Error('The installed sherpa-onnx runtime exposes no offline recognizer')
  }
  return sherpa
}

/** Own one recognizer across recordings: preparation, decode, and idle unload. */
class ZipformerVietnamese {
  #ctx
  #config
  #recognizer
  #loading
  #idleTimer
  #lifetime = new AbortController()
  #state = { phase: 'unprepared' }
  #listeners = new Set()

  constructor(ctx, config) {
    this.#ctx = ctx
    this.#config = config
  }

  /** @returns the current preparation state. */
  snapshot() {
    return this.#state
  }

  /**
   * Observe preparation state changes.
   * @param listener - called after each publication.
   * @returns disposer.
   */
  subscribe(listener) {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  #publish(state) {
    this.#state = state
    for (const listener of this.#listeners) listener()
  }

  /** @returns whether every pinned file is present with the pinned size. */
  async inspect() {
    try {
      for (const file of MODEL_FILES) {
        const info = await stat(join(this.#config.dataRoot, file.name))
        if (info.size !== file.size) {
          this.#publish({ phase: 'unprepared' })
          return
        }
      }
      this.#publish({ phase: 'ready' })
    } catch {
      this.#publish({ phase: 'unprepared' })
    }
  }

  /**
   * Download every missing pinned file, then load the recognizer.
   * @param options - optional explicit download origin.
   */
  prepare(options = {}) {
    const origin = options.downloadSource
    if (this.#loading !== undefined) {
      if (origin !== undefined && this.#loading.origin !== origin) {
        throw new Error('Cancel preparation before changing its download source')
      }
      return
    }
    const task = { origin, abort: new AbortController() }
    this.#loading = task
    void this.#run(task).finally(() => {
      if (this.#loading === task) this.#loading = undefined
    })
  }

  async #run(task) {
    const signal = AbortSignal.any([task.abort.signal, this.#lifetime.signal])
    try {
      await mkdir(this.#config.dataRoot, { recursive: true })
      const total = MODEL_FILES.reduce((sum, file) => sum + file.size, 0)
      let done = 0
      for (const file of MODEL_FILES) {
        const destination = join(this.#config.dataRoot, file.name)
        const present = await stat(destination).then(
          (info) => info.size === file.size,
          () => false,
        )
        if (present) {
          done += file.size
          continue
        }
        const base = done
        const origins = [
          ...(task.origin === undefined ? [] : [task.origin]),
          `https://huggingface.co/${DEFAULT_REPO}/resolve/main`,
        ]
        let failure
        for (const root of origins) {
          try {
            await downloadFile(
              `${root}/${file.name}`,
              destination,
              file,
              signal,
              (written) => {
                this.#publish({
                  phase: 'downloading',
                  resource: file.name,
                  completedBytes: base + written,
                  totalBytes: total,
                  step: 'model',
                  steps: [
                    { kind: 'check', status: 'complete' },
                    { kind: 'model', status: 'running' },
                    { kind: 'load', status: 'pending' },
                  ],
                })
              },
            )
            failure = undefined
            break
          } catch (error) {
            signal.throwIfAborted()
            failure = error
          }
        }
        if (failure !== undefined) throw failure
        done += file.size
      }
      signal.throwIfAborted()
      await this.#load(signal)
    } catch (error) {
      const cancelled = signal.aborted
      this.#publish({
        phase: cancelled ? 'cancelled' : 'failed',
        message: cancelled ? 'Preparation cancelled' : errorText(error),
      })
    }
  }

  async #load(signal) {
    this.#publish({
      phase: 'loading',
      step: 'load',
      steps: [
        { kind: 'check', status: 'complete' },
        { kind: 'model', status: 'complete' },
        { kind: 'load', status: 'running' },
      ],
    })
    const sherpa = loadSherpa()
    const recognizer = await sherpa.OfflineRecognizer.createAsync({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: join(this.#config.dataRoot, 'encoder.int8.onnx'),
          decoder: join(this.#config.dataRoot, 'decoder.onnx'),
          joiner: join(this.#config.dataRoot, 'joiner.int8.onnx'),
        },
        tokens: join(this.#config.dataRoot, 'tokens.txt'),
        numThreads: this.#config.numThreads,
        provider: 'cpu',
        debug: 0,
      },
    })
    signal.throwIfAborted()
    this.#recognizer = recognizer
    this.#publish({ phase: 'ready' })
  }

  /**
   * Cancel unfinished preparation. Loaded resources stay available.
   * @returns after the preparation task settled.
   */
  async cancel() {
    const task = this.#loading
    if (task === undefined) return
    this.#publish({ phase: 'cancelling' })
    task.abort.abort(new Error('Speech preparation cancelled'))
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        if (this.#loading !== task) {
          clearInterval(timer)
          resolve()
        }
      }, 25)
    })
  }

  /**
   * Transcribe one recording through the loaded recognizer.
   * @param input - complete WAV bytes and language hint.
   * @returns recognized text and timing facts.
   */
  async transcribe(input) {
    const phase = this.#state.phase
    if (phase !== 'ready' && phase !== 'standby') {
      throw new SpeechInputError('Prepare the Vietnamese recognizer before recording')
    }
    if (!LANGUAGES.includes(input.language)) {
      throw new SpeechInputError(`Unsupported language: ${input.language}`)
    }
    if (input.audio.length > this.#config.maxAudioBytes) {
      throw new SpeechInputError('Audio exceeds the configured byte limit')
    }
    clearTimeout(this.#idleTimer)
    this.#idleTimer = undefined
    try {
      const { samples, sampleRate } = decodeWave(Buffer.from(input.audio))
      if (sampleRate !== 16000) throw new SpeechInputError('Audio must be 16 kHz')
      if (this.#recognizer === undefined) await this.#load(this.#lifetime.signal)
      const started = Date.now()
      const stream = this.#recognizer.createStream()
      stream.acceptWaveform({ sampleRate, samples })
      const result = await this.#recognizer.decodeAsync(stream)
      return {
        text: tidy(result.text ?? ''),
        audioSeconds: samples.length / sampleRate,
        inferenceSeconds: (Date.now() - started) / 1000,
      }
    } catch (error) {
      if (error instanceof SpeechInputError) throw error
      await this.#unload()
      this.#publish({ phase: 'standby' })
      throw error
    } finally {
      this.#scheduleIdle()
    }  }

  #scheduleIdle() {
    clearTimeout(this.#idleTimer)
    this.#idleTimer = undefined
    if (this.#config.idleTimeoutMs <= 0) return
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = undefined
      this.#unload()
    }, this.#config.idleTimeoutMs)
    this.#idleTimer.unref?.()
  }

  #unload() {
    this.#recognizer = undefined
    if (this.#state.phase === 'ready') this.#publish({ phase: 'standby' })
  }

  /** Stop the recognizer and join any accepted work. @returns after settlement. */
  async dispose() {
    this.#lifetime.abort(new Error('Speech provider unloaded'))
    clearTimeout(this.#idleTimer)
    this.#idleTimer = undefined
    this.#recognizer = undefined
    this.#listeners.clear()
  }
}

/**
 * Normalize a transcript. The model emits uppercase text with no punctuation,
 * so restore sentence casing and mark an obvious Vietnamese interrogative.
 * @param text - raw decoded text.
 * @returns text ready to insert into a draft.
 */
function tidy(text) {
  const value = text.replace(/\s+/gu, ' ').trim().toLocaleLowerCase('vi')
  if (value === '') return ''
  const question = /(không|chưa|nhỉ|nhé|hả|được không|đúng không|phải không|bao nhiêu|thế nào|làm sao|ở đâu|tại sao|vì sao|mấy)$/u
  const sentences = value
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '')
  const rebuilt = sentences.map((sentence) => {
    const body = sentence.replace(/[.!?]+$/u, '')
    if (body === '') return ''
    const capitalized = body.charAt(0).toLocaleUpperCase('vi') + body.slice(1)
    return question.test(body) ? `${capitalized}?` : `${capitalized}.`
  })
  return `${rebuilt.filter((sentence) => sentence !== '').join(' ')} `
}

/**
 * @param error - unknown rejection value.
 * @returns a short message safe to show in the plugin page.
 */
function errorText(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Optional local Vietnamese provider; activation performs no downloads or model loading. */
export const name = 'voice-input-vi'

export const inject = ['speechToText']

export const Config = z.object({
  providerId: z.string().min(1).default('zipformer-vi-local').description('Recognizer id in the provider list'),
  modelDisplayName: z.string().min(1).default('Tiếng Việt (Zipformer 30M)').description('Provider name shown in the microphone menu'),
  dataRoot: z.string().min(1).description('Absolute directory that stores the pinned model files'),
  numThreads: z.natural().min(1).default(4).description('Native decode threads'),
  maxAudioBytes: z.natural().min(46).default(4 * 1024 * 1024).description('Largest accepted recording'),
  idleTimeoutMs: z.natural().default(300000).description('Unload the model after this idle period'),
})

/**
 * Register the Vietnamese recognizer and inspect cached files without downloading.
 * @param ctx - Host registry that owns the recognizer.
 * @param config - validated runtime configuration.
 */
export function apply(ctx, config) {
  if (!isAbsolute(config.dataRoot)) {
    throw new Error(`voice-input-vi dataRoot must be absolute: ${config.dataRoot}`)
  }
  const engine = new ZipformerVietnamese(ctx, config)
  ctx.effect(() => {
    const unregister = ctx.speechToText.register({
      info: {
        id: config.providerId,
        name: config.modelDisplayName,
        location: 'host-local',
        languages: LANGUAGES,
        downloadSources: ['https://huggingface.co'],
        setupEstimate: {
          recommendedDiskBytes: 40_000_000,
          expectedMemoryBytes: 200_000_000,
          minimumMinutes: 1,
          maximumMinutes: 5,
        },
      },
      preparation: {
        snapshot: () => engine.snapshot(),
        subscribe: (listener) => engine.subscribe(listener),
        prepare: (options) => engine.prepare(options),
        cancel: () => engine.cancel(),
      },
      transcribe: async (input) => engine.transcribe(input),
    })
    ctx.effect(() => () => {
      void engine.dispose()
    })
    void engine.inspect()
    return async () => {
      await unregister()
    }
  })
}
