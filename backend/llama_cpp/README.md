# llama.cpp Runtime Files

This directory is intentionally kept out of git except for this note.

## Local Windows Development

Put the Windows llama.cpp runtime here:

```text
backend/llama_cpp/bin/llama-server.exe
backend/llama_cpp/bin/*.dll
```

The default `backend/.env.example` points at `llama_cpp/bin/llama-server.exe`.

## Docker Compose

Docker Compose does not use this `bin` directory. It starts a separate
`llama-server` service from:

```text
ghcr.io/ggml-org/llama.cpp:server-cuda
```

The backend connects to that container at `http://llama-server:8080`.

## Model Files

You do not need to place Gemma 4 model files manually. Local backend startup can
download:

```text
backend/llama_cpp/models/gemma-4.gguf
backend/llama_cpp/models/mmproj.gguf
```

For Docker Compose, the `gemma-models` init service downloads those same files
into the `llama_models` Docker volume before the CUDA llama-server container
starts.
