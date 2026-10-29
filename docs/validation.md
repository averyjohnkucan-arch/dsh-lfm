# Validation

Validated on Linux x64 with an NVIDIA RTX PRO 5000 Blackwell Laptop GPU (24 GiB, SM120), using the unmodified official llama.cpp b11960 CUDA 12.8 release.

- All 13 automated tests passed: model identification, GGUF quantization metadata, complete/missing shards, projector discovery and ambiguity, saved settings, real React file selection, DSH request conversion, endpoint authentication, installer reuse/corruption/cancellation, and plugin lifecycle.
- A fresh isolated package installation imported both official BF16 models, discovered the VL projector, and saved settings. No other inference plugin is a dependency.
- Real BF16 text and image generations passed through the DSH/PiAi adapter. VL identified intentionally overlapping panels in a layout fixture.
- All nine exposed same-K/V formats loaded and generated: FP16, BF16, FP32, Q8_0, Q5_0, Q5_1, Q4_0, Q4_1, IQ4_NL. Mixed Q8_0/Q4_0 also generated. Other mixed combinations and other backends were not exhaustively tested.
- Ordinary Q4_0 test conversions of both models loaded and passed arithmetic/layout checks in the default Thinking mode. Direct mode gave incorrect answers in those Q4_0 checks. Official QAD quantizations were not tested. Quantization and thinking mode can affect answer quality; a successful load is not a quality guarantee.
- A native tool call reached DSH as `inspect_layout({})`. Unauthenticated engine requests returned HTTP 401. Cancellation released the active request lease, and owned engines stopped cleanly.
- The installer downloaded and verified the official server/CUDA archives and installed their private library closure. No inference engine was patched or compiled.

## BF16 throughput sample

792 uncached input tokens and 256 generated tokens; temperature 0, Thinking enabled, FP16/FP16 KV, eight CPU threads, batch 512, microbatch 128, native GPU memory fitting.

| Model      | Allocated context | Prefill tok/s | Decode tok/s |
| ---------- | ----------------: | ------------: | -----------: |
| LFM3-1.7B  |           262,144 |         4,998 |        130.0 |
| LFM3-VL-2B |           128,000 |         5,206 |        125.9 |

These are short text samples at the listed context allocation. They do not measure a filled full-context conversation, vision-encoder throughput, or general model quality.

Linux CUDA is qualified here. CPU and Apple Silicon installation paths are implemented but have not been qualified with real inference. Other platforms can supply a compatible server executable.
