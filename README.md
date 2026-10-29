# LFM for DeepSeek Harness

A small local provider for **LiquidAI LFM3-1.7B** and **LFM3-VL-2B**. It accepts GGUF weight quantizations supported by the included llama.cpp release, including unquantized BF16 and FP16. Other model families and raw Safetensors are not accepted.

## Use

In DSH's **Add plugin** window, paste:

```text
https://github.com/averyjohnkucan-arch/dsh-lfm
```

1. Install this package in DSH, then open **Settings → Models → LFM**.
2. Click **Select model file**. Browse the DSH computer's folders or paste a GGUF path and click **Open**.
3. The plugin checks the model and its shards, saves a profile, and loads it. Model files stay in place.

For VL, place its matching `mmproj` GGUF beside the model or in an immediate subfolder. A single matching projector is selected automatically. If none is found, or several are found, Settings asks you to choose one. A projector can also have an arbitrary filename when selected manually.

Each quantization can have its own profile and editable name. The text model advertises text input; VL advertises text and image input through DSH's attachment service.

## Settings

- **Context:** defaults to the GGUF's native value, with smaller choices in 32,768-token increments. The official text GGUF specifies 262,144; the official VL GGUF specifies 128,000.
- **K/V cache precision:** the pinned engine's FP16, BF16, FP32, Q8, Q5, Q4 and IQ4 formats. These change the attention cache, not the weight file's quantization. The native engine validates format combinations on the selected backend.
- **Thinking / Direct:** defaults to Thinking; each chat request can select either. Liquid notes that asking the model to disable thinking is not always reliable.
- **Advanced:** native memory fitting or manual GPU layers, GPU index, threads, batch/microbatch size, output limit, sampling, port, and a custom compatible server executable. Liquid's general sampling defaults are supplied.

**Save and benchmark** runs native memory fitting if enabled, then measures prefill and decode throughput using native timing records. Rates appear during generation when the engine reports them, and the final measurement is saved with its settings. Changing performance settings invalidates that measurement. A short benchmark does not qualify full-context speed or answer quality. llama.cpp has no Strata Thorough tuner; this plugin does not invent one.

## Runtime and storage

The plugin downloads checksum-pinned, **unmodified official llama.cpp b11960** binaries directly from GitHub. Installation is a cancellable background job with a Retry button. Linux x64 uses CUDA 12.8 when NVIDIA is available, otherwise CPU. Apple Silicon uses the official Metal build. Other systems can supply a compatible `llama-server` executable. Linux CUDA has been tested; other platforms have not been qualified here.

Profiles and the private runtime live in `$DSH_HOME/dsh-lfm`, or `~/.dsh/dsh-lfm`. Models and projectors stay at their selected paths. Native prompt caching operates inside the running server; this plugin does not claim persistent SSD conversation checkpoints.

Only plugin-owned engines are stopped. An active model in another GPU process must be unloaded before a conflicting load. DSH's shared model scheduler handles cooperating providers. Settings actions and inference endpoints require local owner credentials; servers bind to localhost.

## Development

Node 22.19+; peer dependencies match DSH 0.2.1-rc.2. Run `npm install`, `npm test`, and `npm run check`. The plugin has no Python or compilation requirement. Tests use synthetic GGUF headers and an isolated DOM; native integration validation is recorded separately.

Sources: [text model](https://huggingface.co/LiquidAI/LFM3-1.7B), [vision model](https://huggingface.co/LiquidAI/LFM3-VL-2B), [runtime release](https://github.com/ggml-org/llama.cpp/releases/tag/b11960). The bounded GGUF reader and process/job helpers were adapted from the MIT-licensed [dsh-dory](https://github.com/averyjohnkucan-arch/dsh-dory) plugin. Neither Strata nor NInfer is a dependency.

See [validation notes](docs/validation.md) for the tested hardware, measurements, and limitations.
