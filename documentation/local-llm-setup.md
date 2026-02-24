# Setting Up a Local LLM with an OpenAI-Compatible API Using llama.cpp

This guide walks through hosting a large language model on a local machine
— with or without GPUs — and exposing it as an HTTP server with an
OpenAI v1-compatible API endpoint.

## Preamble

We have run through a version of the following commands ourselves, so it is
reasonable to expect them to run. Nevertheless, please check the commands
before you run them yourself and adjust the parameters if necessary based on
the documentation of the respective packages. If you or your organization
have best-practises security workflows, then please be consistent with them
while running through the instructions below.

## Prerequisites

- An Ubuntu machine (22.04 used here)
- Python with pip
- Optional but recommended: one or more NVIDIA GPUs (this guide uses dual
  RTX 5090s)

## Step 1: Install Hugging Face Hub

The `huggingface_hub` package lets llama.cpp download models directly from
Hugging Face by name.

```bash
pip install huggingface_hub
```

## Step 2: Quick Start Without GPU Compilation

If you don't have GPUs or just want to get running fast, download the
pre-built llama.cpp binaries. In the example below, `b8068` is just a label
for a particular release. You can substitute for the latest release or
any other release if you wish.

```bash
wget https://github.com/ggml-org/llama.cpp/releases/download/b8068/llama-b8068-bin-ubuntu-x64.tar.gz
tar xzvf llama-b8068-bin-ubuntu-x64.tar.gz
```

Then launch the server with a small model:

```bash
./llama-b8068/llama-server \
    -hf Qwen/Qwen3-8B-GGUF:Q4_K_M \
    --jinja \
    -c 32768 \
    -n 8192 \
    --host 0.0.0.0 \
    --port 9800
```

Add `-ngl 99` to offload all model layers to the GPU. Without a GPU, omit
this flag for CPU-only inference.

The pre-built binaries work but don't include CUDA support, so GPU
offloading will be limited. For full GPU acceleration, compile from source
with CUDA enabled.

## Step 3: Find Your Machine's Network Address

Run `ip addr` (or `ifconfig` if installed) and look for the `inet` address
on your active network interface. This is the address other machines on the
network will use to reach your LLM server. For example, if your address is
`192.168.1.100`, your API endpoint will be at
`http://192.168.1.100:9800/v1`.

## Step 4: Compile llama.cpp with CUDA Support

### Install build dependencies

You need `nvcc` (the CUDA compiler) and `cmake`. The Ubuntu apt version of
`nvidia-cuda-toolkit` ships an older CUDA (11.x), which is fine as long as
it's at or below your driver's CUDA version — the toolkit is just the
compiler, while your driver handles the actual GPU work.

```bash
sudo apt install git build-essential nvidia-cuda-toolkit cmake
```

Verify the installs:

```bash
nvcc --version
cmake --version
```

### Clone and build

The source repo is at `ggerganov/llama.cpp` (the pre-built binaries above
are published under the `ggml-org` organisation, which is the same
project).

```bash
cd ~
git clone https://github.com/ggerganov/llama.cpp.git
cd llama.cpp
git checkout b8068  # pin to a known-good version, or skip for latest
cmake -B build -DGGML_CUDA=ON
cmake --build build --config Release -j$(nproc)
```

Watch the cmake output — it should report that CUDA was found and list your
GPU architecture. The build takes a few minutes; `-j$(nproc)` uses all CPU
cores.

### If the build fails: install a newer CUDA toolkit

The apt-packaged toolkit may be too old for your GPU architecture. In that
case, install NVIDIA's official toolkit directly. The commands below assume
Ubuntu 22.04 — for other versions, substitute the appropriate keyring
package from NVIDIA's CUDA repository:

```bash
sudo apt remove nvidia-cuda-toolkit
rm -rf ~/llama.cpp/build

wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i cuda-keyring_1.1-1_all.deb
sudo apt update
sudo apt install cuda-toolkit-12-6 libssl-dev

export PATH=/usr/local/cuda-12.6/bin:$PATH
nvcc --version  # should show 12.6
```

Then rebuild:

```bash
cd ~/llama.cpp
cmake -B build -DGGML_CUDA=ON
cmake --build build --config Release -j$(nproc)
```

### Verify the build

```bash
./build/bin/llama-server --version
```

The output should mention CUDA. Depending on the version, it may also
enumerate your GPU devices, e.g.:

```
ggml_cuda_init: found 2 CUDA devices:
  Device 0: NVIDIA GeForce RTX 5090, compute capability 12.0, VMM: yes
  Device 1: NVIDIA GeForce RTX 5090, compute capability 12.0, VMM: yes
```

## Step 5: Launch the Server

### Small model (8B parameters)

Good for testing or limited VRAM:

```bash
./build/bin/llama-server \
    -hf Qwen/Qwen3-8B-GGUF:Q4_K_M \
    --jinja \
    -ngl 99 \
    -c 32768 \
    -n 8192 \
    --host 0.0.0.0 \
    --port 9800
```

### Large model with multi-GPU (235B MoE)

With dual high-VRAM GPUs, you can run much larger models. The `-ts 0.5,0.5`
flag splits the work evenly across two GPUs:

```bash
./build/bin/llama-server \
    -hf Qwen/Qwen3-235B-A22B-GGUF:Q4_K_M \
    --jinja \
    -ngl 40 \
    -c 32768 \
    -n 8192 \
    -fa on \
    -ts 0.5,0.5 \
    -fit off \
    --host 0.0.0.0 \
    --port 9800
```

### Instruct model with large context (80B MoE)

A Mixture-of-Experts instruct model that can run on dual high-VRAM GPUs.
The usable context length depends on available memory — reduce `-c` if you
run into out-of-memory errors:

```bash
./build/bin/llama-server \
    -hf Qwen/Qwen3-Next-80B-A3B-Instruct-GGUF:Q4_K_M \
    --jinja \
    -ngl 99 \
    -c 262144 \
    -n 8192 \
    -fa on \
    -ts 0.5,0.5 \
    -fit off \
    --host 0.0.0.0 \
    --port 9800
```

### Key flags explained

| Flag | Meaning |
|------|---------|
| `-hf` | Download a model from Hugging Face by name |
| `--jinja` | Enable Jinja2 chat template rendering |
| `-ngl 99` | Offload all layers to GPU (use a lower number for partial offload) |
| `-c` | Context window size in tokens |
| `-n` | Maximum tokens to generate per request |
| `-fa on` | Enable flash attention |
| `-ts 0.5,0.5` | Split tensor work 50/50 across two GPUs |
| `-fit off` | Disable automatic fit (use manual tensor split instead) |
| `--host 0.0.0.0` | Listen on all network interfaces (see security note below) |
| `--port 9800` | Port number for the server |

**Security note:** Using `--host 0.0.0.0` exposes the server to your
entire local network without authentication. This is fine for an internal
lab machine, but on a shared or public network consider binding to
`127.0.0.1` and using a reverse proxy with authentication, or restricting
access with a firewall.

## Step 6: Use the API

Once the server is running, it exposes an OpenAI v1-compatible API at:

```
http://<your-ip>:9800/v1
```

This is largely compatible with the OpenAI API and works with most
OpenAI-compatible clients. Point applications to
`http://<your-ip>:9800/v1` as the base URL. Not all OpenAI endpoints and
features are supported — check the llama.cpp documentation for details on
what's available.

To verify the server is running, try:

```bash
curl http://<your-ip>:9800/v1/models
```

This should return a JSON response listing the loaded model.

