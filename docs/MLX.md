# Experimental Apple Silicon MLX backend

This is a prototype for [issue #1](https://github.com/averyjohnkucan-arch/dsh-lfm/issues/1), not a production qualification or release. Existing GGUF profiles continue to use llama.cpp, including its Metal build. Native MLX weights never pass through llama.cpp.

## Compatibility investigation

Inspected MLX-VLM **v0.7.11**, commit `527c513a0768245644a70266a22126d880767b18`, and the official [LiquidAI/LFM3-1.7B-MLX-4bit checkpoint](https://huggingface.co/LiquidAI/LFM3-1.7B-MLX-4bit). The checkpoint config at revision `91f34088d6946482cbcae11b85d4657093618c34` identifies `lfm3`, `Lfm3ForCausalLM`, 24 layers, hidden size 2048, vocabulary 128000, affine 4-bit/group-64 weights, and a 262144-token native context.

| DSH contract | MLX-VLM 0.7.11 source | Prototype handling |
| --- | --- | --- |
| Local OpenAI chat API | `/v1/chat/completions`, SSE deltas and `[DONE]` | Reuses `PiAiAdapter` and the existing stream gate |
| Bearer authentication | `MLX_VLM_SERVER_API_KEY`, inference/discovery authentication | Fresh random key per owned process; redacted logs; loopback binding |
| Readiness and identity | `/v1/models` lists loaded and discoverable models | Requires the canonical local snapshot path **and** `loaded: true`; directory discovery alone cannot establish readiness |
| Profile ID as request model | Server expects the model path, no llama.cpp `--alias` | Rewrites the outgoing request model to the validated snapshot path; DSH retains its profile UUID |
| Sampling/thinking | `repetition_penalty`, `enable_thinking`, temperature/top-p/top-k/min-p | Translates the two differing names; omits llama.cpp slots/cache/template fields |
| Tool calls | OpenAI `tools`, tool deltas, finish reason and tool-result history; LFM3 XML parser inferred as `qwen3_coder` | Preserves the existing adapter's structured tool handling; hardware round trip remains untested |
| Cancellation | Chat streaming closes the token iterator in `finally` | Reuses abort signals and lease/gate cleanup; prompt GPU cancellation needs observation on a Mac |
| Context | `--max-kv-size` checks prompt plus requested generation budget | Passes the native checkpoint limit; custom caps are deliberately unavailable in this prototype |
| Load/unload/scheduling | Python module server process | Reuses owned process groups, serialized loads, DSH scheduler hooks, readiness timeout and shutdown |
| llama.cpp tuning/timings | Different KV controls and response metrics | Hides llama.cpp placement/KV controls; rejects nondefault KV/custom llama executable; disables the llama.cpp benchmark |

Primary implementation references at the inspected commit:

- [CLI and authentication configuration](https://github.com/Blaizzy/mlx-vlm/blob/527c513a0768245644a70266a22126d880767b18/mlx_vlm/server/cli.py)
- [Authentication, startup preload and model listing](https://github.com/Blaizzy/mlx-vlm/blob/527c513a0768245644a70266a22126d880767b18/mlx_vlm/server/app.py)
- [Chat streaming, tools and iterator cleanup](https://github.com/Blaizzy/mlx-vlm/blob/527c513a0768245644a70266a22126d880767b18/mlx_vlm/server/openai.py)
- [Request fields](https://github.com/Blaizzy/mlx-vlm/blob/527c513a0768245644a70266a22126d880767b18/mlx_vlm/server/schemas.py)
- [Native LFM3 implementation and tool/quantization notes](https://github.com/Blaizzy/mlx-vlm/blob/527c513a0768245644a70266a22126d880767b18/mlx_vlm/models/lfm3/README.md)

[mlx-lm PR #2016](https://github.com/ml-explore/mlx-lm/pull/2016) remained open at investigation time. This prototype does not depend on that PR or use `mlx_lm.server`. MLX-VLM has its own native LFM3 implementation. Source inspection found no missing API primitive that necessarily blocks this prototype, but it is not an executed server compatibility test.

## Scope and safety

Only local, native quantized **text LFM3-1.7B** snapshot directories are accepted. The importer validates config metadata and tokenizer JSON, requires either `model.safetensors` or a complete safetensors index, rejects indexed path traversal and mismatched/missing shards, and canonicalizes the directory. Normal Hugging Face snapshot symlinks to cached blobs are supported. It never chooses a backend from the filename or repository name. This structural check does not validate tensor contents, provenance, numerical correctness, or the full tokenizer schema; the actual loader remains responsible for those checks. Use a trusted checkpoint.

Profiles persist `backend` and `mlxPython`; old profiles without either field default to llama.cpp. Save and launch recheck backend/model compatibility. No dependencies are automatically installed. Loading MLX requires native arm64 macOS and an absolute virtualenv Python path with stable mlx-vlm >= 0.7.11. The version probe runs that explicitly selected interpreter. Server loading uses offline Hugging Face access and disables remote checkpoint Python code. Inherited MLX-VLM preload/draft/server and KV environment overrides are removed so they cannot silently select additional models or override the profile. Do the initial download before loading through DSH.

GGUF import still loads immediately. MLX import first saves a profile and opens settings for interpreter setup. In DSH Settings → Models → LFM, choose **Select model file**, open the snapshot directory, choose **Use this MLX snapshot folder (experimental)**, then set **Advanced → MLX Python** and choose **Save and load**. Do not use “Install LFM runtime” for MLX; that action installs llama.cpp.

The MLX path ignores saved llama.cpp CPU/batch/placement fields and does not send those arguments to Python. Default f16 KV fields mean no MLX KV quantization flags are requested; they do not force a particular MLX tensor dtype. MLX vision/projectors, quantized KV, memory fitting, benchmark metrics, and Rosetta/x86 Python are outside this prototype. The native context is a token ceiling, not a promise that the Mac has enough memory for it.

## Reproduce on Apple Silicon (not executed here)

Use a native arm64 terminal, Node >= 22.19 and Python supported by mlx-vlm. Run from a checkout of this branch. Review the model's license/access requirements before downloading.

```sh
uname -m                         # must print arm64
node --version
python3 -m venv "$HOME/.venvs/dsh-mlx"
"$HOME/.venvs/dsh-mlx/bin/python" -m pip install 'mlx-vlm==0.7.11' huggingface_hub
"$HOME/.venvs/dsh-mlx/bin/python" -c 'import platform; print(platform.machine())'
"$HOME/.venvs/dsh-mlx/bin/python" -c 'from huggingface_hub import snapshot_download; snapshot_download(repo_id="LiquidAI/LFM3-1.7B-MLX-4bit", revision="91f34088d6946482cbcae11b85d4657093618c34", local_dir="./models/LFM3-1.7B-MLX-4bit")'
npm install --ignore-scripts --package-lock=false
npm test
npm run check
node scripts/validate-mlx.mjs ./models/LFM3-1.7B-MLX-4bit "$HOME/.venvs/dsh-mlx/bin/python"
```

The hardware script uses temporary profiles, port 18270 (override with `DSH_MLX_VALIDATION_PORT`), the real runtime, and the real DSH adapter. It checks loaded identity and authentication, streamed generation, cancellation after a text token, a subsequent successful request, structured tool name/JSON arguments, a synthetic tool-result round trip, and unload. It never executes a model-requested tool. It fails if any asserted behavior is absent; ordinary text containing tool markup is not accepted as a tool call. Its source is syntax-checked here, but the script has not been run on Apple Silicon.

For a load-cancellation check, run the following separately; cancellation must leave no owned server process in `ps`:

```sh
DSH_MLX_CANCEL_LOAD_MS=2000 node scripts/validate-mlx.mjs ./models/LFM3-1.7B-MLX-4bit "$HOME/.venvs/dsh-mlx/bin/python"
```

If preload finishes before the timer, increase model startup cost or shorten the interval; a completed load does not count as a cancellation test. Also exercise **Cancel task** during a DSH UI load, and cancel a DSH chat response before sending another. Observe Activity Monitor GPU usage and Python memory while cancelling: client completion and released leases alone do not prove that backend computation has stopped promptly. Record macOS/chip/unified memory, Python/Node/mlx-vlm/MLX versions, exact checkpoint revision, outputs, cancellation latency, post-cancel response latency and any server errors. Do not label a failed tool assertion as successful compatibility.

## Validation status and remaining limitations

Completed on the Linux CPU host:

- `npm test`: 18 tests passed, including existing GGUF/runtime/UI checks.
- New structural detection, index safety/completeness, profile persistence/default migration, backend mismatch, platform and interpreter guards, and launch/payload isolation tests.
- A real Python preflight probe with mocked package metadata/platform checks rejects old or prerelease packages and x86 interpreters without importing MLX.
- A fake Python/server process exercises authenticated startup, loaded model identity, key redaction, aborted-start cleanup, unload and wrong-identity cleanup. This fixture does not import Python MLX packages.
- Mock OpenAI SSE responses exercise the real DSH adapter's MLX payload, split tool-call decoding, cancelled-stream lease cleanup and a subsequent turn. Mock responses do not demonstrate model capability.
- The settings regression covers MLX folder import, interpreter setup and hidden unsupported controls.
- `npm run check`, hardware script syntax check, and `git diff --check`.

**Unexecuted:** installing/importing MLX on a Mac, real checkpoint loading, generation quality/throughput/memory, native server wire compatibility, long-context behavior, prompt GPU cancellation, scheduler coexistence with other Apple GPU providers, and a real model tool-call/result round trip. No Apple Silicon device is available in this environment.

Upstream's LFM3 notes report weaker 4-bit output agreement and an example where the model answered in text instead of calling a tool. The API/parser existing does not guarantee this quantization will call tools reliably. A failed tool round trip or nonresponsive cancellation on hardware is a qualification blocker. Newer mlx-vlm versions pass the minimum-version gate but are not covered by this source audit; pin 0.7.11 for the first reproduction. No feature release or production-readiness claim is made.
